const { ethers } = require('ethers');

const CHAIN_ID = 84532; // Base Sepolia

// EIP-712 도메인
function getDomain(validatorAddress) {
  return {
    name: 'SinabroTrader',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: validatorAddress,
  };
}

// TradeIntent 타입 정의
const TRADE_INTENT_TYPES = {
  TradeIntent: [
    { name: 'agentId',  type: 'uint256' },
    { name: 'pair',     type: 'string'  },
    { name: 'volume',   type: 'uint256' },
    { name: 'isBuy',    type: 'bool'    },
    { name: 'price',    type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce',    type: 'uint256' },
  ],
};

/// @notice TradeIntent EIP-712 서명 생성
async function signTradeIntent({ signer, validatorAddress, agentId, pair, volume, isBuy, price, nonce }) {
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5분 유효

  const intent = {
    agentId:  BigInt(agentId),
    pair,
    volume:   BigInt(Math.round(volume * 1e8)),   // BTC 8자리
    isBuy,
    price:    BigInt(Math.round(price * 1e6)),     // USD 6자리
    deadline: BigInt(deadline),
    nonce:    BigInt(nonce),
  };

  const domain = getDomain(validatorAddress);
  const signature = await signer.signTypedData(domain, TRADE_INTENT_TYPES, intent);

  return { intent, signature, deadline };
}

module.exports = { signTradeIntent, getDomain, TRADE_INTENT_TYPES };
