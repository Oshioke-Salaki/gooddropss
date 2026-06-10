// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable}       from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable}     from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable}  from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
// OZ 5.x ReentrancyGuard is @custom:stateless (uses StorageSlot, no constructor
// initialization) — safe to use directly in upgradeable contracts without an init call.
import {ReentrancyGuard}     from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20}              from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}           from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA}               from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils}    from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ─── GoodDollar Identity Interface ───────────────────────────────────────────
// Celo mainnet:  0xC361A6E67822a0EDc17D899227dd9FC50BD62F42
// Celo Alfajores: set via initialize()
// getWhitelistedRoot returns the face-verified root address for a wallet.
// A non-zero return means the wallet is whitelisted. Using the root (rather
// than isWhitelisted) lets the contract track the underlying human identity,
// preventing the same person from claiming via multiple linked wallets.
interface IIdentityV2 {
    function getWhitelistedRoot(address user) external view returns (address root);
}

/**
 * @title  GoodDrops
 * @notice Hide G$ at real-world GPS coordinates. GoodDollar-verified humans
 *         go there and claim it. First to arrive wins the drop.
 *
 * @dev    UUPS upgradeable (OZ 5.x). GPS radius enforcement is intentionally
 *         off-chain — the frontend verifies proximity before surfacing the
 *         Claim button. On-chain we enforce: identity, single-claim, expiry,
 *         and correct token accounting.
 *
 *         Storage layout (packed for gas efficiency):
 *         ┌──────────────────────────┬──────────┐
 *         │ Drop.dropper (20 bytes)  │          │
 *         │ Drop.amount  (12 bytes)  │ slot 1   │
 *         ├──────────────────────────┤          │
 *         │ Drop.claimer  (20 bytes) │          │
 *         │ Drop.expiry   ( 5 bytes) │ slot 2   │
 *         │ Drop.claimedAt( 5 bytes) │          │
 *         │ Drop.status   ( 1 byte)  │          │
 *         ├──────────────────────────┤          │
 *         │ Drop.lat      ( 4 bytes) │ slot 3   │
 *         │ Drop.lng      ( 4 bytes) │ (partial)│
 *         ├──────────────────────────┤          │
 *         │ Drop.hint (dynamic)      │ slot 4+  │
 *         └──────────────────────────┴──────────┘
 */
