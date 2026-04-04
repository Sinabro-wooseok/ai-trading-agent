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

// 포지션 추적 - 다중 진입 지원 (물타기/불타기)
// {
//   entries: [{price, volume, time}],  // 각 진입 기록
//   avgPrice: number,                   // 평균 진입가
//   totalVolume: number,                // 총 보유량
//   peakPrice: number,                  // 최고가 (불타기 트레일링 스탑용)
//   state: qState,                      // 최초 진입 Q 상태
//   indicators: {},                     // 최초 진입 지표 스냅샷
// }
let pendingTrade = null;

// ─── 물타기 / 불타기 설정 (3Commas + LuxAlgo 연구 기반) ───
const PYRAMID = {
  // 물타기 (DCA): 하락 시 추가 매수
  DCA_STEP_1: -0.02,   // -2% 에서 1차 추가 (기본량의 x1.5)
  DCA_STEP_2: -0.05,   // -5% 에서 2차 추가 (기본량의 x2.0)
  DCA_MULTIPLIER: [0, 1.5, 2.0], // 진입 순서별 사이즈 배율

  // 불타기 (Pyramid scale-in): 상승 시 추가 매수
  PYR_STEP_1: +0.02,   // +2% 에서 추가 (기본량의 x0.6)
  PYR_STEP_2: +0.05,   // +5% 에서 추가 (기본량의 x0.4)
  PYR_MULTIPLIER: [0, 0.6, 0.4], // 50-30-20 비율 변형

  MAX_ENTRIES: 3,       // 최대 진입 횟수 (1 기본 + 2 추가)
  MAX_POSITION_PCT: 0.5, // 총 자본 50% 상한
};

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

// ─── 물타기 / 불타기 진입 판단 ───
function checkPyramidEntry(currentPrice) {
  if (!pendingTrade || !pendingTrade.entries || pendingTrade.entries.length >= PYRAMID.MAX_ENTRIES) return null;

  const entryCount = pendingTrade.entries.length;
  if (entryCount === 0 || !pendingTrade.avgPrice) return null;
  const pricePct = (currentPrice - pendingTrade.avgPrice) / pendingTrade.avgPrice;
  const baseVolume = pendingTrade.entries[0]?.volume || pendingTrade.totalVolume || 0;
  if (!baseVolume) return null;

  // 물타기: 하락 중 추가 매수
  if (entryCount === 1 && pricePct <= PYRAMID.DCA_STEP_1) {
    const addVolume = baseVolume * PYRAMID.DCA_MULTIPLIER[1];
    console.log(`[물타기] ${(pricePct*100).toFixed(2)}% 하락 → ${addVolume.toFixed(8)} BTC 추가 매수 (평균단가 낮추기)`);
    return { type: 'DCA', volume: addVolume };
  }
  if (entryCount === 2 && pricePct <= PYRAMID.DCA_STEP_2) {
    const addVolume = baseVolume * PYRAMID.DCA_MULTIPLIER[2];
    console.log(`[물타기2] ${(pricePct*100).toFixed(2)}% 하락 → ${addVolume.toFixed(8)} BTC 추가 매수`);
    return { type: 'DCA', volume: addVolume };
  }

  // 불타기: 상승 중 추가 매수 (추세 올라타기)
  if (entryCount === 1 && pricePct >= PYRAMID.PYR_STEP_1) {
    const addVolume = baseVolume * PYRAMID.PYR_MULTIPLIER[1];
    console.log(`[불타기] +${(pricePct*100).toFixed(2)}% 상승 → ${addVolume.toFixed(8)} BTC 추가 (추세 올라타기)`);
    return { type: 'PYRAMID', volume: addVolume };
  }
  if (entryCount === 2 && pricePct >= PYRAMID.PYR_STEP_2) {
    const addVolume = baseVolume * PYRAMID.PYR_MULTIPLIER[2];
    console.log(`[불타기2] +${(pricePct*100).toFixed(2)}% 상승 → ${addVolume.toFixed(8)} BTC 추가`);
    return { type: 'PYRAMID', volume: addVolume };
  }

  return null;
}

// 포지션 평균가 & 총 보유량 재계산
function recalcPosition(entries) {
  const totalCost = entries.reduce((s, e) => s + e.price * e.volume, 0);
  const totalVol = entries.reduce((s, e) => s + e.volume, 0);
  return { avgPrice: totalCost / totalVol, totalVolume: totalVol };
}

// 포지션 파일 경로
const POSITION_FILE = require('path').join(__dirname, '../../data/position.json');

// 포지션 저장
function savePosition(pos) {
  require('fs').writeFileSync(POSITION_FILE, JSON.stringify(pos, null, 2));
}

// 포지션 복원 (재시작 시 호출)
function loadPosition() {
  if (!require('fs').existsSync(POSITION_FILE)) return null;
  try { return JSON.parse(require('fs').readFileSync(POSITION_FILE, 'utf8')); } catch { return null; }
}

