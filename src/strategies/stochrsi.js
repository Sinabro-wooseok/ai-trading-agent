// Stochastic RSI - RSI보다 민감, 거짓 신호 감소
// StochRSI < 20 → 과매도 → 매수
// StochRSI > 80 → 과매수 → 매도

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));
  const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcStochRSI(closes, rsiPeriod = 14, stochPeriod = 14) {
  if (closes.length < rsiPeriod + stochPeriod + 1) return null;

  // RSI 시계열 계산
  const rsiSeries = [];
  for (let i = rsiPeriod; i <= closes.length; i++) {
    const rsi = calcRSI(closes.slice(0, i), rsiPeriod);
    if (rsi !== null) rsiSeries.push(rsi);
  }

  if (rsiSeries.length < stochPeriod) return null;

  const recent = rsiSeries.slice(-stochPeriod);
  const minRSI = Math.min(...recent);
  const maxRSI = Math.max(...recent);

  if (maxRSI === minRSI) return 50;
  return ((rsiSeries[rsiSeries.length - 1] - minRSI) / (maxRSI - minRSI)) * 100;
}

function getStochRSISignal(closes) {
  const stochRSI = calcStochRSI(closes);
  if (stochRSI === null) return { signal: 'HOLD', stochRSI: null };

  if (stochRSI < 20) return { signal: 'BUY', stochRSI };
  if (stochRSI > 80) return { signal: 'SELL', stochRSI };
  return { signal: 'HOLD', stochRSI };
}

module.exports = { calcStochRSI, getStochRSISignal };
