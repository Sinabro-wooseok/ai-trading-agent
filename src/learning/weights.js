// 레벨 1: 적응형 지표 가중치
// 각 지표의 예측 정확도를 추적하여 가중치 자동 조정
// 잘 맞춘 지표 → 가중치 증가, 틀린 지표 → 가중치 감소

const fs = require('fs');
const path = require('path');

const WEIGHTS_FILE = path.join(__dirname, '../../data/weights.json');
const LEARNING_RATE = 0.15;
const MIN_WEIGHT = 0.2;
const MAX_WEIGHT = 3.0;

const INDICATORS = ['rsi', 'stochRSI', 'macd', 'bollinger', 'ema', 'vwap', 'fearGreed'];

function loadWeights() {
  if (fs.existsSync(WEIGHTS_FILE)) {
    try { return JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf8')); } catch {}
  }
  // 초기 균등 가중치
  const init = {};
  INDICATORS.forEach(k => { init[k] = 1.0; });
  return init;
}

function saveWeights(weights) {
  fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(weights, null, 2));
}

// 거래 결과에 따라 가중치 업데이트
// side: 'BUY' | 'SELL', outcome: 'win' | 'loss', indicators: 지표별 {signal}
function updateWeights(indicators, side, outcome) {
  const weights = loadWeights();
  const log = [];

  for (const name of INDICATORS) {
    const indSignal = indicators[name]?.signal;
    if (!indSignal) continue;

    // 이 지표가 올바른 방향을 예측했는지 판단
    const predictedSide = indSignal; // BUY, SELL, HOLD
    const correct =
      (outcome === 'win' && predictedSide === side) ||
      (outcome === 'loss' && predictedSide !== side && predictedSide !== 'HOLD');

    const before = weights[name];
    if (correct) {
      weights[name] = Math.min(weights[name] * (1 + LEARNING_RATE), MAX_WEIGHT);
    } else if (predictedSide !== 'HOLD') {
      weights[name] = Math.max(weights[name] * (1 - LEARNING_RATE), MIN_WEIGHT);
    }

    if (Math.abs(weights[name] - before) > 0.01) {
      log.push(`${name}: ${before.toFixed(2)} → ${weights[name].toFixed(2)} (${correct ? '+' : '-'})`);
    }
  }

  saveWeights(weights);
  if (log.length) console.log(`[가중치 학습] ${log.join(', ')}`);
  return weights;
}

function getWeights() {
  return loadWeights();
}

// 가중치 기반 투표: 단순 카운트 대신 가중합
function weightedVote(indicators, weights) {
  let buyScore = 0, sellScore = 0, totalWeight = 0;

  for (const name of INDICATORS) {
    const w = weights[name] || 1.0;
    const sig = indicators[name]?.signal;
    totalWeight += w;
    if (sig === 'BUY') buyScore += w;
    else if (sig === 'SELL') sellScore += w;
  }

  return { buyScore, sellScore, totalWeight };
}

module.exports = { getWeights, updateWeights, weightedVote, INDICATORS };
