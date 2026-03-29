// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ERC-8004 Agent Identity Registry
/// @notice AI 트레이딩 에이전트의 온체인 신원, 평판, 검증 점수 관리
contract AgentRegistry is ERC721, Ownable {
    uint256 private _nextTokenId;

    struct AgentMetadata {
        address owner;
        string strategyURI;       // IPFS or GitHub URL
        string name;
        uint256 registeredAt;
        bool active;
    }

    struct AgentScore {
        int256  totalPnl;          // 누적 PnL (USD * 1e6)
        uint256 sharpeRatio;       // Sharpe * 1e4
        uint256 maxDrawdownBps;    // 최대 낙폭 (basis points)
        uint256 tradeCount;
        uint256 winCount;
        uint256 lastUpdated;
    }

    mapping(uint256 => AgentMetadata) public agents;
    mapping(uint256 => AgentScore)    public scores;
    mapping(address => uint256)       public ownerToAgentId;

    // 검증된 업데이터만 점수 갱신 가능 (RiskRouter, CapitalVault)
    mapping(address => bool) public authorizedUpdaters;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string name);
    event ScoreUpdated(uint256 indexed agentId, int256 pnl, uint256 sharpe, uint256 drawdownBps);
    event AgentDeactivated(uint256 indexed agentId);

    constructor() ERC721("SinabroAgent", "SAGENT") Ownable(msg.sender) {}

    modifier onlyUpdater() {
        require(authorizedUpdaters[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    /// @notice 에이전트 신원 등록 (NFT mint)
    function registerAgent(string memory name, string memory strategyURI) external returns (uint256) {
        require(ownerToAgentId[msg.sender] == 0, "Already registered");

        _nextTokenId++;
        uint256 agentId = _nextTokenId;

        _safeMint(msg.sender, agentId);

        agents[agentId] = AgentMetadata({
            owner: msg.sender,
            strategyURI: strategyURI,
            name: name,
            registeredAt: block.timestamp,
            active: true
        });

        ownerToAgentId[msg.sender] = agentId;

        emit AgentRegistered(agentId, msg.sender, name);
        return agentId;
    }

    /// @notice 온체인 성과 지표 갱신 (RiskRouter/CapitalVault 호출)
    function updateScore(
        uint256 agentId,
        int256  pnlDelta,
        uint256 sharpe,
        uint256 drawdownBps,
        bool    isWin
    ) external onlyUpdater {
        require(_ownerOf(agentId) != address(0), "Agent not found");

        AgentScore storage s = scores[agentId];
        s.totalPnl      += pnlDelta;
        s.sharpeRatio    = sharpe;
        s.tradeCount++;
        if (isWin) s.winCount++;
        if (drawdownBps > s.maxDrawdownBps) s.maxDrawdownBps = drawdownBps;
        s.lastUpdated    = block.timestamp;

        emit ScoreUpdated(agentId, s.totalPnl, sharpe, drawdownBps);
    }

    function setAuthorizedUpdater(address updater, bool status) external onlyOwner {
        authorizedUpdaters[updater] = status;
    }

    function deactivateAgent(uint256 agentId) external onlyOwner {
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    function getAgentId(address owner) external view returns (uint256) {
        return ownerToAgentId[owner];
    }

    function isActive(uint256 agentId) external view returns (bool) {
        return agents[agentId].active;
    }
}
