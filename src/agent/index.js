require('dotenv').config();
const { getTicker, getBalance, getOHLC, buyMarket, sellMarket } = require('../utils/kraken');
const { extractCloses, getSignal } = require('../strategies/rsi');
const { canTrade, calcPositionSize, setDailyBaseline } = require('../risk/manager');

const PAIR = 'XBTUSD';
const INTERVAL_MS = 60 * 1000; // 1분마다 실행

async function runCycle() {
  console.log(`\n[${new Date().toISOString()}] 사이클 시작`);

  try {
    // 잔고 조회
    const balance = getBalance();
    const usdBalance = parseFloat(balance?.ZUSD || balance?.USD || 0);
    const btcBalance = parseFloat(balance?.XXBT || balance?.XBT || 0);
    console.log(`[잔고] USD: ${usdBalance}, BTC: ${btcBalance}`);

    if (usdBalance < 1 && btcBalance < 0.0001) {
      console.log('[경고] 잔고 부족 - 스킵');
      return;
    }

    // 일일 기준선 설정 (최초 1회)
    const ticker = getTicker(PAIR);
    const currentPrice = parseFloat(ticker?.[0]?.last || ticker?.last || 0);
    const totalUSD = usdBalance + btcBalance * currentPrice;
    setDailyBaseline(totalUSD);

    // 리스크 확인
    if (!canTrade(totalUSD)) {
      console.log('[리스크] 오늘 거래 중단');
      return;
    }

    // RSI 시그널 계산
    const ohlc = getOHLC(PAIR, 60);
    const closes = extractCloses(Array.isArray(ohlc) ? ohlc : []);
    const { signal, rsi } = getSignal(closes);

    console.log(`[시그널] RSI: ${rsi?.toFixed(2)} → ${signal} @ $${currentPrice}`);

    // 매매 실행
    if (signal === 'BUY' && usdBalance > 1) {
      const volume = calcPositionSize(usdBalance, currentPrice);
      console.log(`[매수] ${volume.toFixed(8)} BTC @ $${currentPrice}`);
      const result = buyMarket(PAIR, volume.toFixed(8));
      console.log('[주문 완료]', JSON.stringify(result));
    } else if (signal === 'SELL' && btcBalance > 0.0001) {
      const volume = Math.min(btcBalance, calcPositionSize(usdBalance + btcBalance * currentPrice, currentPrice));
      console.log(`[매도] ${volume.toFixed(8)} BTC @ $${currentPrice}`);
      const result = sellMarket(PAIR, volume.toFixed(8));
      console.log('[주문 완료]', JSON.stringify(result));
    } else {
      console.log('[대기] 시그널 없음');
    }

  } catch (err) {
    console.error('[에러]', err.message);
  }
}

// 에이전트 실행
console.log('AI 트레이딩 에이전트 시작');
runCycle();
setInterval(runCycle, INTERVAL_MS);
