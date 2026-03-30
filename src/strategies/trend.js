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
// fearGreedValue: F&G 지수 (극단 공포 시 BEAR에서도 BUY 허용)
function applyTrendFilter(signal, regime, fearGreedValue = 50) {
  if (regime === 'neutral') return signal;

  // 극단 공포(F&G<=20) → 역발상 BUY 허용 (BEAR 예외)
  // 연구: F&G 극단 공포는 역사적으로 멀티월 랠리 선행 (2018년 이후 예외 없음)
  if (signal === 'BUY' && regime === 'bear') {
    if (fearGreedValue <= 20) return signal;
    return 'HOLD';
  }

  if (signal === 'SELL' && regime === 'bull') return 'HOLD';
  return signal;
}

module.exports = { getMarketRegime, applyTrendFilter };
