require('dotenv').config();
const { ethers } = require('ethers');
const { getTicker, getBalance, getOHLC, buyMarket, sellMarket, PAPER_MODE } = require('../utils/kraken');
const { extractCloses } = require('../strategies/rsi');
const { getCombinedSignal } = require('../strategies/combined');
const { calcATR, calcATRPositionSize } = require('../strategies/atr');
const { canTrade, setDailyBaseline } = require('../risk/manager');
const { signTradeIntent } = require('../signing/eip712');
const { getMarketRegime, applyTrendFilter } = require('../strategies/trend');
const { saveState, saveTrade, savePricePoint } = require('./state');

const PAIR = 'XBTUSD';
const INTERVAL_MS = 60 * 1000; // 1분마다 실행
const STOP_LOSS_PCT = 0.03;    // 3% 손절
const TRADE_COOLDOWN_MS = 5 * 60 * 1000; // 거래 후 5분 쿨다운
let cycleCount = 0;
let lastTradeTime = 0;
let entryPrice = null; // 매수 진입가

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

async function executeTrade(isBuy, volume, currentPrice, signal, votes) {
  if (ONCHAIN_ENABLED) {
    const { signature } = await signTradeIntent({
      signer,
      validatorAddress: process.env.TRADE_VALIDATOR_ADDRESS,
      agentId: process.env.AGENT_ID || 1,
      pair: PAIR,
      volume,
      isBuy,
      price: currentPrice,
      nonce: tradeNonce,
    });
    tradeNonce++;
    console.log(`[ERC-8004] TradeIntent 서명 (nonce: ${tradeNonce - 1}) ${signature.slice(0, 20)}...`);
  }

  const side = isBuy ? '매수' : '매도';
  console.log(`[${side}] ${volume.toFixed(8)} BTC @ $${currentPrice.toLocaleString()} (ATR 기반 사이징)`);

  const orderResult = isBuy
    ? buyMarket(PAIR, volume.toFixed(8))
    : sellMarket(PAIR, volume.toFixed(8));

  console.log('[주문 완료]', JSON.stringify(orderResult));

  saveTrade({
    side: isBuy ? 'BUY' : 'SELL',
    pair: PAIR,
    volume: parseFloat(volume.toFixed(8)),
    price: currentPrice,
    usd: volume * currentPrice,
    signal,
    votes,
  });
  saveState({ lastTrade: { side: isBuy ? 'BUY' : 'SELL', price: currentPrice, volume, time: new Date().toISOString() } });
  lastTradeTime = Date.now();

  if (isBuy) {
    entryPrice = currentPrice;
    saveState({ stopLossPrice: currentPrice * (1 - STOP_LOSS_PCT) });
  } else {
    entryPrice = null;
    saveState({ stopLossPrice: null });
  }
}

