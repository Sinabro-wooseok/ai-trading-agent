// MACD (Moving Average Convergence Divergence) 전략
// MACD 라인이 시그널 라인을 상향 돌파 → 매수
// MACD 라인이 시그널 라인을 하향 돌파 → 매도

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcMACD(closes) {
  if (closes.length < 35) return null;

  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (!ema12 || !ema26) return null;

  const macdLine = ema12 - ema26;

  // 시그널: MACD 라인의 9일 EMA (근사값)
  const recentMacds = [];
  for (let i = closes.length - 9; i < closes.length; i++) {
    const e12 = calcEMA(closes.slice(0, i + 1), 12);
    const e26 = calcEMA(closes.slice(0, i + 1), 26);
    if (e12 && e26) recentMacds.push(e12 - e26);
  }

  const signalLine = recentMacds.reduce((a, b) => a + b) / recentMacds.length;
  const histogram = macdLine - signalLine;

  return { macdLine, signalLine, histogram };
}

function getMACDSignal(closes) {
  const result = calcMACD(closes);
  if (!result) return { signal: 'HOLD', macd: null };

  const { macdLine, signalLine, histogram } = result;

  // MACD가 시그널을 상향 돌파 (양수 히스토그램 & MACD < 0 → 강한 매수)
  if (histogram > 0 && macdLine < 0) return { signal: 'BUY', macd: result };
  // MACD가 시그널을 하향 돌파 (음수 히스토그램 & MACD > 0 → 강한 매도)
  if (histogram < 0 && macdLine > 0) return { signal: 'SELL', macd: result };

  return { signal: 'HOLD', macd: result };
}

module.exports = { calcMACD, getMACDSignal };
