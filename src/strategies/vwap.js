// VWAP (Volume Weighted Average Price)
// 거래량 가중 평균 가격 - 공정 가치 기준선
// 가격이 VWAP 아래에서 위로 돌파 → 매수
// 가격이 VWAP 위에서 아래로 붕괴 → 매도

function calcVWAP(candles) {
  // candles: [{close, high, low, volume}]
  if (!candles || candles.length === 0) return null;

  let totalVolume = 0;
  let totalTPV = 0; // typical price * volume

  for (const c of candles) {
    const typicalPrice = (parseFloat(c.high) + parseFloat(c.low) + parseFloat(c.close)) / 3;
    const vol = parseFloat(c.volume) || 1;
    totalTPV += typicalPrice * vol;
    totalVolume += vol;
  }

  return totalVolume > 0 ? totalTPV / totalVolume : null;
}

function getVWAPSignal(candles) {
  const vwap = calcVWAP(candles);
  if (!vwap) return { signal: 'HOLD', vwap: null };

  const currentPrice = parseFloat(candles[candles.length - 1].close);
  const prevPrice = parseFloat(candles[candles.length - 2]?.close || currentPrice);

  // 돌파 감지: 이전 캔들은 VWAP 아래, 현재는 위 → 매수
  if (prevPrice < vwap && currentPrice >= vwap) return { signal: 'BUY', vwap };
  // 붕괴 감지: 이전 캔들은 VWAP 위, 현재는 아래 → 매도
  if (prevPrice > vwap && currentPrice <= vwap) return { signal: 'SELL', vwap };

  return { signal: 'HOLD', vwap };
}

module.exports = { calcVWAP, getVWAPSignal };