async function runCycle() {
  cycleCount++;
  console.log(`\n[${new Date().toISOString()}] 사이클 시작 (#${cycleCount})`);

  try {
    // 잔고 조회
    const balance = getBalance();
    const usdBalance = parseFloat(balance?.ZUSD || balance?.USD || 0);
    const btcBalance = parseFloat(balance?.XXBT || balance?.XBT || 0);
    console.log(`[잔고] USD: $${usdBalance.toFixed(2)}, BTC: ${btcBalance.toFixed(6)}`);

    if (usdBalance < 1 && btcBalance < 0.0001) {
      console.log('[경고] 잔고 부족 - 스킵');
      saveState({ status: 'warning', balance: { usd: usdBalance, btc: btcBalance, totalUsd: 0 } });
      return;
    }

    const currentPrice = getTicker(PAIR);
    const totalUSD = usdBalance + btcBalance * currentPrice;
    setDailyBaseline(totalUSD);

    if (!canTrade(totalUSD)) {
      console.log('[리스크] 오늘 거래 중단');
      saveState({ status: 'halted', price: currentPrice, balance: { usd: usdBalance, btc: btcBalance, totalUsd: totalUSD } });
      return;
    }

    // OHLC 데이터 (캔들 포함)
    const candles = getOHLC(PAIR, 60);
    const closes = extractCloses(Array.isArray(candles) ? candles : []);

    // 200 EMA 추세 필터
    const { regime, ema200 } = getMarketRegime(closes, currentPrice);
    console.log(`[추세] ${regime.toUpperCase()} | EMA200: $${ema200 ? ema200.toFixed(0) : '--'}`);

    // 복합 시그널 계산 (7개 지표)
    const result = await getCombinedSignal(closes, candles);
    const { signal: rawSignal, votes, detail } = result;

    // 추세 필터 적용
    const signal = applyTrendFilter(rawSignal, regime);
    if (signal !== rawSignal) console.log(`[추세 필터] ${rawSignal} → HOLD (추세 반대)`);

    console.log(`[시그널] ${signal} (매수:${votes.buyCount} 매도:${votes.sellCount} / 7표)`);
    console.log(`  RSI:${detail.rsi.value} StochRSI:${detail.stochRSI.value} MACD:${detail.macd.histogram}`);
    console.log(`  EMA:${detail.ema.signal} VWAP:${detail.vwap.signal} F&G:${detail.fearGreed.value}(${detail.fearGreed.label})`);
    console.log(`  BTC: $${currentPrice.toLocaleString()}`);

    // ATR 기반 포지션 사이징
    const atr = calcATR(candles);
    const atrVolume = atr ? calcATRPositionSize(usdBalance, currentPrice, atr) : usdBalance * 0.05 / currentPrice;

    // 상태 저장 (대시보드용)
    saveState({
      status: 'running',
      cycle: cycleCount,
      price: currentPrice,
      signal,
      votes,
      indicators: detail,
      balance: { usd: usdBalance, btc: btcBalance, totalUsd: totalUSD },
      regime,
      ema200: ema200 ? parseFloat(ema200.toFixed(0)) : null,
      atr: atr ? parseFloat(atr.toFixed(2)) : null,
    });

    // 가격 히스토리 저장 (차트용)
    savePricePoint(currentPrice, signal, totalUSD);

    // 손절 체크: 매수 포지션이 있고 가격이 손절선 아래
    if (btcBalance > 0.0001 && entryPrice) {
      const stopLoss = entryPrice * (1 - STOP_LOSS_PCT);
      if (currentPrice <= stopLoss) {
        console.log(`[손절] 가격 $${currentPrice.toLocaleString()} <= 손절선 $${stopLoss.toLocaleString()}`);
        await executeTrade(false, btcBalance, currentPrice, 'STOP_LOSS', votes);
        return;
      }
    }

    // 쿨다운 체크
    if (Date.now() - lastTradeTime < TRADE_COOLDOWN_MS) {
      console.log(`[쿨다운] 마지막 거래 후 ${Math.round((Date.now() - lastTradeTime) / 1000)}초`);
      return;
    }

    let shouldTrade = false;
    let isBuy = false;
    let volume = 0;

    if (signal === 'BUY' && usdBalance > 1) {
      volume = atrVolume;
      isBuy = true;
      shouldTrade = true;
    } else if (signal === 'SELL' && btcBalance > 0.0001) {
      volume = Math.min(btcBalance, atrVolume);
      isBuy = false;
      shouldTrade = true;
    }

    if (!shouldTrade) {
      console.log('[대기] 시그널 없음');
      return;
    }

    await executeTrade(isBuy, volume, currentPrice, signal, votes);

  } catch (err) {
    console.error('[에러]', err.message);
    saveState({ status: 'error' });
  }
}

console.log(`AI 트레이딩 에이전트 v3 시작 [${PAPER_MODE ? '페이퍼' : '실거래'} | ERC-8004: ${ONCHAIN_ENABLED ? 'ON' : 'OFF'}]`);
console.log('[전략] RSI + StochRSI + MACD + 볼린저 + EMA(9/21/50/200) + VWAP + Fear&Greed + 손절 + 쿨다운');
runCycle();
setInterval(runCycle, INTERVAL_MS);
