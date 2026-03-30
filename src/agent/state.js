// 에이전트 상태 영속성 모듈
// 대시보드에서 읽을 수 있도록 JSON 파일로 저장

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../data/state.json');
const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const MAX_TRADES = 100;

let currentState = {
  status: 'running',
  lastUpdate: null,
  cycle: 0,
  price: 0,
  signal: 'HOLD',
  votes: { buyCount: 0, sellCount: 0, total: 7 },
  indicators: {},
  balance: { usd: 0, btc: 0, totalUsd: 0 },
  pnl: { startBalance: null, currentBalance: 0, pct: 0 },
  atr: null,
  lastTrade: null,
};

function saveState(updates) {
  Object.assign(currentState, updates, { lastUpdate: new Date().toISOString() });
  fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));
}

function saveTrade(trade) {
  let trades = [];
  if (fs.existsSync(TRADES_FILE)) {
    try { trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8')); } catch {}
  }
  trades.unshift({ ...trade, timestamp: new Date().toISOString() });
  if (trades.length > MAX_TRADES) trades = trades.slice(0, MAX_TRADES);
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

function getState() {
  return currentState;
}

// 초기화
if (!fs.existsSync(STATE_FILE)) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));
}

module.exports = { saveState, saveTrade, getState };
