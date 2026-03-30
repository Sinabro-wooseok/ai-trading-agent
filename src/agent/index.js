require('dotenv').config();
const { ethers } = require('ethers');
const { getTicker, getBalance, getOHLC, buyMarket, sellMarket, PAPER_MODE } = require('../utils/kraken');
const { extractCloses } = require('../strategies/rsi');
const { getCombinedSignal } = require('../strategies/combined');
const { calcATR, calcATRPositionSize } = require('../strategies/atr');
const { canTrade, setDailyBaseline } = require('../risk/manager');
const { signTradeIntent } = require('../signing/eip712');
const { getMarketRegime, applyTrendFilter } = require('../strategies/trend');

const BUY_THRESHOLD = 28;   // 해커톤: F&G 극단공포 기준 조정
const SELL_THRESHOLD = 20;  // 30→20
const { saveState, saveTrade, savePricePoint } = require('./state');

// 학습 모듈
const { updateWeights } = require('../learning/weights');
const { buildState, getAction, update: qUpdate, getStats: qStats } = require('../learning/qtable');
const { getParams, tune } = require('../learning/tuner');

const PAIR = 'XBTUSD';
const INTERVAL_MS = 60 * 1000;
const TUNE_INTERVAL = 10; // 10사이클마다 파라미터 튜닝
let cycleCount = 0;
let lastTradeTime = 0;

// 포지션 추적 (학습에 사용)
let pendingTrade = null; // { state, action, entryPrice, indicators }

// ERC-8004 온체인 설정
const ONCHAIN_ENABLED = !!(process.env.AGENT_PRIVATE_KEY && process.env.TRADE_VALIDATOR_ADDRESS);
let signer = null;
let tradeNonce = 0;

if (ONCHAIN_ENABLED) {
  const provider = new ethers.JsonRpcProvider(
    `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY || ''}` ||
    'https://sepolia.base.org'
  );
  signer = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log(`[ERC-8004] 온체인 서명 활성화: ${signer.address}`);
}

// 파일에서 거래 내역 로드
function loadTrades() {
  const fs = require('fs');
  const path = require('path');
  const f = path.join(__dirname, '../../data/trades.json');
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}

async function executeTrade(isBuy, volume, currentPrice, signal, votes, currentState) {
  if (ONCHAIN_ENABLED) {
    const { signature } = await signTradeIntent({
      signer,
      validatorAddress: process.env.TRADE_VALIDATOR_ADDRESS,
      agentId: process.env.AGENT_ID || 1,
      pair: PAIR, volume, isBuy, price: currentPrice, nonce: tradeNonce,
    });
    tradeNonce++;
    console.log(`[ERC-8004] TradeIntent 서명 (nonce:${tradeNonce - 1}) ${signature.slice(0, 20)}...`);
  }

  const side = isBuy ? '매수' : '매도';
  const params = getParams();
  console.log(`[${side}] ${volume.toFixed(8)} BTC @ $${currentPrice.toLocaleString()} [임계:${params.voteThreshold}/7 손절:${(params.stopLossPct*100).toFixed(1)}%]`);

  const orderResult = isBuy
    ? buyMarket(PAIR, volume.toFixed(8))
    : sellMarket(PAIR, volume.toFixed(8));
  console.log('[주문 완료]', JSON.stringify(orderResult));

  saveTrade({ side: isBuy ? 'BUY' : 'SELL', pair: PAIR, volume: parseFloat(volume.toFixed(8)), price: currentPrice, usd: volume * currentPrice, signal, votes });
  saveState({ lastTrade: { side: isBuy ? 'BUY' : 'SELL', price: currentPrice, volume, time: new Date().toISOString() } });
  lastTradeTime = Date.now();

  if (isBuy) {
    pendingTrade = { state: currentState, action: 'BUY', entryPrice: currentPrice };
    const params2 = getParams();
    saveState({ stopLossPrice: currentPrice * (1 - params2.stopLossPct) });
  } else {
    // SELL: 학습 업데이트
    if (pendingTrade) {
      const pnlPct = (currentPrice - pendingTrade.entryPrice) / pendingTrade.entryPrice * 100;
      const outcome = pnlPct > 0 ? 'win' : 'loss';
      console.log(`[결과] 진입 $${pendingTrade.entryPrice.toLocaleString()} → 청산 $${currentPrice.toLocaleString()} | PnL: ${pnlPct.toFixed(2)}% (${outcome})`);

      // 레벨 1: 가중치 업데이트 (마지막 BUY 시점의 지표 필요 → 상태에서 복원)
      // pendingTrade에 지표 저장되어 있으면 업데이트
      if (pendingTrade.indicators) {
        updateWeights(pendingTrade.indicators, 'BUY', outcome);
      }

      // 레벨 2: Q-Table 업데이트
      qUpdate(pendingTrade.state, pendingTrade.action, pnlPct, currentState);
    }
    pendingTrade = null;
    saveState({ stopLossPrice: null });
  }

  return orderResult;
}