// 시작 시 미청산 포지션 복원
pendingTrade = loadPosition();
if (pendingTrade) {
  // 구버전 포지션 형식 호환
  if (!pendingTrade.entries) {
    pendingTrade.entries = [{ price: pendingTrade.entryPrice || pendingTrade.avgPrice, volume: pendingTrade.volume || 0, time: new Date().toISOString() }];
    pendingTrade.avgPrice = pendingTrade.avgPrice || pendingTrade.entryPrice;
    pendingTrade.totalVolume = pendingTrade.volume || 0;
    pendingTrade.peakPrice = pendingTrade.entryPrice;
  }
  console.log(`[포지션 복원] 평균진입 $${pendingTrade.avgPrice?.toLocaleString()} | ${pendingTrade.entries.length}회 진입 | 총 ${pendingTrade.totalVolume?.toFixed(6)} BTC`);
} else {
  // position.json 없으면 trades.json에서 마지막 SELL 이후 BUY만 포지션 재구성
  const allTrades = loadTrades(); // 최신순 정렬
  // 마지막 SELL 인덱스 찾기 (없으면 전체)
  const lastSellIdx = allTrades.findIndex(t => t.side === 'SELL');
  const recentTrades = lastSellIdx === -1 ? allTrades : allTrades.slice(0, lastSellIdx);
  const recentBuys = recentTrades.filter(t => t.side === 'BUY');
  const netBtc = recentBuys.reduce((s, t) => s + t.volume, 0);
  if (netBtc > 0.0001) {
    const totalCost = recentBuys.reduce((s, t) => s + (t.usd || t.price * t.volume), 0);
    const totalVol = recentBuys.reduce((s, t) => s + t.volume, 0);
    const avgP = totalCost / totalVol;
    pendingTrade = {
      entries: recentBuys.map(t => ({ price: t.price, volume: t.volume, time: t.timestamp || t.time })),
      avgPrice: avgP,
      totalVolume: netBtc,
      peakPrice: Math.max(...recentBuys.map(t => t.price)),
      state: null,
      action: 'BUY',
      indicators: null,
    };
    savePosition(pendingTrade);
    console.log(`[포지션 재구성] trades.json 기반 | 평균진입 $${avgP.toFixed(0)} | 총 ${netBtc.toFixed(6)} BTC | ${recentBuys.length}회 진입`);
  }
}

async function executeTrade(isBuy, volume, currentPrice, signal, votes, currentState, indicators) {
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
    if (!pendingTrade) {
      // 신규 포지션
      pendingTrade = {
        entries: [{ price: currentPrice, volume, time: new Date().toISOString() }],
        avgPrice: currentPrice,
        totalVolume: volume,
        peakPrice: currentPrice,
        state: currentState,
        action: 'BUY',
        indicators: indicators || null,
      };
    } else {
      // 물타기 / 불타기 추가 진입
      pendingTrade.entries.push({ price: currentPrice, volume, time: new Date().toISOString() });
      const { avgPrice, totalVolume } = recalcPosition(pendingTrade.entries);
      pendingTrade.avgPrice = avgPrice;
      pendingTrade.totalVolume = totalVolume;
      console.log(`[평균단가] $${avgPrice.toFixed(0)} | 총 보유 ${totalVolume.toFixed(8)} BTC (${pendingTrade.entries.length}회 진입)`);
    }
    savePosition(pendingTrade);
    const params2 = getParams();
    // 손절선: 평균 진입가 기준
    saveState({ stopLossPrice: pendingTrade.avgPrice * (1 - params2.stopLossPct) });
  } else {
    // SELL: 학습 업데이트 (평균 진입가 기준 PnL)
    if (pendingTrade) {
      const avgP = pendingTrade.avgPrice || currentPrice;
      const pnlPct = (currentPrice - avgP) / avgP * 100;
      const outcome = pnlPct > 0 ? 'win' : 'loss';
      const entryCount = pendingTrade.entries?.length || 1;
      console.log(`[결과] 평균진입 $${avgP.toFixed(0)} → 청산 $${currentPrice.toLocaleString()} | PnL: ${pnlPct.toFixed(2)}% | ${entryCount}회 진입 (${outcome})`);

      if (pendingTrade.indicators) updateWeights(pendingTrade.indicators, 'BUY', outcome);

      // Q-Learning 리워드: PnL에 진입 횟수 패널티 포함 (3Commas/arXiv 기반)
      const entryPenalty = Math.max(0, entryCount - 2) * -1.0; // 3회 초과 시 패널티
      qUpdate(pendingTrade.state, pendingTrade.action, pnlPct + entryPenalty, currentState);
    }
    pendingTrade = null;
    if (require('fs').existsSync(POSITION_FILE)) require('fs').unlinkSync(POSITION_FILE);
    saveState({ stopLossPrice: null });
  }

  return orderResult;
}

