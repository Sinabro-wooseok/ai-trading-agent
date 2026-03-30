// 레벨 2: Q-Learning 강화학습 (개선판)
// 상태: RSI × MACD × 추세 × Fear&Greed = 54가지
// 행동: BUY / HOLD / SELL
// 보상: Sharpe Ratio 기반 (단순 PnL보다 리스크 조정)
// 개선: HOLD 패널티 적용 → HOLD 편향 해소

const fs = require('fs');
const path = require('path');

const QTABLE_FILE = path.join(__dirname, '../../data/qtable.json');
const ALPHA = 0.1;
const GAMMA = 0.9;
const EPSILON_START = 0.3;
const EPSILON_MIN = 0.05;
const EPSILON_DECAY = 0.995;
const HOLD_PENALTY = -0.05;   // HOLD 기회비용 패널티 (연구 기반)
const MAX_HISTORY = 20;       // Sharpe 계산용 최근 N개 수익률

const ACTIONS = ['BUY', 'HOLD', 'SELL'];

function loadTable() {
  if (fs.existsSync(QTABLE_FILE)) {
    try { return JSON.parse(fs.readFileSync(QTABLE_FILE, 'utf8')); } catch {}
  }
  return { table: {}, epsilon: EPSILON_START, totalUpdates: 0, returnHistory: [] };
}

function saveTable(data) {
  fs.writeFileSync(QTABLE_FILE, JSON.stringify(data));
}

// Sharpe Ratio 기반 보상 계산
// 단순 PnL보다 리스크 조정 수익률로 학습 품질 향상
function calcSharpeReward(pnlPct, returnHistory) {
  const history = [...returnHistory, pnlPct].slice(-MAX_HISTORY);
  if (history.length < 3) return pnlPct;

  const mean = history.reduce((a, b) => a + b) / history.length;
  const variance = history.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / history.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev < 0.001) return pnlPct; // 변동성 없을 때 PnL 그대로 사용
  return mean / stdDev; // Sharpe Ratio
}

// 상태 벡터 → 상태 키
function buildState(indicators, regime) {
  const rsiVal = parseFloat(indicators.rsi?.value || 50);
  const macdHist = parseFloat(indicators.macd?.histogram || 0);
  const fgVal = parseInt(indicators.fearGreed?.value || 50);

  const rsiBucket = rsiVal < 35 ? 0 : rsiVal > 65 ? 2 : 1;
  const macdSign = macdHist >= 0 ? 1 : 0;
  const regimeBucket = regime === 'bull' ? 2 : regime === 'bear' ? 0 : 1;
  const fgBucket = fgVal < 20 ? 0 : fgVal > 80 ? 2 : 1; // 임계값 강화: 35→20, 65→80

  return `r${rsiBucket}_m${macdSign}_t${regimeBucket}_f${fgBucket}`;
}

// epsilon-greedy 행동 선택
function getAction(state, allowedActions = ACTIONS) {
  const data = loadTable();
  const { table, epsilon } = data;

  if (Math.random() < epsilon) {
    return allowedActions[Math.floor(Math.random() * allowedActions.length)];
  }

  if (!table[state]) return 'HOLD';
  const qRow = table[state];
  let best = 'HOLD', bestQ = -Infinity;
  for (const a of allowedActions) {
    const q = qRow[a] ?? 0;
    if (q > bestQ) { bestQ = q; best = a; }
  }
  return best;
}

// Q-Table 업데이트 (Sharpe Reward + HOLD 패널티)
function update(prevState, action, rawPnlPct, nextState) {
  const data = loadTable();
  const { table } = data;

  if (!data.returnHistory) data.returnHistory = [];

  // Sharpe Ratio 기반 보상
  let reward = calcSharpeReward(rawPnlPct, data.returnHistory);

  // HOLD 패널티: 아무것도 안 하면 기회비용 차감
  if (action === 'HOLD') reward += HOLD_PENALTY;

  // 수익률 히스토리 업데이트
  if (action !== 'HOLD') {
    data.returnHistory = [...data.returnHistory, rawPnlPct].slice(-MAX_HISTORY);
  }

  if (!table[prevState]) table[prevState] = { BUY: 0, HOLD: 0, SELL: 0 };
  if (!table[nextState]) table[nextState] = { BUY: 0, HOLD: 0, SELL: 0 };

  const maxNextQ = Math.max(...Object.values(table[nextState]));
  const oldQ = table[prevState][action] ?? 0;
  table[prevState][action] = oldQ + ALPHA * (reward + GAMMA * maxNextQ - oldQ);

  data.epsilon = Math.max(EPSILON_MIN, data.epsilon * EPSILON_DECAY);
  data.totalUpdates = (data.totalUpdates || 0) + 1;

  saveTable(data);

  console.log(`[Q-학습] ${prevState} | ${action} | PnL:${rawPnlPct.toFixed(2)}% Sharpe보상:${reward.toFixed(3)} Q:${oldQ.toFixed(3)}→${table[prevState][action].toFixed(3)} ε:${data.epsilon.toFixed(3)}`);
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
