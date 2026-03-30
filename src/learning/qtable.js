// 레벨 2: Q-Learning 강화학습
// 상태: RSI 구간 × MACD 방향 × 시장 추세 × Fear&Greed 구간 = 54가지
// 행동: BUY(0) / HOLD(1) / SELL(2)
// 보상: 거래 후 PnL %
// Q(s,a) ← Q(s,a) + α * (r + γ * max Q(s',a') - Q(s,a))

const fs = require('fs');
const path = require('path');

const QTABLE_FILE = path.join(__dirname, '../../data/qtable.json');
const ALPHA = 0.1;   // 학습률
const GAMMA = 0.9;   // 할인율
const EPSILON_START = 0.3;  // 탐색률 (처음엔 30% 무작위)
const EPSILON_MIN = 0.05;   // 최소 탐색률
const EPSILON_DECAY = 0.995;

const ACTIONS = ['BUY', 'HOLD', 'SELL'];

function loadTable() {
  if (fs.existsSync(QTABLE_FILE)) {
    try { return JSON.parse(fs.readFileSync(QTABLE_FILE, 'utf8')); } catch {}
  }
  return { table: {}, epsilon: EPSILON_START, totalUpdates: 0 };
}

function saveTable(data) {
  fs.writeFileSync(QTABLE_FILE, JSON.stringify(data));
}

// 상태 벡터 → 상태 키 문자열
function buildState(indicators, regime, currentPrice) {
  const rsiVal = parseFloat(indicators.rsi?.value || 50);
  const macdHist = parseFloat(indicators.macd?.histogram || 0);
  const fgVal = parseInt(indicators.fearGreed?.value || 50);

  const rsiBucket = rsiVal < 35 ? 0 : rsiVal > 65 ? 2 : 1;         // 과매도/중립/과매수
  const macdSign = macdHist >= 0 ? 1 : 0;                           // 양수/음수
  const regimeBucket = regime === 'bull' ? 2 : regime === 'bear' ? 0 : 1;
  const fgBucket = fgVal < 35 ? 0 : fgVal > 65 ? 2 : 1;            // 공포/중립/탐욕

  return `r${rsiBucket}_m${macdSign}_t${regimeBucket}_f${fgBucket}`;
}

// epsilon-greedy 행동 선택
function getAction(state, allowedActions = ACTIONS) {
  const data = loadTable();
  const { table, epsilon } = data;

  if (Math.random() < epsilon) {
    // 탐색: 허용된 행동 중 무작위
    return allowedActions[Math.floor(Math.random() * allowedActions.length)];
  }

  // 활용: Q값 최대 행동
  if (!table[state]) return 'HOLD';
  const qRow = table[state];
  let best = 'HOLD', bestQ = -Infinity;
  for (const a of allowedActions) {
    const q = qRow[a] || 0;
    if (q > bestQ) { bestQ = q; best = a; }
  }
  return best;
}

// Q-Table 업데이트
function update(prevState, action, reward, nextState) {
  const data = loadTable();
  const { table } = data;

  if (!table[prevState]) table[prevState] = { BUY: 0, HOLD: 0, SELL: 0 };
  if (!table[nextState]) table[nextState] = { BUY: 0, HOLD: 0, SELL: 0 };

  const maxNextQ = Math.max(...Object.values(table[nextState]));
  const oldQ = table[prevState][action] || 0;
  table[prevState][action] = oldQ + ALPHA * (reward + GAMMA * maxNextQ - oldQ);

  // epsilon 감소
  data.epsilon = Math.max(EPSILON_MIN, data.epsilon * EPSILON_DECAY);
  data.totalUpdates = (data.totalUpdates || 0) + 1;

  saveTable(data);

  console.log(`[Q-학습] 상태:${prevState} 행동:${action} 보상:${reward.toFixed(2)}% Q:${oldQ.toFixed(3)}→${table[prevState][action].toFixed(3)} ε:${data.epsilon.toFixed(3)}`);
  return data;
}

function getStats() {
  const data = loadTable();
  return {
    epsilon: parseFloat((data.epsilon || EPSILON_START).toFixed(3)),
    totalUpdates: data.totalUpdates || 0,
    stateCount: Object.keys(data.table || {}).length,
  };
}

module.exports = { buildState, getAction, update, getStats, ACTIONS };