async function runCycle() {
  cycleCount++;
  console.log(`\n[${new Date().toISOString()}] 사이클 #${cycleCount}`);

  try {
    const balance = getBalance();
    const totalPortfolio = parseFloat(balance?.ZUSD || balance?.USD || 0); // 총자산 (USD+BTC)
    const startingBalance = balance?.startingBalance ?? 10000;
    const unrealizedPnl = balance?.unrealizedPnl ?? 0;
    const unrealizedPnlPct = balance?.unrealizedPnlPct ?? 0;

    const currentPrice = getTicker(PAIR);
    // 가용 USD = 총자산 - BTC 보유액 (페이퍼 모드에서 BTC 직접 조회 불가)
    const btcBalance = (pendingTrade ? (pendingTrade.totalVolume || 0) : 0);
    const btcHeldValue = btcBalance * (currentPrice || 0);
    const usdBalance = Math.max(0, (totalPortfolio || 0) - btcHeldValue);
    const safePnl = (typeof unrealizedPnl === 'number' && isFinite(unrealizedPnl)) ? unrealizedPnl : 0;
    console.log(`[잔고] 가용USD: $${usdBalance.toFixed(2)} | BTC: ${btcBalance.toFixed(6)} ($${btcHeldValue.toFixed(0)}) | 총: ${(totalPortfolio||0).toFixed(2)} | PnL: ${safePnl >= 0 ? '+' : ''}$${safePnl.toFixed(2)}`);

    if (totalPortfolio < 1) {
      saveState({ status: 'warning', balance: { usd: usdBalance, btc: btcBalance, totalUsd: totalPortfolio } });
      return;
    }

    const totalUSD = totalPortfolio;
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
      openPosition: pendingTrade ? (() => {
        const avgP = pendingTrade.avgPrice || currentPrice;
        return {
          avgPrice: avgP,
          totalVolume: pendingTrade.totalVolume || 0,
          entryCount: pendingTrade.entries?.length || 1,
          peakPrice: pendingTrade.peakPrice || avgP,
          pnlPct: (((currentPrice - avgP) / avgP) * 100).toFixed(2),
        };
      })() : null,
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

    // 손절 체크 (평균 진입가 기준)
    if (pendingTrade) {
      const stopLoss = pendingTrade.avgPrice * (1 - params.stopLossPct);
      if (currentPrice <= stopLoss) {
        console.log(`[손절] $${currentPrice.toLocaleString()} <= 손절선 $${stopLoss.toLocaleString()} (평균진입 $${pendingTrade.avgPrice.toFixed(0)})`);
        await executeTrade(false, pendingTrade.totalVolume, currentPrice, 'STOP_LOSS', votes, qState);
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

    // 최고가 업데이트 (불타기 트레일링 스탑용)
    if (pendingTrade && currentPrice > (pendingTrade.peakPrice || 0)) {
      pendingTrade.peakPrice = currentPrice;
    }

    if (!pendingTrade && finalSignal === 'BUY' && usdBalance > 100) {
      // ① 신규 진입
      volume = atrVolume; isBuy = true; shouldTrade = true;

    } else if (pendingTrade && finalSignal === 'BUY') {
      // ② 물타기 / 불타기 체크
      const pyramidEntry = checkPyramidEntry(currentPrice);
      if (pyramidEntry && usdBalance > 100) {
        // 최대 포지션 50% 제한 확인
        const newTotalUsd = (pendingTrade.totalVolume + pyramidEntry.volume) * currentPrice;
        if (newTotalUsd / startingBalance <= PYRAMID.MAX_POSITION_PCT) {
          volume = pyramidEntry.volume; isBuy = true; shouldTrade = true;
        } else {
          console.log(`[포지션 한도] 총 ${(newTotalUsd/startingBalance*100).toFixed(0)}% > 50% 제한 → 추가 매수 차단`);
        }
      } else if (!pyramidEntry) {
        console.log(`[포지션 유지] 평균진입 $${pendingTrade.avgPrice?.toFixed(0)} | ${pendingTrade.entries.length}회 진입 | 변동없음`);
      }

    } else if (pendingTrade && finalSignal === 'SELL') {
      // ③ 전량 청산
      volume = pendingTrade.totalVolume || atrVolume;
      isBuy = false; shouldTrade = true;
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

    await executeTrade(isBuy, finalVolume, currentPrice, finalSignal, votes, qState, detail);

  } catch (err) {
    console.error('[에러]', err.message);
    console.error('[스택]', err.stack?.split('\n').slice(0, 4).join(' | '));
    saveState({ status: 'error' });
  }
}

console.log(`AI 트레이딩 에이전트 v4 시작 [${PAPER_MODE ? '페이퍼' : '실거래'} | ERC-8004: ${ONCHAIN_ENABLED ? 'ON' : 'OFF'}]`);
console.log('[전략] 가중치 투표 + Q-Learning + 자동 파라미터 튜닝 + 200 EMA + 손절');
runCycle();
setInterval(runCycle, INTERVAL_MS);
