require('dotenv').config();
const { ethers } = require('ethers');
const { getTicker, getBalance, getOHLC, buyMarket, sellMarket, PAPER_MODE } = require('../utils/kraken');
const { extractCloses, getSignal } = require('../strategies/rsi');
const { canTrade, calcPositionSize, setDailyBaseline } = require('../risk/manager');
const { signTradeIntent } = require('../signing/eip712');

const PAIR = 'XBTUSD';
const INTERVAL_MS = 60 * 1000; // 1분마다 실행

// ERC-8004 온체인 설정
const ONCHAIN_ENABLED = !!(process.env.AGENT_PRIVATE_KEY && process.env.TRADE_VALIDATOR_ADDRESS);
let signer = null;
let tradeNonce = 0;

if (ONCHAIN_ENABLED) {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
  signer = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  console.log(`[ERC-8004] 온체인 서명 활성화: ${signer.address}`);
}

async function runCycle() {
  console.log(`\n[${new Date().toISOString()}] 사이클 시작`);

  try {
    const balance = getBalance();
    const usdBalance = parseFloat(balance?.ZUSD || balance?.USD || 0);
    const btcBalance = parseFloat(balance?.XXBT || balance?.XBT || 0);
    console.log(`[잔고] USD: $${usdBalance.toFixed(2)}, BTC: ${btcBalance.toFixed(6)}`);

    if (usdBalance < 1 && btcBalance < 0.0001) {
      console.log('[경고] 잔고 부족 - 스킵');
      return;
    }

    const currentPrice = getTicker(PAIR);
    const totalUSD = usdBalance + btcBalance * currentPrice;
    setDailyBaseline(totalUSD);

    if (!canTrade(totalUSD)) {
      console.log('[리스크] 오늘 거래 중단');
      return;
    }

    const ohlc = getOHLC(PAIR, 60);
    const closes = extractCloses(Array.isArray(ohlc) ? ohlc : []);
    const { signal, rsi } = getSignal(closes);

    console.log(`[시그널] RSI: ${rsi?.toFixed(2)} → ${signal} @ $${currentPrice.toLocaleString()}`);

    let shouldTrade = false;
    let isBuy = false;
    let volume = 0;

    if (signal === 'BUY' && usdBalance > 1) {
      volume = calcPositionSize(usdBalance, currentPrice);
      isBuy = true;
      shouldTrade = true;
    } else if (signal === 'SELL' && btcBalance > 0.0001) {
      volume = Math.min(btcBalance, calcPositionSize(totalUSD, currentPrice));
      isBuy = false;
      shouldTrade = true;
    }

    if (!shouldTrade) {
      console.log('[대기] 시그널 없음');
      return;
    }

    // ERC-8004 EIP-712 서명 생성
    if (ONCHAIN_ENABLED) {
      const { signature } = await signTradeIntent({
        signer,
        validatorAddress: process.env.TRADE_VALIDATOR_ADDRESS,
        agentId: process.env.AGENT_ID || 1,
        pair: PAIR,
        volume,
        isBuy,
        price: currentPrice,
        nonce: tradeNonce,
      });
      tradeNonce++;
      console.log(`[ERC-8004] TradeIntent 서명 완료 (nonce: ${tradeNonce - 1})`);
      console.log(`[ERC-8004] 서명: ${signature.slice(0, 20)}...`);
    }

    // 주문 실행
    const side = isBuy ? '매수' : '매도';
    console.log(`[${side}] ${volume.toFixed(8)} BTC @ $${currentPrice.toLocaleString()}`);

    const result = isBuy
      ? buyMarket(PAIR, volume.toFixed(8))
      : sellMarket(PAIR, volume.toFixed(8));

    console.log('[주문 완료]', JSON.stringify(result));

  } catch (err) {
    console.error('[에러]', err.message);
  }
}

console.log(`AI 트레이딩 에이전트 시작 [${PAPER_MODE ? '페이퍼' : '실거래'} | ERC-8004: ${ONCHAIN_ENABLED ? 'ON' : 'OFF'}]`);
runCycle();
setInterval(runCycle, INTERVAL_MS);
