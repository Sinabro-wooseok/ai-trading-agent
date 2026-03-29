// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "./AgentRegistry.sol";

/// @title EIP-712 TradeIntent 검증기
/// @notice EOA 및 스마트컨트랙트 월렛(EIP-1271) 서명 모두 지원
contract TradeValidator is EIP712 {
    using ECDSA for bytes32;

    AgentRegistry public immutable registry;

    bytes32 public constant TRADE_INTENT_TYPEHASH = keccak256(
        "TradeIntent(uint256 agentId,string pair,uint256 volume,bool isBuy,uint256 price,uint256 deadline,uint256 nonce)"
    );

    mapping(address => uint256) public nonces;

    struct TradeIntent {
        uint256 agentId;
        string  pair;
        uint256 volume;   // 1e8 스케일 (BTC 8자리)
        bool    isBuy;
        uint256 price;    // USD * 1e6
        uint256 deadline;
        uint256 nonce;
    }

    event TradeValidated(uint256 indexed agentId, string pair, bool isBuy, uint256 volume, uint256 price);
    event ValidationFailed(uint256 indexed agentId, string reason);

    constructor(address registryAddr) EIP712("SinabroTrader", "1") {
        registry = AgentRegistry(registryAddr);
    }

    /// @notice TradeIntent 해시 생성
    function hashIntent(TradeIntent memory intent) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            TRADE_INTENT_TYPEHASH,
            intent.agentId,
            keccak256(bytes(intent.pair)),
            intent.volume,
            intent.isBuy,
            intent.price,
            intent.deadline,
            intent.nonce
        )));
    }

    /// @notice 서명 검증 (EOA + EIP-1271 스마트월렛)
    function validateTrade(TradeIntent memory intent, bytes memory signature) external returns (bool) {
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(registry.isActive(intent.agentId), "Agent not active");

        address agentOwner = registry.ownerOf(intent.agentId);
        require(intent.nonce == nonces[agentOwner], "Invalid nonce");

        bytes32 digest = hashIntent(intent);
        bool valid = _verifySignature(agentOwner, digest, signature);

        if (!valid) {
            emit ValidationFailed(intent.agentId, "Invalid signature");
            return false;
        }

        nonces[agentOwner]++;
        emit TradeValidated(intent.agentId, intent.pair, intent.isBuy, intent.volume, intent.price);
        return true;
    }

    /// @notice EOA(ECDSA) 또는 스마트월렛(EIP-1271) 서명 모두 처리
    function _verifySignature(address signer, bytes32 digest, bytes memory signature) internal view returns (bool) {
        // EOA 검증 시도
        address recovered = digest.recover(signature);
        if (recovered == signer) return true;

        // EIP-1271 스마트컨트랙트 월렛 검증
        if (signer.code.length > 0) {
            try IERC1271(signer).isValidSignature(digest, signature) returns (bytes4 magic) {
                return magic == IERC1271.isValidSignature.selector;
            } catch {
                return false;
            }
        }

        return false;
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
