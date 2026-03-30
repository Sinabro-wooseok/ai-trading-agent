// RSI(Relative Strength Index) 기반 트레이딩 전략
// RSI < 30 → 과매도 → 매수 시그널
// RSI > 70 → 과매수 → 매도 시그널

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? Math.abs(c) : 0));

  // 최근 period개 변화량 사용 (앞 14개 버그 수정)
  const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// OHLC 데이터에서 종가 배열 추출
function extractCloses(ohlcData) {
  return ohlcData.map(candle => parseFloat(candle.close));
}

// 시그널 판단
function getSignal(closes) {
  const rsi = calcRSI(closes);
  if (rsi === null) return { signal: 'HOLD', rsi: null };

  if (rsi < 30) return { signal: 'BUY', rsi };
  if (rsi > 70) return { signal: 'SELL', rsi };
  return { signal: 'HOLD', rsi };
}

module.exports = { calcRSI, extractCloses, getSignal };
