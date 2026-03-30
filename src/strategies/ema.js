// EMA Crossover (9/21/50) 전략
// 9 EMA > 21 EMA > 50 EMA → 강한 상승 추세 → 매수
// 9 EMA < 21 EMA < 50 EMA → 강한 하락 추세 → 매도

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function getEMASignal(closes) {
  if (closes.length < 50) return { signal: 'HOLD', ema: null };

  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);

  if (!ema9 || !ema21 || !ema50) return { signal: 'HOLD', ema: null };

  const ema = { ema9, ema21, ema50 };

  // 강한 상승 정렬 + 직전 EMA 확인 (골든크로스)
  const prevEma9 = calcEMA(closes.slice(0, -1), 9);
  const prevEma21 = calcEMA(closes.slice(0, -1), 21);

  // 9 EMA가 21 EMA를 상향 돌파
  if (prevEma9 < prevEma21 && ema9 > ema21 && ema21 > ema50) {
    return { signal: 'BUY', ema };
  }

  // 9 EMA가 21 EMA를 하향 돌파
  if (prevEma9 > prevEma21 && ema9 < ema21 && ema21 < ema50) {
    return { signal: 'SELL', ema };
  }

  return { signal: 'HOLD', ema };
}

module.exports = { calcEMA, getEMASignal };
