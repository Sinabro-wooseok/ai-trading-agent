// 리스크 관리 모듈
// 포지션 크기, 손절선, 일일 손실 한도 관리

const MAX_POSITION_USD = 50;    // 최대 1회 매매 금액 (USD)
const MAX_DAILY_LOSS_PCT = 0.05; // 일일 최대 손실 5%
const STOP_LOSS_PCT = 0.03;     // 손절 3%

let dailyStartBalance = null;
let dailyLoss = 0;

function setDailyBaseline(balanceUSD) {
  dailyStartBalance = balanceUSD;
  dailyLoss = 0;
}

// 매매 가능 여부 확인
function canTrade(currentBalanceUSD) {
  if (dailyStartBalance === null) return true;

  const loss = (dailyStartBalance - currentBalanceUSD) / dailyStartBalance;
  if (loss >= MAX_DAILY_LOSS_PCT) {
    console.log(`[리스크] 일일 손실 한도 초과: ${(loss * 100).toFixed(2)}%`);
    return false;
  }
  return true;
}

// 적정 포지션 크기 계산 (USD 기준)
function calcPositionSize(balanceUSD, price) {
  const maxUSD = Math.min(balanceUSD * 0.1, MAX_POSITION_USD);
  return maxUSD / price;
}

// 손절가 계산
function stopLossPrice(entryPrice, side) {
  if (side === 'buy') return entryPrice * (1 - STOP_LOSS_PCT);
  return entryPrice * (1 + STOP_LOSS_PCT);
}

module.exports = { canTrade, calcPositionSize, stopLossPrice, setDailyBaseline, MAX_POSITION_USD };
