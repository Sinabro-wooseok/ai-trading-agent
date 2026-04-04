#!/bin/bash
# Hardhat 로컬 노드 시작 + 계약 자동 배포
set -e

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJ_DIR"

echo "[Hardhat] 노드 시작..."
npx hardhat node &
HARDHAT_PID=$!

# 노드가 준비될 때까지 대기 (최대 30초)
for i in $(seq 1 30); do
  if curl -sf -X POST http://127.0.0.1:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
    echo "[Hardhat] 노드 준비 완료"
    break
  fi
  sleep 1
done

echo "[Hardhat] 컨트랙트 배포 중..."
DEPLOY_OUTPUT=$(npx hardhat run scripts/deploy.js --network localhost 2>&1)
echo "$DEPLOY_OUTPUT"

# .env 업데이트
REGISTRY=$(echo "$DEPLOY_OUTPUT" | grep "AGENT_REGISTRY_ADDRESS=" | cut -d= -f2)
VALIDATOR=$(echo "$DEPLOY_OUTPUT" | grep "TRADE_VALIDATOR_ADDRESS=" | cut -d= -f2)
ROUTER=$(echo "$DEPLOY_OUTPUT" | grep "RISK_ROUTER_ADDRESS=" | cut -d= -f2)
AGENT_ID=$(echo "$DEPLOY_OUTPUT" | grep "^AGENT_ID=" | cut -d= -f2)

if [ -n "$REGISTRY" ]; then
  sed -i '' "s|AGENT_REGISTRY_ADDRESS=.*|AGENT_REGISTRY_ADDRESS=$REGISTRY|" .env
  sed -i '' "s|TRADE_VALIDATOR_ADDRESS=.*|TRADE_VALIDATOR_ADDRESS=$VALIDATOR|" .env
  sed -i '' "s|RISK_ROUTER_ADDRESS=.*|RISK_ROUTER_ADDRESS=$ROUTER|" .env
  sed -i '' "s|AGENT_ID=.*|AGENT_ID=$AGENT_ID|" .env
  echo "[Hardhat] .env 업데이트 완료"
fi

# 포그라운드 유지
wait $HARDHAT_PID
