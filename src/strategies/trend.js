// 200 EMA 시장 추세 필터
// 가격 > 200 EMA → 상승장 (BUY만 허용)
// 가격 < 200 EMA → 하락장 (SELL만 허용)

const { calcEMA } = require('./ema');

function getMarketRegime(closes, currentPrice) {
  if (closes.length < 200) return { regime: 'neutral', ema200: null };

  const ema200 = calcEMA(closes, 200);
  if (!ema200) return { regime: 'neutral', ema200: null };

  const regime = currentPrice > ema200 ? 'bull' : 'bear';
  return { regime, ema200 };
}

// 추세 필터: 시그널이 시장 방향과 맞는지 확인
function applyTrendFilter(signal, regime) {
  if (regime === 'neutral') return signal;
  if (signal === 'BUY' && regime === 'bear') return 'HOLD';
  if (signal === 'SELL' && regime === 'bull') return 'HOLD';
  return signal;
}

module.exports = { getMarketRegime, applyTrendFilter };
