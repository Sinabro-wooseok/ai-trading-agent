require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

const STATE_FILE = path.join(__dirname, '../../data/state.json');
const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const HISTORY_FILE = path.join(__dirname, '../../data/history.json');

const readJson = (file, fallback) => {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (_req, res) => {
  res.json(readJson(STATE_FILE, { status: 'starting', lastUpdate: null }));
});

app.get('/api/trades', (_req, res) => {
  res.json(readJson(TRADES_FILE, []));
});

app.get('/api/history', (_req, res) => {
  res.json(readJson(HISTORY_FILE, { prices: [], equity: [] }));
});

// SSE: 실시간 상태 스트림
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = () => {
    const data = readJson(STATE_FILE, { status: 'starting' });
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send();
  const interval = setInterval(send, 5000);
  req.on('close', () => clearInterval(interval));
});

app.listen(PORT, () => {
  console.log(`[대시보드] http://localhost:${PORT}`);
});
