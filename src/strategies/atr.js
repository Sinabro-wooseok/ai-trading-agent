// ATR (Average True Range) - 변동성 기반 포지션 사이징
// 변동성 높을수록 포지션 크기 감소
// ATR 기반 손절가 계산

function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const prevClose = parseFloat(candles[i - 1].close);
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  const recent = trueRanges.slice(-period);
  return recent.reduce((a, b) => a + b) / period;
}

// ATR 기반 포지션 크기 계산
// 계좌의 1% 리스크, ATR의 2배를 손절폭으로 사용
function calcATRPositionSize(balanceUSD, currentPrice, atr, riskPct = 0.01, atrMultiplier = 2) {
  const riskUSD = balanceUSD * riskPct;
  const stopLossDistance = atr * atrMultiplier;
  const positionUSD = (riskUSD / stopLossDistance) * currentPrice;
  return Math.min(positionUSD, balanceUSD * 0.1) / currentPrice; // 최대 10% 제한
}

// ATR 기반 손절가
function calcATRStopLoss(entryPrice, atr, isBuy, multiplier = 2) {
  if (isBuy) return entryPrice - atr * multiplier;
  return entryPrice + atr * multiplier;
}

module.exports = { calcATR, calcATRPositionSize, calcATRStopLoss };
