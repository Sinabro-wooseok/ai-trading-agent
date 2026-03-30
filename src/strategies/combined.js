// 복합 시그널 엔진 v2
// RSI + StochRSI + MACD + 볼린저 + EMA + VWAP + Fear&Greed
// 투표 방식: 과반수(4/7) 이상 동일 시그널 → 실행

const { getSignal: getRSISignal } = require('./rsi');
const { getStochRSISignal } = require('./stochrsi');
const { getMACDSignal } = require('./macd');
const { getBollingerSignal } = require('./bollinger');
const { getEMASignal } = require('./ema');
const { getVWAPSignal } = require('./vwap');
const { getFearGreedSignal } = require('./feargreed');

async function getCombinedSignal(closes, candles) {
  const [rsi, stochRSI, macd, bb, ema, vwap, fg] = await Promise.all([
    Promise.resolve(getRSISignal(closes)),
    Promise.resolve(getStochRSISignal(closes)),
    Promise.resolve(getMACDSignal(closes)),
    Promise.resolve(getBollingerSignal(closes)),
    Promise.resolve(getEMASignal(closes)),
    Promise.resolve(getVWAPSignal(candles)),
    getFearGreedSignal(),
  ]);

  const signals = [rsi.signal, stochRSI.signal, macd.signal, bb.signal, ema.signal, vwap.signal, fg.signal];
  const buyCount = signals.filter(s => s === 'BUY').length;
  const sellCount = signals.filter(s => s === 'SELL').length;

  // 7개 중 3개 이상 동일 방향 → 실행 (너무 엄격하면 거래 기회 없음)
  let finalSignal = 'HOLD';
  if (buyCount >= 3) finalSignal = 'BUY';
  if (sellCount >= 3) finalSignal = 'SELL';

  return {
    signal: finalSignal,
    votes: { buyCount, sellCount, total: signals.length },
    detail: {
      rsi:       { signal: rsi.signal,       value: rsi.rsi?.toFixed(2) },
      stochRSI:  { signal: stochRSI.signal,  value: stochRSI.stochRSI?.toFixed(2) },
      macd:      { signal: macd.signal,      histogram: macd.macd?.histogram?.toFixed(2) },
      bollinger: { signal: bb.signal,        lower: bb.bands?.lower?.toFixed(0), upper: bb.bands?.upper?.toFixed(0) },
      ema:       { signal: ema.signal,       ema9: ema.ema?.ema9?.toFixed(0), ema21: ema.ema?.ema21?.toFixed(0) },
      vwap:      { signal: vwap.signal,      value: vwap.vwap?.toFixed(0) },
      fearGreed: { signal: fg.signal,        value: fg.value, label: fg.label },
    },
  };
}

module.exports = { getCombinedSignal };
