require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

const STATE_FILE = path.join(__dirname, '../../data/state.json');
const TRADES_FILE = path.join(__dirname, '../../data/trades.json');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (fs.existsSync(STATE_FILE)) {
    res.send(fs.readFileSync(STATE_FILE, 'utf8'));
  } else {
    res.json({ status: 'starting', lastUpdate: null });
  }
});

app.get('/api/trades', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (fs.existsSync(TRADES_FILE)) {
    res.send(fs.readFileSync(TRADES_FILE, 'utf8'));
  } else {
    res.json([]);
  }
});

// SSE: 실시간 상태 스트림
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = () => {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      res.write(`data: ${data}\n\n`);
    }
  };

  send();
  const interval = setInterval(send, 5000);
  req.on('close', () => clearInterval(interval));
});

app.listen(PORT, () => {
  console.log(`[대시보드] http://localhost:${PORT}`);
});
