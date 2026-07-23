export const GOOD_DROPS_ADDRESS =
  "0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131" as const;

export const G_TOKEN_ADDRESS =
  "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A" as const;

export const CLAIM_RADIUS_M = 100;

export const GOOD_DROPS_ABI = [
  // ── Read ─────────────────────────────────────────────────────────────────
  {
    name: "dropCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalLocked",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "maxDropAmount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint96" }],
  },
  {
    name: "minDropAmount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint96" }],
  },
  // ── Owner: drop limits ─────────────────────────────────────────────────────
  {
    name: "setMaxDropAmount",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newMax", type: "uint96" }],
    outputs: [],
  },
  {
    name: "setMinDropAmount",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newMin", type: "uint96" }],
    outputs: [],
  },
  {
    name: "identityRequired",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    name: "getDrop",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "dropper", type: "address" },
          { name: "amount", type: "uint96" },
          { name: "claimer", type: "address" },
          { name: "expiry", type: "uint40" },
          { name: "claimedAt", type: "uint40" },
          { name: "status", type: "uint8" },
          { name: "lat", type: "int32" },
          { name: "lng", type: "int32" },
          { name: "hint", type: "string" },
        ],
      },
    ],
  },
  {
    name: "isClaimable",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  // ── Write ────────────────────────────────────────────────────────────────
  {
    name: "createDrop",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lat", type: "int32" },
      { name: "lng", type: "int32" },
      { name: "amount", type: "uint96" },
      { name: "expiry", type: "uint40" },
      { name: "hint", type: "string" },
    ],
    outputs: [],
  },
  {
    // Batch: N identical drops at different coordinates in one transaction.
    name: "createManyDrops",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lats", type: "int32[]" },
      { name: "lngs", type: "int32[]" },
      { name: "amount", type: "uint96" },
      { name: "expiry", type: "uint40" },
      { name: "hint", type: "string" },
    ],
    outputs: [
      { name: "firstId", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
  },
  {
    name: "claim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "claimWithProof",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dropId",   type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "sig",      type: "bytes"   },
    ],
    outputs: [],
  },
  {
    name: "gpsRequired",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    name: "initializeV2",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_gpsSigner", type: "address" }],
    outputs: [],
  },
  {
    name: "reclaimExpired",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "reclaimManyExpired",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "dropIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    name: "extendExpiry",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "newExpiry", type: "uint40" },
    ],
    outputs: [],
  },
  {
    name: "extendManyExpiry",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dropIds", type: "uint256[]" },
      { name: "newExpiry", type: "uint40" },
    ],
    outputs: [],
  },
  // ── Events ───────────────────────────────────────────────────────────────
  {
    name: "DropCreated",
    type: "event",
    inputs: [
      { name: "dropId", type: "uint256", indexed: true },
      { name: "dropper", type: "address", indexed: true },
      { name: "lat", type: "int32", indexed: false },
      { name: "lng", type: "int32", indexed: false },
      { name: "amount", type: "uint96", indexed: false },
      { name: "expiry", type: "uint40", indexed: false },
      { name: "hint", type: "string", indexed: false },
    ],
  },
  {
    name: "DropClaimed",
    type: "event",
    inputs: [
      { name: "dropId", type: "uint256", indexed: true },
      { name: "claimer", type: "address", indexed: true },
      { name: "dropper", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
      { name: "claimedAt", type: "uint40", indexed: false },
    ],
  },
  {
    name: "DropReclaimed",
    type: "event",
    inputs: [
      { name: "dropId", type: "uint256", indexed: true },
      { name: "dropper", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
    ],
  },
  {
    name: "DropExtended",
    type: "event",
    inputs: [
      { name: "dropId", type: "uint256", indexed: true },
      { name: "dropper", type: "address", indexed: true },
      { name: "newExpiry", type: "uint40", indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
