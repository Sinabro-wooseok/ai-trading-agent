const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('배포 지갑:', deployer.address);
  console.log('잔고:', ethers.formatEther(await ethers.provider.getBalance(deployer.address)), 'ETH');

  // 1. AgentRegistry 배포
  console.log('\n1. AgentRegistry 배포 중...');
  const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  console.log('AgentRegistry:', await registry.getAddress());

  // 2. TradeValidator 배포
  console.log('\n2. TradeValidator 배포 중...');
  const TradeValidator = await ethers.getContractFactory('TradeValidator');
  const validator = await TradeValidator.deploy(await registry.getAddress());
  await validator.waitForDeployment();
  console.log('TradeValidator:', await validator.getAddress());

  // 3. RiskRouter 배포
  console.log('\n3. RiskRouter 배포 중...');
  const RiskRouter = await ethers.getContractFactory('RiskRouter');
  const router = await RiskRouter.deploy(
    await validator.getAddress(),
    await registry.getAddress()
  );
  await router.waitForDeployment();
  console.log('RiskRouter:', await router.getAddress());

  // 4. RiskRouter를 authorized updater로 등록
  console.log('\n4. RiskRouter 권한 설정...');
  await registry.setAuthorizedUpdater(await router.getAddress(), true);
  console.log('권한 설정 완료');

  // 5. 에이전트 신원 등록
  console.log('\n5. 에이전트 신원 등록...');
  const tx = await registry.registerAgent(
    'Sinabro Trading Agent',
    'https://github.com/Sinabro-wooseok/ai-trading-agent'
  );
  const receipt = await tx.wait();
  const agentId = await registry.getAgentId(deployer.address);
  console.log('에이전트 ID (NFT tokenId):', agentId.toString());

  // 6. 초기 자본 설정 ($10,000 = 10000 * 1e6)
  console.log('\n6. RiskRouter 초기 자본 설정...');
  await router.initAgent(agentId, 10_000_000_000n);
  console.log('초기 자본: $10,000 설정 완료');

  // 결과 출력
  console.log('\n=== 배포 완료 ===');
  console.log(`AGENT_REGISTRY_ADDRESS=${await registry.getAddress()}`);
  console.log(`TRADE_VALIDATOR_ADDRESS=${await validator.getAddress()}`);
  console.log(`RISK_ROUTER_ADDRESS=${await router.getAddress()}`);
  console.log(`AGENT_ID=${agentId.toString()}`);
  console.log('\n위 값들을 .env에 추가하세요');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
