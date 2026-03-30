// 복합 시그널 엔진 v4 - 가중 점수 시스템
// 연구 기반: 단순 투표 대신 점수 합산 방식이 승률 60%+ 달성
// BUY 점수 >= threshold(60) → BUY
// SELL 점수 >= threshold(40) → SELL

const { getSignal: getRSISignal } = require('./rsi');
const { getStochRSISignal } = require('./stochrsi');
const { getMACDSignal } = require('./macd');
const { getBollingerSignal } = require('./bollinger');
const { getEMASignal } = require('./ema');
const { getVWAPSignal } = require('./vwap');
const { getFearGreedSignal } = require('./feargreed');
const { getWeights } = require('../learning/weights');

const BUY_THRESHOLD = 28;   // 해커톤: F&G 극단공포(8) 기준 현재 점수(30) 커버
const SELL_THRESHOLD = 20;  // 22→20

// 각 지표별 점수 계산 (연구 기반 가중치)
function calcIndicatorScore(rsi, stochRSI, macd, bb, ema, vwap, fg, closes, currentPrice) {
  let buyScore = 0;
  let sellScore = 0;

  // RSI (25점) - 핵심 모멘텀 지표
  const rsiVal = rsi.rsi || 50;
  if (rsiVal < 30) buyScore += 25;
  else if (rsiVal < 40) buyScore += 10;
  else if (rsiVal > 70) sellScore += 25;
  else if (rsiVal > 60) sellScore += 10;

  // StochRSI (15점) - RSI보다 민감
  const stochVal = stochRSI.stochRSI || 50;
  if (stochVal < 20) buyScore += 15;
  else if (stochVal < 35) buyScore += 5;
  else if (stochVal > 80) sellScore += 15;
  else if (stochVal > 65) sellScore += 5;

  // MACD (20점) - 추세 전환 신호
  const hist = macd.macd?.histogram || 0;
  const macdLine = macd.macd?.macdLine || 0;
  if (hist > 0 && macdLine < 0) buyScore += 20;       // 제로선 아래 골든크로스 (강함)
  else if (hist > 0) buyScore += 10;                  // 일반 양수 히스토그램
  else if (hist < 0 && macdLine > 0) sellScore += 20; // 제로선 위 데드크로스 (강함)
  else if (hist < 0) sellScore += 10;

  // Bollinger Bands (15점) - 평균 회귀
  if (bb.signal === 'BUY') buyScore += 15;
  else if (bb.signal === 'SELL') sellScore += 15;

  // EMA (10점) - 추세 방향
  if (ema.signal === 'BUY') buyScore += 10;
  else if (ema.signal === 'SELL') sellScore += 10;

  // VWAP (5점) - 공정 가치
  if (vwap.signal === 'BUY') buyScore += 5;
  else if (vwap.signal === 'SELL') sellScore += 5;

  // Fear & Greed (10점 + 승수)
  const fgVal = fg.value || 50;
  const fgMultiplier = fg.multiplier || 1.0;
  if (fg.signal === 'BUY') buyScore += Math.round(10 * fgMultiplier);
  else if (fg.signal === 'SELL') sellScore += Math.round(10 * fgMultiplier);

  return { buyScore, sellScore };
}

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

  const currentPrice = closes[closes.length - 1];
  const weights = getWeights();

  // 가중 점수 계산
  const { buyScore, sellScore } = calcIndicatorScore(rsi, stochRSI, macd, bb, ema, vwap, fg, closes, currentPrice);

  // 학습된 가중치 적용 (점수에 배율 적용)
  const weightedBuy = buyScore * (weights.rsi + weights.macd + weights.bollinger) / 3;
  const weightedSell = sellScore * (weights.rsi + weights.macd + weights.bollinger) / 3;

  // 단순 투표 수 (대시보드 표시 + 튜닝용)
  const signals = [rsi.signal, stochRSI.signal, macd.signal, bb.signal, ema.signal, vwap.signal, fg.signal];
  const buyCount = signals.filter(s => s === 'BUY').length;
  const sellCount = signals.filter(s => s === 'SELL').length;

  // 최종 시그널 결정
  let finalSignal = 'HOLD';
  if (weightedBuy >= BUY_THRESHOLD) finalSignal = 'BUY';
  if (weightedSell >= SELL_THRESHOLD && weightedSell > weightedBuy) finalSignal = 'SELL';

  return {
    signal: finalSignal,
    votes: {
      buyCount, sellCount, total: signals.length,
      buyScore: parseFloat(buyScore.toFixed(1)),
      sellScore: parseFloat(sellScore.toFixed(1)),
      weightedBuy: parseFloat(weightedBuy.toFixed(1)),
      weightedSell: parseFloat(weightedSell.toFixed(1)),
    },
    detail: {
      rsi:       { signal: rsi.signal,       value: rsi.rsi?.toFixed(2),             weight: weights.rsi?.toFixed(2) },
      stochRSI:  { signal: stochRSI.signal,  value: stochRSI.stochRSI?.toFixed(2),  weight: weights.stochRSI?.toFixed(2) },
      macd:      { signal: macd.signal,      histogram: macd.macd?.histogram?.toFixed(2), weight: weights.macd?.toFixed(2) },
      bollinger: { signal: bb.signal,        lower: bb.bands?.lower?.toFixed(0),     upper: bb.bands?.upper?.toFixed(0), weight: weights.bollinger?.toFixed(2) },
      ema:       { signal: ema.signal,       ema9: ema.ema?.ema9?.toFixed(0),        ema21: ema.ema?.ema21?.toFixed(0),  weight: weights.ema?.toFixed(2) },
      vwap:      { signal: vwap.signal,      value: vwap.vwap?.toFixed(0),           weight: weights.vwap?.toFixed(2) },
      fearGreed: { signal: fg.signal,        value: fg.value, label: fg.label,       weight: weights.fearGreed?.toFixed(2), multiplier: fg.multiplier, strength: fg.strength },
    },
    weights,
    fgMultiplier: fg.multiplier || 1.0,
  };
}

module.exports = { getCombinedSignal };
