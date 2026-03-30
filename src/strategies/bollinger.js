// 볼린저 밴드 전략
// 가격이 하단 밴드 이하 → 매수 시그널
// 가격이 상단 밴드 이상 → 매도 시그널

function calcBollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) return null;

  const recent = closes.slice(-period);
  const sma = recent.reduce((a, b) => a + b) / period;
  const variance = recent.reduce((sum, v) => sum + Math.pow(v - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: sma + multiplier * stdDev,
    middle: sma,
    lower: sma - multiplier * stdDev,
    stdDev,
  };
}

function getBollingerSignal(closes) {
  const bands = calcBollinger(closes);
  if (!bands) return { signal: 'HOLD', bands: null };

  const currentPrice = closes[closes.length - 1];
  const { upper, lower, middle } = bands;

  if (currentPrice <= lower) return { signal: 'BUY', bands };
  if (currentPrice >= upper) return { signal: 'SELL', bands };

  return { signal: 'HOLD', bands };
}

module.exports = { calcBollinger, getBollingerSignal };
