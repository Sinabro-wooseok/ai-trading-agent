// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./TradeValidator.sol";
import "./AgentRegistry.sol";

/// @title Risk Router
/// @notice 포지션 한도, 일일 손실 한도, drawdown 강제 적용
contract RiskRouter {
    TradeValidator public immutable validator;
    AgentRegistry  public immutable registry;

    uint256 public constant MAX_DRAWDOWN_BPS   = 1500; // 15% 최대 낙폭
    uint256 public constant MAX_POSITION_USD6  = 50_000_000; // $50 (1e6 스케일)
    uint256 public constant DAILY_LOSS_BPS     = 500;  // 5% 일일 손실 한도

    struct AgentState {
        uint256 peakValueUsd6;
        uint256 currentValueUsd6;
        uint256 dailyStartValueUsd6;
        uint256 lastResetDay;
        bool    paused;
    }

    mapping(uint256 => AgentState) public agentStates;

    event TradePassed(uint256 indexed agentId, string pair, bool isBuy);
    event TradeBlocked(uint256 indexed agentId, string reason);
    event AgentPaused(uint256 indexed agentId, string reason);

    constructor(address validatorAddr, address registryAddr) {
        validator = TradeValidator(validatorAddr);
        registry  = AgentRegistry(registryAddr);
    }

    /// @notice 거래 검증 + 리스크 체크 통과 시 승인
    function routeTrade(
        TradeValidator.TradeIntent memory intent,
        bytes memory signature,
        uint256 currentPriceUsd6
    ) external returns (bool) {
        uint256 agentId = intent.agentId;
        AgentState storage state = agentStates[agentId];

        // 일일 리셋
        uint256 today = block.timestamp / 1 days;
        if (state.lastResetDay < today) {
            state.dailyStartValueUsd6 = state.currentValueUsd6;
            state.lastResetDay = today;
        }

        // 1. 에이전트 정지 여부
        if (state.paused) {
            emit TradeBlocked(agentId, "Agent paused");
            return false;
        }

        // 2. drawdown 체크
        if (state.peakValueUsd6 > 0) {
            uint256 drawdownBps = (state.peakValueUsd6 - state.currentValueUsd6) * 10000 / state.peakValueUsd6;
            if (drawdownBps >= MAX_DRAWDOWN_BPS) {
                state.paused = true;
                emit AgentPaused(agentId, "Max drawdown exceeded");
                emit TradeBlocked(agentId, "Drawdown limit");
                return false;
            }
        }

        // 3. 일일 손실 한도 체크
        if (state.dailyStartValueUsd6 > 0 && state.currentValueUsd6 < state.dailyStartValueUsd6) {
            uint256 dailyLossBps = (state.dailyStartValueUsd6 - state.currentValueUsd6) * 10000 / state.dailyStartValueUsd6;
            if (dailyLossBps >= DAILY_LOSS_BPS) {
                emit TradeBlocked(agentId, "Daily loss limit");
                return false;
            }
        }

        // 4. 포지션 크기 체크
        uint256 positionUsd6 = intent.volume * currentPriceUsd6 / 1e8;
        if (positionUsd6 > MAX_POSITION_USD6) {
            emit TradeBlocked(agentId, "Position too large");
            return false;
        }

        // 5. EIP-712 서명 검증
        bool valid = validator.validateTrade(intent, signature);
        if (!valid) {
            emit TradeBlocked(agentId, "Invalid signature");
            return false;
        }

        emit TradePassed(agentId, intent.pair, intent.isBuy);
        return true;
    }

    /// @notice CapitalVault가 PnL 변화 후 상태 업데이트 호출
    function updateAgentValue(uint256 agentId, uint256 newValueUsd6) external {
        AgentState storage state = agentStates[agentId];
        state.currentValueUsd6 = newValueUsd6;
        if (newValueUsd6 > state.peakValueUsd6) {
            state.peakValueUsd6 = newValueUsd6;
        }
    }

    function initAgent(uint256 agentId, uint256 initialValueUsd6) external {
        require(registry.isActive(agentId), "Agent not active");
        AgentState storage state = agentStates[agentId];
        state.peakValueUsd6         = initialValueUsd6;
        state.currentValueUsd6      = initialValueUsd6;
        state.dailyStartValueUsd6   = initialValueUsd6;
        state.lastResetDay          = block.timestamp / 1 days;
        state.paused                = false;
    }

    function getDrawdownBps(uint256 agentId) external view returns (uint256) {
        AgentState storage state = agentStates[agentId];
        if (state.peakValueUsd6 == 0) return 0;
        if (state.currentValueUsd6 >= state.peakValueUsd6) return 0;
        return (state.peakValueUsd6 - state.currentValueUsd6) * 10000 / state.peakValueUsd6;
    }
}
