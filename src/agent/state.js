// 에이전트 상태 영속성 모듈
// 대시보드에서 읽을 수 있도록 JSON 파일로 저장

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../data/state.json');
const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const HISTORY_FILE = path.join(__dirname, '../../data/history.json');
const MAX_TRADES = 200;
const MAX_HISTORY = 300;

let currentState = {
  status: 'running',
  lastUpdate: null,
  cycle: 0,
  price: 0,
  signal: 'HOLD',
  votes: { buyCount: 0, sellCount: 0, total: 7 },
  indicators: {},
  balance: { usd: 0, btc: 0, totalUsd: 0 },
  regime: 'neutral',
  ema200: null,
  atr: null,
  stopLossPrice: null,
  lastTrade: null,
  stats: { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, winRate: 0 },
};

// 기존 state.json이 있으면 로드
if (fs.existsSync(STATE_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    Object.assign(currentState, saved);
  } catch {}
}

function saveState(updates) {
  Object.assign(currentState, updates, { lastUpdate: new Date().toISOString() });
  fs.writeFileSync(STATE_FILE, JSON.stringify(currentState, null, 2));
}

function savePricePoint(price, signal, totalUsd) {
  let history = { prices: [], equity: [] };
  if (fs.existsSync(HISTORY_FILE)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  }

  const ts = new Date().toISOString();
  history.prices.push({ t: ts, v: price, s: signal });
  history.equity.push({ t: ts, v: totalUsd });

  if (history.prices.length > MAX_HISTORY) history.prices = history.prices.slice(-MAX_HISTORY);
  if (history.equity.length > MAX_HISTORY) history.equity = history.equity.slice(-MAX_HISTORY);

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
}

function saveTrade(trade) {
  let trades = [];
  if (fs.existsSync(TRADES_FILE)) {
    try { trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8')); } catch {}
  }

  const entry = { ...trade, timestamp: new Date().toISOString() };
  trades.unshift(entry);
  if (trades.length > MAX_TRADES) trades = trades.slice(0, MAX_TRADES);
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));

  // 통계 업데이트
  updateStats(trades);
}

function updateStats(trades) {
  const buys = trades.filter(t => t.side === 'BUY');
  const sells = trades.filter(t => t.side === 'SELL');

  let wins = 0, losses = 0, totalPnl = 0;

  // 단순 통계: SELL 시 직전 BUY보다 높으면 승
  sells.forEach(sell => {
    const prevBuy = buys.find(b => new Date(b.timestamp) < new Date(sell.timestamp));
    if (prevBuy) {
      const pnl = (sell.price - prevBuy.price) * sell.volume;
      totalPnl += pnl;
      if (pnl > 0) wins++; else losses++;
    }
  });

  const total = wins + losses;
  saveState({
    stats: {
      totalTrades: trades.length,
      wins,
      losses,
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      winRate: total > 0 ? parseFloat((wins / total * 100).toFixed(1)) : 0,
    }
  });
}

function getState() {
  return currentState;
}

module.exports = { saveState, saveTrade, savePricePoint, getState };
