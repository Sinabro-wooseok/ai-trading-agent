const { execSync } = require('child_process');

// Kraken CLI 래퍼 - 모든 명령을 JSON으로 실행
function kraken(command) {
  const result = execSync(`kraken ${command} -o json`, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${process.env.HOME}/bin:${process.env.PATH}` },
  });
  return JSON.parse(result);
}

// 현재 가격 조회
function getTicker(pair = 'XBTUSD') {
  return kraken(`ticker ${pair}`);
}

// 잔고 조회
function getBalance() {
  return kraken('balance');
}

// 최근 OHLC 캔들 데이터
function getOHLC(pair = 'XBTUSD', interval = 60) {
  return kraken(`ohlc ${pair} --interval ${interval}`);
}

// 시장가 매수
function buyMarket(pair, volume) {
  return kraken(`order add --pair ${pair} --type buy --ordertype market --volume ${volume} --yes`);
}

// 시장가 매도
function sellMarket(pair, volume) {
  return kraken(`order add --pair ${pair} --type sell --ordertype market --volume ${volume} --yes`);
}

// 오픈 주문 조회
function getOpenOrders() {
  return kraken('open-orders');
}

module.exports = { getTicker, getBalance, getOHLC, buyMarket, sellMarket, getOpenOrders };