contract GoodDrops is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Types ───────────────────────────────────────────────────────────────

    enum DropStatus {
        Active,    // 0 — live, claimable
        Claimed,   // 1 — claimed by a hunter
        Reclaimed  // 2 — returned to dropper after expiry
    }

    struct Drop {
        // slot 1
        address    dropper;    // who created the drop
        uint96     amount;     // G$ locked (18-decimal, max ~79 billion G$)
        // slot 2
        address    claimer;    // address(0) until claimed
        uint40     expiry;     // unix timestamp; dropper can reclaim after this
        uint40     claimedAt;  // timestamp of successful claim (0 if unclaimed)
        DropStatus status;     // 1 byte enum
        // slot 3 (partial)
        int32      lat;        // latitude  × 1e6  range: [-90_000_000,  90_000_000]
        int32      lng;        // longitude × 1e6  range: [-180_000_000, 180_000_000]
        // dynamic
        string     hint;       // public clue about the location
    }

    // ─── Constants ───────────────────────────────────────────────────────────

    uint256 public constant MAX_HINT_LENGTH = 200;

    // GPS bounds (integer degrees × 1e6)
    int32 public constant LAT_MAX =  90_000_000;
    int32 public constant LAT_MIN = -90_000_000;
    int32 public constant LNG_MAX =  180_000_000;
    int32 public constant LNG_MIN = -180_000_000;

    // ─── Storage ─────────────────────────────────────────────────────────────

    // ── Original storage — DO NOT reorder, insert before, or remove ──────────
    IERC20      public gToken;
    IIdentityV2 public identityContract;

    bool    public identityRequired;
    uint96  public maxDropAmount;
    uint96  public minDropAmount;
    uint40  public minExpiryDuration;
    uint40  public maxExpiryDuration;

    uint256 public dropCount;
    uint256 public totalLocked;

    mapping(uint256 => Drop) public drops;

    // ── v2 additions — appended after all original slots ─────────────────────
    address public gpsSigner;                    // server key that signs proximity proofs
    bool    public gpsRequired;                  // when true, claim() requires a GPS proof
    mapping(bytes32 => bool) public usedProofs;  // replay protection for GPS proofs

    // ─── Custom Errors ───────────────────────────────────────────────────────

    error ZeroAddress();
    error InvalidAmount();
    error InvalidCoordinates();
    error InvalidExpiry();
    error HintTooLong();
    error DropNotFound();
    error AlreadyClaimed();
    error DropExpired();
    error DropNotExpired();
    error NotDropper();
    error NotWhitelisted();
    error SelfClaim();
    error DropInactive();
    error IdentityContractNotSet();
    error CannotRescueLockedTokens();
    error MinExceedsMax();
    error GpsProofRequired();
    error InvalidGpsProof();
    error ProofExpired();
    error ProofAlreadyUsed();

    // ─── Events ──────────────────────────────────────────────────────────────

    // Emitted for every new drop — Goldsky indexes dropCount, totalG$ per dropper
    event DropCreated(
        uint256 indexed dropId,
        address indexed dropper,
        int32   lat,
        int32   lng,
        uint96  amount,
        uint40  expiry,
        string  hint
    );

    // Emitted on successful claim — Goldsky indexes claimedCount, totalG$ per claimer
    event DropClaimed(
        uint256 indexed dropId,
        address indexed claimer,
        address indexed dropper,
        uint96  amount,
        uint40  claimedAt
    );

    // Emitted when dropper takes back an expired, unclaimed drop
    event DropReclaimed(
        uint256 indexed dropId,
        address indexed dropper,
        uint96  amount
    );

    // Config events — makes every admin change fully auditable on-chain
    event MaxDropAmountUpdated(uint96 oldMax, uint96 newMax);
    event MinDropAmountUpdated(uint96 oldMin, uint96 newMin);
    event ExpiryLimitsUpdated(uint40 minDuration, uint40 maxDuration);
    event IdentityRequiredUpdated(bool required);
    event IdentityContractUpdated(address indexed oldContract, address indexed newContract);
    event GpsSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event GpsRequiredUpdated(bool required);
    event TokensRescued(address indexed token, uint256 amount, address indexed to);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ─── Initializer ─────────────────────────────────────────────────────────

    /**
     * @param _gToken            G$ ERC-20 address (18 decimals)
     * @param _identityContract  GoodDollar identity contract; set address(0) to
     *                           start with identity checks off
     * @param _owner             Contract owner / admin
     */
    function initialize(
        address _gToken,
        address _identityContract,
        address _owner
    ) external initializer {
        if (_gToken == address(0)) revert ZeroAddress();
        if (_owner  == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __Pausable_init();

        gToken           = IERC20(_gToken);
        identityContract = IIdentityV2(_identityContract);
        // Enable identity checks automatically when a contract is provided
        identityRequired = _identityContract != address(0);

        // Conservative defaults — owner can relax / tighten after deployment
        maxDropAmount    = uint96(500  * 1e18);  // 500 G$
        minDropAmount    = uint96(1    * 1e18);  // 1 G$
        minExpiryDuration = 1  hours;
        maxExpiryDuration = 30 days;
    }

    // ─── Core: Create ────────────────────────────────────────────────────────

    /**
     * @notice Lock G$ at a GPS location so hunters can find and claim it.
     *
     * @param lat     Latitude  × 1e6  (e.g. Lagos 6.5244° → 6_524_400)
     * @param lng     Longitude × 1e6  (e.g. Lagos 3.3792° → 3_379_200)
     * @param amount  G$ to lock, in wei (must be within [minDropAmount, maxDropAmount])
     * @param expiry  Unix timestamp after which the drop expires and you can reclaim
     * @param hint    Public clue about the location (max 200 chars)
     */
    function createDrop(
        int32  lat,
        int32  lng,
        uint96 amount,
        uint40 expiry,
        string calldata hint
    ) external whenNotPaused nonReentrant {
        // ── Validations ────────────────────────────────────────────────────
        if (amount < minDropAmount || amount > maxDropAmount) revert InvalidAmount();

        if (lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) {
            revert InvalidCoordinates();
        }

        // expiry must be in [now + minDuration, now + maxDuration]
        uint40 now40 = uint40(block.timestamp);
        if (expiry < now40 + minExpiryDuration || expiry > now40 + maxExpiryDuration) {
            revert InvalidExpiry();
        }

        if (bytes(hint).length > MAX_HINT_LENGTH) revert HintTooLong();

        // ── Effects ────────────────────────────────────────────────────────
        // IDs start at 1 — drop 0 is permanently invalid, simplifying null checks
        uint256 dropId = ++dropCount;

        drops[dropId] = Drop({
            dropper:   msg.sender,
            amount:    amount,
            claimer:   address(0),
            expiry:    expiry,
            claimedAt: 0,
            status:    DropStatus.Active,
            lat:       lat,
            lng:       lng,
            hint:      hint
        });

        totalLocked += amount;

        // ── Interactions ───────────────────────────────────────────────────
        // Will revert if sender hasn't approved this contract or lacks balance
        gToken.safeTransferFrom(msg.sender, address(this), amount);

        emit DropCreated(dropId, msg.sender, lat, lng, amount, expiry, hint);
    }

    // ─── Core: Claim ─────────────────────────────────────────────────────────

    /**
     * @notice Claim a drop. Caller must be GoodDollar-verified.
     *         When gpsRequired=true this reverts — use claimWithProof() instead.
     *
     * @param dropId  The drop to claim.
     */
    function claim(uint256 dropId) external whenNotPaused nonReentrant {
        if (gpsRequired) revert GpsProofRequired();
        _executeClaim(dropId);
    }

    /**
     * @notice Claim a drop with a server-signed GPS proximity proof.
     *         The proof is: ethSignedMessageHash(keccak256(dropId, claimer, deadline))
     *         signed by gpsSigner. deadline is a unix timestamp (60s window recommended).
     *
     * @param dropId    The drop to claim.
     * @param deadline  Unix timestamp after which the proof expires.
     * @param sig       Server signature over keccak256(dropId, claimer, deadline).
     */
    function claimWithProof(
        uint256 dropId,
        uint256 deadline,
        bytes calldata sig
    ) external whenNotPaused nonReentrant {
        if (gpsSigner == address(0)) revert GpsProofRequired();
        if (block.timestamp > deadline) revert ProofExpired();

        bytes32 proofHash = keccak256(abi.encodePacked(dropId, msg.sender, deadline));
        if (usedProofs[proofHash]) revert ProofAlreadyUsed();

        address recovered = proofHash.toEthSignedMessageHash().recover(sig);
        if (recovered != gpsSigner) revert InvalidGpsProof();

        usedProofs[proofHash] = true;
        _executeClaim(dropId);
    }

    function _executeClaim(uint256 dropId) internal {
        Drop storage drop = drops[dropId];

        // ── Validations ────────────────────────────────────────────────────
        if (drop.dropper == address(0))       revert DropNotFound();
        if (drop.status != DropStatus.Active) revert AlreadyClaimed();
        if (block.timestamp >= drop.expiry)   revert DropExpired();
        if (msg.sender == drop.dropper)       revert SelfClaim();

        if (identityRequired) {
            if (address(identityContract) == address(0)) revert IdentityContractNotSet();
            // getWhitelistedRoot returns the face-verified root address.
            // A zero return means the caller is not whitelisted.
            address root = identityContract.getWhitelistedRoot(msg.sender);
            if (root == address(0)) revert NotWhitelisted();
        }

        // ── Effects ────────────────────────────────────────────────────────
        uint96 amount    = drop.amount;
        uint40 claimedAt = uint40(block.timestamp);

        drop.status    = DropStatus.Claimed;
        drop.claimer   = msg.sender;
        drop.claimedAt = claimedAt;
        totalLocked   -= amount;

        // ── Interactions ───────────────────────────────────────────────────
        gToken.safeTransfer(msg.sender, amount);

        emit DropClaimed(dropId, msg.sender, drop.dropper, amount, claimedAt);
    }

    // ─── Core: Reclaim ───────────────────────────────────────────────────────

    /**
     * @notice Reclaim your G$ from an expired, unclaimed drop.
     *         Intentionally NOT gated by `whenNotPaused` — if the contract is
     *         paused for a security incident, droppers must still be able to
     *         retrieve their funds.
     *
     * @param dropId  The expired drop to reclaim.
     */
    function reclaimExpired(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];

        if (drop.dropper == address(0))       revert DropNotFound();
        if (msg.sender != drop.dropper)       revert NotDropper();
        if (drop.status != DropStatus.Active) revert DropInactive();
        if (block.timestamp < drop.expiry)    revert DropNotExpired();

        uint96 amount = drop.amount;

        drop.status   = DropStatus.Reclaimed;
        totalLocked  -= amount;

        gToken.safeTransfer(msg.sender, amount);

        emit DropReclaimed(dropId, msg.sender, amount);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Full drop data for a given ID.
    function getDrop(uint256 dropId) external view returns (Drop memory) {
        return drops[dropId];
    }

    /**
     * @notice Quick check: can this drop currently be claimed?
     *         Combines all state conditions into one read.
     */
    function isClaimable(uint256 dropId) external view returns (bool) {
        Drop storage drop = drops[dropId];
        return (
            drop.dropper != address(0)        &&
            drop.status  == DropStatus.Active &&
            block.timestamp < drop.expiry
        );
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setMaxDropAmount(uint96 newMax) external onlyOwner {
        if (newMax == 0 || newMax < minDropAmount) revert InvalidAmount();
        emit MaxDropAmountUpdated(maxDropAmount, newMax);
        maxDropAmount = newMax;
    }

    function setMinDropAmount(uint96 newMin) external onlyOwner {
        if (newMin == 0 || newMin > maxDropAmount) revert InvalidAmount();
        emit MinDropAmountUpdated(minDropAmount, newMin);
        minDropAmount = newMin;
    }

    function setExpiryLimits(uint40 minDuration, uint40 maxDuration) external onlyOwner {
        if (minDuration == 0 || minDuration >= maxDuration) revert MinExceedsMax();
        minExpiryDuration = minDuration;
        maxExpiryDuration = maxDuration;
        emit ExpiryLimitsUpdated(minDuration, maxDuration);
    }

    /**
     * @notice Toggle GoodDollar identity requirement for claimers.
     * @dev    Cannot enable identity checks when identityContract is not set.
     */
    function setIdentityRequired(bool required) external onlyOwner {
        if (required && address(identityContract) == address(0)) {
            revert IdentityContractNotSet();
        }
        identityRequired = required;
        emit IdentityRequiredUpdated(required);
    }

    /**
     * @notice Update the GoodDollar identity contract address.
     * @dev    Setting to address(0) disables identity checks (also calls
     *         setIdentityRequired(false) implicitly via the identityRequired
     *         guard in claim()).
     */
    function setIdentityContract(address newContract) external onlyOwner {
        emit IdentityContractUpdated(address(identityContract), newContract);
        identityContract = IIdentityV2(newContract);
        // If the contract is being cleared, disable identity checks so claim()
        // doesn't revert with IdentityContractNotSet.
        if (newContract == address(0) && identityRequired) {
            identityRequired = false;
            emit IdentityRequiredUpdated(false);
        }
    }

    /**
     * @notice Recover tokens accidentally sent directly to this contract.
     * @dev    For G$: only the surplus above `totalLocked` can be rescued —
     *         funds backing active drops are untouchable by the owner.
     *         For any other ERC-20: full balance is recoverable.
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        if (token == address(gToken)) {
            uint256 balance = gToken.balanceOf(address(this));
            // Ensure rescue does not touch G$ locked in active drops
            if (balance < totalLocked + amount) revert CannotRescueLockedTokens();
        }
        IERC20(token).safeTransfer(owner(), amount);
        emit TokensRescued(token, amount, owner());
    }

    function setGpsSigner(address newSigner) external onlyOwner {
        emit GpsSignerUpdated(gpsSigner, newSigner);
        gpsSigner = newSigner;
        if (newSigner == address(0) && gpsRequired) {
            gpsRequired = false;
            emit GpsRequiredUpdated(false);
        }
    }

    function setGpsRequired(bool required) external onlyOwner {
        if (required && gpsSigner == address(0)) revert ZeroAddress();
        gpsRequired = required;
        emit GpsRequiredUpdated(required);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─── V2 Reinitializer ────────────────────────────────────────────────────

    /**
     * @notice Called via upgradeToAndCall when upgrading a v1 proxy to v2.
     *         Atomically enables GPS enforcement in the same transaction as the
     *         upgrade, eliminating the window where claim() is callable without a
     *         GPS proof between the upgrade and manual setGpsSigner/setGpsRequired calls.
     *
     * @param _gpsSigner  Address whose private key signs claim-proof payloads.
     */
    function initializeV2(address _gpsSigner) external reinitializer(2) {
        if (_gpsSigner == address(0)) revert ZeroAddress();
        emit GpsSignerUpdated(gpsSigner, _gpsSigner);
        gpsSigner   = _gpsSigner;
        gpsRequired = true;
        emit GpsRequiredUpdated(true);
    }

    // ─── UUPS ────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {}
}
