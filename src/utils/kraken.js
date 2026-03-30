const { execSync } = require('child_process');

// Kraken CLI 래퍼 - 모든 명령을 JSON으로 실행
function kraken(command) {
  const result = execSync(`kraken ${command} -o json`, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.HOME}/bin:${process.env.PATH}` },
  });
  return JSON.parse(result);
}

// 현재 가격 조회 (last trade price 반환)
function getTicker(pair = 'XBTUSD') {
  const raw = kraken(`ticker ${pair}`);
  // {"XXBTZUSD": {"c": ["65977.9", ...]}} 구조에서 현재가 추출
  const key = Object.keys(raw)[0];
  return parseFloat(raw[key]?.c?.[0] || 0);
}

// 페이퍼 트레이딩 모드 (기본값 true)
const PAPER_MODE = process.env.PAPER_MODE !== 'false';

// 잔고 조회
function getBalance() {
  if (PAPER_MODE) {
    const status = kraken('paper status');
    // {"current_value":9981, "starting_balance":10000, "unrealized_pnl":-18, ...}
    return {
      ZUSD: status?.current_value ?? 10000,
      startingBalance: status?.starting_balance ?? 10000,
      unrealizedPnl: status?.unrealized_pnl ?? 0,
      unrealizedPnlPct: status?.unrealized_pnl_pct ?? 0,
      totalTrades: status?.total_trades ?? 0,
    };
  }
  return kraken('balance');
}

// 최근 OHLC 캔들 데이터
function getOHLC(pair = 'XBTUSD', interval = 60) {
  const raw = kraken(`ohlc ${pair} --interval ${interval}`);
  // {"XXBTZUSD": [[ts, open, high, low, close, vwap, vol, count], ...]} 구조
  const key = Object.keys(raw).find(k => k !== 'last');
  const candles = raw[key] || [];
  // [timestamp, open, high, low, close, vwap, volume, count] → 전체 필드 반환
  return candles.map(c => ({
    timestamp: c[0],
    open:   parseFloat(c[1]),
    high:   parseFloat(c[2]),
    low:    parseFloat(c[3]),
    close:  parseFloat(c[4]),
    vwap:   parseFloat(c[5]),
    volume: parseFloat(c[6]),
    count:  c[7],
  }));
}

// 시장가 매수
function buyMarket(pair, volume) {
  if (PAPER_MODE) return kraken(`paper buy ${pair} ${volume}`);
  return kraken(`order add --pair ${pair} --type buy --ordertype market --volume ${volume} --yes`);
}

// 시장가 매도
function sellMarket(pair, volume) {
  if (PAPER_MODE) return kraken(`paper sell ${pair} ${volume}`);
  return kraken(`order add --pair ${pair} --type sell --ordertype market --volume ${volume} --yes`);
}

// 오픈 주문 조회
function getOpenOrders() {
  if (PAPER_MODE) return kraken('paper orders');
  return kraken('open-orders');
}

// 페이퍼 트레이딩 PnL 현황
function getPaperStatus() {
  return kraken('paper status');
}

module.exports = { getTicker, getBalance, getOHLC, buyMarket, sellMarket, getOpenOrders, getPaperStatus, PAPER_MODE };
