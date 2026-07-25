// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC721Upgradeable}   from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {UUPSUpgradeable}     from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable}  from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ECDSA}               from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils}    from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings}             from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title  GoodDropsBadges
 * @notice Soulbound (non-transferable) presence badges for GoodDrops hunters.
 *         A badge attests that a face-verified human physically earned a status
 *         (claims, streaks, event sets) — so it must be earned, never bought:
 *         transfers revert; only mint and burn are possible.
 *
 * @dev    UUPS upgradeable (OZ 5.x), mirroring the GoodDrops core contract.
 *
 *         Mint authorization uses the same pattern as GoodDrops' gpsSigner:
 *         the server checks eligibility off-chain (identity-scoped badge ledger)
 *         and signs {chainid, contract, to, badgeTypeId, deadline}. ANYONE may
 *         submit that signature — in practice our relayer does, paying the gas,
 *         so minting is free for hunters. Including chainid + contract address
 *         in the digest kills cross-chain / cross-contract replay; the
 *         one-badge-type-per-address rule kills same-contract replay.
 *
 *         Implements ERC-5192 (Minimal Soulbound NFT): locked() is always true
 *         and Locked is emitted on mint, so wallets/marketplaces that speak the
 *         standard render these as non-transferable.
 */
contract GoodDropsBadges is
    ERC721Upgradeable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using Strings for uint256;

    // ─── Errors ──────────────────────────────────────────────────────────────
    error Soulbound();
    error InvalidSignature();
    error SignatureExpired();
    error AlreadyHasBadge();
    error NotYourBadge();
    error ZeroAddress();

    // ─── Events ──────────────────────────────────────────────────────────────
    event BadgeMinted(address indexed to, uint256 indexed badgeTypeId, uint256 indexed tokenId);
    event BadgeSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event BaseURIUpdated(string newBaseURI);
    /// @dev ERC-5192
    event Locked(uint256 tokenId);

    // ─── Storage ─────────────────────────────────────────────────────────────
    /// @notice Server key that authorizes mints (eligibility checked off-chain).
    address public badgeSigner;
    /// @notice Total minted; token ids start at 1 (0 is permanently invalid).
    uint256 public tokenCount;
    /// @notice tokenId → badge type (type id = uint256(keccak256(badge slug))).
    mapping(uint256 => uint256) public typeOf;
    /// @notice owner → badge type → already minted. One of each type per wallet,
    ///         FOREVER — burning does not reset it, so a burned badge cannot be
    ///         re-minted (renouncing is permanent, which keeps rarity honest).
    mapping(address => mapping(uint256 => bool)) public hasBadge;
    /// @dev tokenURI = baseURI + typeId (metadata is per-TYPE, not per-token).
    string private _baseTokenURI;

    /// @dev Reserved for future upgrades — never reorder/remove existing vars.
    uint256[45] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address badgeSigner_,
        string calldata baseURI_
    ) external initializer {
        if (owner_ == address(0) || badgeSigner_ == address(0)) revert ZeroAddress();
        __ERC721_init("GoodDrops Badges", "GDBADGE");
        __Ownable_init(owner_);
        __Pausable_init();
        badgeSigner    = badgeSigner_;
        _baseTokenURI  = baseURI_;
    }

    // ─── Mint (server-authorized, relayer-friendly) ──────────────────────────

    /**
     * @notice Mint badge `badgeTypeId` to `to`. Callable by anyone holding a
     *         valid badgeSigner authorization — normally our gas-paying relayer.
     * @param to           The hunter receiving the badge.
     * @param badgeTypeId  uint256(keccak256(badge slug)) — computed off-chain.
     * @param deadline     Unix timestamp after which the authorization expires.
     * @param sig          badgeSigner signature over
     *                     keccak256("GOODDROPS_BADGE", chainid, this, to, badgeTypeId, deadline).
     */
    function mint(
        address to,
        uint256 badgeTypeId,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (hasBadge[to][badgeTypeId]) revert AlreadyHasBadge();

        bytes32 digest = keccak256(
            abi.encodePacked("GOODDROPS_BADGE", block.chainid, address(this), to, badgeTypeId, deadline)
        );
        if (digest.toEthSignedMessageHash().recover(sig) != badgeSigner) revert InvalidSignature();

        hasBadge[to][badgeTypeId] = true;
        tokenId = ++tokenCount;
        typeOf[tokenId] = badgeTypeId;

        _safeMint(to, tokenId);
        emit BadgeMinted(to, badgeTypeId, tokenId);
        emit Locked(tokenId);
    }

    /// @notice A holder may renounce (burn) their own badge. Permanent — the
    ///         same type can never be re-minted to this wallet.
    function burn(uint256 tokenId) external {
        if (_ownerOf(tokenId) != msg.sender) revert NotYourBadge();
        _burn(tokenId);
    }

    // ─── Soulbound enforcement ───────────────────────────────────────────────

    /// @dev OZ 5.x single transfer chokepoint: allow mint (from == 0) and burn
    ///      (to == 0); revert every wallet-to-wallet transfer.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    // ─── ERC-5192 (Minimal Soulbound) ────────────────────────────────────────

    /// @notice Every badge is permanently locked.
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e /* ERC-5192 */ || super.supportsInterface(interfaceId);
    }

    // ─── Metadata ────────────────────────────────────────────────────────────

    /// @dev Metadata is per badge TYPE: tokenURI = baseURI + typeId. The app
    ///      serves JSON at that path today; pointing baseURI at IPFS later is a
    ///      one-call owner change, no upgrade needed.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseTokenURI, typeOf[tokenId].toString());
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setBadgeSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit BadgeSignerUpdated(badgeSigner, newSigner);
        badgeSigner = newSigner;
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── UUPS ────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
