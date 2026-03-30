// 복합 시그널 엔진 v3 - 적응형 가중치 투표
// RSI + StochRSI + MACD + 볼린저 + EMA + VWAP + Fear&Greed
// 가중치 기반 투표: 잘 맞춘 지표일수록 더 큰 영향력

const { getSignal: getRSISignal } = require('./rsi');
const { getStochRSISignal } = require('./stochrsi');
const { getMACDSignal } = require('./macd');
const { getBollingerSignal } = require('./bollinger');
const { getEMASignal } = require('./ema');
const { getVWAPSignal } = require('./vwap');
const { getFearGreedSignal } = require('./feargreed');
const { getWeights, weightedVote } = require('../learning/weights');

async function getCombinedSignal(closes, candles, threshold = 3) {
  const [rsi, stochRSI, macd, bb, ema, vwap, fg] = await Promise.all([
    Promise.resolve(getRSISignal(closes)),
    Promise.resolve(getStochRSISignal(closes)),
    Promise.resolve(getMACDSignal(closes)),
    Promise.resolve(getBollingerSignal(closes)),
    Promise.resolve(getEMASignal(closes)),
    Promise.resolve(getVWAPSignal(candles)),
    getFearGreedSignal(),
  ]);

  const indicators = { rsi, stochRSI, macd, bollinger: bb, ema, vwap, fearGreed: fg };
  const weights = getWeights();

  // 가중치 기반 투표
  const { buyScore, sellScore, totalWeight } = weightedVote(indicators, weights);

  // 단순 카운트도 병행 (대시보드 표시용)
  const signals = [rsi.signal, stochRSI.signal, macd.signal, bb.signal, ema.signal, vwap.signal, fg.signal];
  const buyCount = signals.filter(s => s === 'BUY').length;
  const sellCount = signals.filter(s => s === 'SELL').length;

  // 가중치 정규화 임계값: 총 가중치의 threshold/7 비율
  const normalizedThreshold = (threshold / 7) * totalWeight;

  let finalSignal = 'HOLD';
  if (buyScore >= normalizedThreshold) finalSignal = 'BUY';
  if (sellScore >= normalizedThreshold) finalSignal = 'SELL';
  // 양쪽 다 임계값 초과 시 더 높은 쪽 선택
  if (buyScore >= normalizedThreshold && sellScore >= normalizedThreshold) {
    finalSignal = buyScore >= sellScore ? 'BUY' : 'SELL';
  }

  return {
    signal: finalSignal,
    votes: { buyCount, sellCount, total: signals.length, buyScore: parseFloat(buyScore.toFixed(2)), sellScore: parseFloat(sellScore.toFixed(2)) },
    detail: {
      rsi:       { signal: rsi.signal,       value: rsi.rsi?.toFixed(2),            weight: weights.rsi?.toFixed(2) },
      stochRSI:  { signal: stochRSI.signal,  value: stochRSI.stochRSI?.toFixed(2), weight: weights.stochRSI?.toFixed(2) },
      macd:      { signal: macd.signal,      histogram: macd.macd?.histogram?.toFixed(2), weight: weights.macd?.toFixed(2) },
      bollinger: { signal: bb.signal,        lower: bb.bands?.lower?.toFixed(0),    upper: bb.bands?.upper?.toFixed(0), weight: weights.bollinger?.toFixed(2) },
      ema:       { signal: ema.signal,       ema9: ema.ema?.ema9?.toFixed(0),       ema21: ema.ema?.ema21?.toFixed(0),  weight: weights.ema?.toFixed(2) },
      vwap:      { signal: vwap.signal,      value: vwap.vwap?.toFixed(0),          weight: weights.vwap?.toFixed(2) },
      fearGreed: { signal: fg.signal,        value: fg.value,                       label: fg.label, weight: weights.fearGreed?.toFixed(2) },
    },
    weights,
  };
}

module.exports = { getCombinedSignal };