async function runCycle() {
  cycleCount++;
  console.log(`\n[${new Date().toISOString()}] 사이클 #${cycleCount}`);

  try {
    const balance = getBalance();
    // 페이퍼 모드: current_value = 현재 총자산(USD+BTC 환산), startingBalance = 시작잔고
    const usdBalance = parseFloat(balance?.ZUSD || balance?.USD || 0);
    const btcBalance = parseFloat(balance?.XXBT || balance?.XBT || 0);
    const startingBalance = balance?.startingBalance ?? 10000;
    const unrealizedPnl = balance?.unrealizedPnl ?? 0;
    const unrealizedPnlPct = balance?.unrealizedPnlPct ?? 0;
    console.log(`[잔고] 총자산: $${usdBalance.toFixed(2)} | PnL: ${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)} (${(unrealizedPnlPct * 100).toFixed(2)}%)`);

    if (usdBalance < 1 && btcBalance < 0.0001) {
      saveState({ status: 'warning', balance: { usd: usdBalance, btc: btcBalance, totalUsd: 0 } });
      return;
    }

    const currentPrice = getTicker(PAIR);
    const totalUSD = usdBalance + btcBalance * currentPrice;
    setDailyBaseline(totalUSD);

    if (!canTrade(totalUSD)) {
      saveState({ status: 'halted', price: currentPrice, balance: { usd: usdBalance, btc: btcBalance, totalUsd: totalUSD } });
      return;
    }

    // 60분봉: 추세 방향 판단
    const candles = getOHLC(PAIR, 60);
    const closes = extractCloses(Array.isArray(candles) ? candles : []);

    // 15분봉: 진입 타이밍 (더 민감한 시그널)
    const candles15m = getOHLC(PAIR, 15);
    const closes15m = extractCloses(Array.isArray(candles15m) ? candles15m : []);

    // 200 EMA 추세 필터 (60분봉 기준)
    const { regime, ema200 } = getMarketRegime(closes, currentPrice);
    console.log(`[추세] ${regime.toUpperCase()} | EMA200: $${ema200 ? ema200.toFixed(0) : '--'}`);

    // 레벨 3: 파라미터 자동 튜닝 (N사이클마다)
    const params = cycleCount % TUNE_INTERVAL === 0
      ? tune(loadTrades(), calcATR(candles))
      : getParams();

    // 60분봉 복합 시그널 (추세 확인)
    const result = await getCombinedSignal(closes, candles, params.voteThreshold);
    const { signal: rawSignal, votes, detail, weights, fgMultiplier: fgMultiplier_ } = result;

    // 15분봉 복합 시그널 (진입 타이밍)
    let result15m = { signal: 'HOLD', votes: {} };
    if (closes15m.length >= 30) {
      result15m = await getCombinedSignal(closes15m, candles15m, params.voteThreshold);
    }
    console.log(`[15분봉] ${result15m.signal} | 매수점:${result15m.votes?.weightedBuy ?? 0} 매도점:${result15m.votes?.weightedSell ?? 0}`);

    // 추세 필터 적용 (60분봉 기준, F&G 극단 공포 예외 포함)
    const fgValue = result.detail?.fearGreed?.value || 50;
    const filteredSignal = applyTrendFilter(rawSignal, regime, fgValue);
    if (filteredSignal !== rawSignal) console.log(`[추세 필터] ${rawSignal} → HOLD`);
    if (rawSignal === 'BUY' && regime === 'bear' && filteredSignal === 'BUY') console.log(`[F&G 예외] BEAR이지만 극단공포(${fgValue}) → BUY 허용`);

    console.log(`[시그널] ${filteredSignal} | 매수점:${votes.weightedBuy}(임계:${BUY_THRESHOLD}) 매도점:${votes.weightedSell}(임계:${SELL_THRESHOLD})`);
    console.log(`  RSI:${detail.rsi.value} StochRSI:${detail.stochRSI.value} MACD:${detail.macd.histogram} F&G:${detail.fearGreed.value}(x${fgMultiplier_})`);
    console.log(`  BTC: $${currentPrice.toLocaleString()} | ${votes.buyCount}B ${votes.sellCount}S 단순투표`);

    // ATR 포지션 사이징
    const atr = calcATR(candles);
    const atrVolume = atr
      ? calcATRPositionSize(usdBalance, currentPrice, atr, params.positionRiskPct)
      : usdBalance * 0.05 / currentPrice;

    // Q-Learning 상태 & 행동
    const qState = buildState(detail, regime, currentPrice);
    const allowedActions = filteredSignal === 'BUY' ? ['BUY', 'HOLD']
      : filteredSignal === 'SELL' ? ['SELL', 'HOLD']
      : ['HOLD'];
    const qAction = getAction(qState, allowedActions);
    const qInfo = qStats();

    // 15분봉 방향 확인 (완화: 반대 방향일 때만 차단)
    // 60분봉 BUY + 15분봉 SELL → 보류 / 60분봉 BUY + 15분봉 HOLD → 허용
    const mtfSignal = (() => {
      if (filteredSignal === 'HOLD') return 'HOLD';
      if (result15m.signal === 'HOLD') return filteredSignal; // 15분봉 중립 → 60분봉 따름
      if (result15m.signal === filteredSignal) return filteredSignal; // 방향 일치 → 강한 진입
      // 15분봉이 반대 방향 → 차단
      console.log(`[MTF 필터] 60분:${filteredSignal} vs 15분:${result15m.signal} → HOLD`);
      return 'HOLD';
    })();

    // 최종 시그널: 추세필터 → MTF 확인 → Q-Learning 검증
    // ε-탐험 중(random)이면 MTF 시그널 우선, 아니면 Q 행동 우선
    const finalSignal = mtfSignal !== 'HOLD' && qAction !== 'HOLD' ? qAction : mtfSignal;

    console.log(`  Q-Learning → ${qAction} (ε:${qInfo.epsilon} 학습:${qInfo.totalUpdates}회 상태:${qInfo.stateCount}개)`);

    // 상태 저장
    saveState({
      status: 'running',
      cycle: cycleCount,
      price: currentPrice,
      signal: finalSignal,
      rawSignal,
      votes,
      indicators: detail,
      balance: {
        usd: usdBalance,
        btc: btcBalance,
        totalUsd: totalUSD,
        startingBalance,
        unrealizedPnl,
        unrealizedPnlPct,
      },
      regime,
      ema200: ema200 ? parseFloat(ema200.toFixed(0)) : null,
      atr: atr ? parseFloat(atr.toFixed(2)) : null,
      learning: {
        weights,
        qState,
        qAction,
        qEpsilon: qInfo.epsilon,
        qUpdates: qInfo.totalUpdates,
        qStates: qInfo.stateCount,
        threshold: params.voteThreshold,
        stopLossPct: params.stopLossPct,
        positionRiskPct: params.positionRiskPct,
        tuneHistory: params.history || [],
      },
    });
    savePricePoint(currentPrice, finalSignal, totalUSD);

    // 손절 체크
    if (btcBalance > 0.0001 && pendingTrade) {
      const stopLoss = pendingTrade.entryPrice * (1 - params.stopLossPct);
      if (currentPrice <= stopLoss) {
        console.log(`[손절] $${currentPrice.toLocaleString()} <= 손절선 $${stopLoss.toLocaleString()}`);
        await executeTrade(false, btcBalance, currentPrice, 'STOP_LOSS', votes, qState);
        return;
      }
    }

    // 쿨다운 체크
    if (Date.now() - lastTradeTime < params.cooldownMs) {
      console.log(`[쿨다운] ${Math.round((Date.now() - lastTradeTime) / 1000)}초 대기`);
      return;
    }

    let shouldTrade = false;
    let isBuy = false;
    let volume = 0;

    if (finalSignal === 'BUY' && usdBalance > 1) {
      volume = atrVolume; isBuy = true; shouldTrade = true;
    } else if (finalSignal === 'SELL' && btcBalance > 0.0001) {
      volume = Math.min(btcBalance, atrVolume); isBuy = false; shouldTrade = true;
    }

    if (!shouldTrade) {
      console.log('[대기] 시그널 없음');
      // HOLD → Q-Learning 패널티 적용 (HOLD 편향 해소)
      qUpdate(qState, 'HOLD', 0, qState);
      return;
    }

    // Fear&Greed 포지션 승수 적용 (극단적 공포 시 포지션 확대)
    const fgMultiplier = fgMultiplier_ || 1.0;
    const finalVolume = isBuy
      ? Math.min(volume * fgMultiplier, usdBalance * 0.2 / currentPrice) // 최대 20% 캡
      : volume;

    if (fgMultiplier > 1.0) {
      console.log(`[F&G 승수] x${fgMultiplier} 포지션 확대 (지수:${detail.fearGreed.value} ${detail.fearGreed.strength})`);
    }

    // 진입 시 지표 스냅샷 저장
    if (isBuy) {
      pendingTrade = { state: qState, action: 'BUY', entryPrice: currentPrice, indicators: detail };
    }

    await executeTrade(isBuy, finalVolume, currentPrice, finalSignal, votes, qState);

  } catch (err) {
    console.error('[에러]', err.message);
    saveState({ status: 'error' });
  }
}

console.log(`AI 트레이딩 에이전트 v4 시작 [${PAPER_MODE ? '페이퍼' : '실거래'} | ERC-8004: ${ONCHAIN_ENABLED ? 'ON' : 'OFF'}]`);
console.log('[전략] 가중치 투표 + Q-Learning + 자동 파라미터 튜닝 + 200 EMA + 손절');
runCycle();
setInterval(runCycle, INTERVAL_MS);
