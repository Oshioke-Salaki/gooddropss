import { describe, it, expect, vi, beforeEach } from "vitest";
import { encodeAbiParameters, encodeErrorResult, encodeEventTopics, parseAbi, type Hex } from "viem";
import { friendlyClaimError } from "@/lib/claimErrors";

// ── Fakes for Magic and the chain ────────────────────────────────────────────
const magicState = {
  loggedIn: true,
  address: "0x045EF6d83b0216802095e711437f0Db520e06a56",
  send: vi.fn(),
};
vi.mock("magic-sdk", () => ({
  Magic: class {
    user = {
      isLoggedIn: async () => magicState.loggedIn,
      getInfo: async () => ({ publicAddress: magicState.address }),
    };
    smartAccount = { sendTransaction: (...a: unknown[]) => magicState.send(...a) };
  },
}));
vi.mock("@magic-ext/smart-account", () => ({ SmartAccountExtension: class {} }));

const chain = {
  block: 100n,
  root: "0x0000000000000000000000000000000000000000" as string,
  identityReads: 0,
  receipts: new Map<string, unknown>(),
  logs: [] as { transactionHash: Hex }[],
};
vi.mock("@/lib/publicClient", () => ({
  publicClient: {
    getBlockNumber: async () => chain.block,
    getLogs: async () => chain.logs,
    waitForTransactionReceipt: async ({ hash }: { hash: string }) => chain.receipts.get(hash),
    readContract: async () => { chain.identityReads++; return chain.root; },
  },
}));

const EP = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const USER = magicState.address as Hex;
const EVENTS = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
  "event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)",
]);
const OP_HASH = `0x${"ab".repeat(32)}` as Hex;

function opLog(sender: Hex, success: boolean) {
  return {
    address: EP,
    topics: encodeEventTopics({ abi: EVENTS, eventName: "UserOperationEvent", args: { userOpHash: OP_HASH, sender, paymaster: "0x0000000000000000000000000000000000000000" } }),
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [1n, success, 0n, 50_000n],
    ),
  };
}
function revertLog(sender: Hex, revertReason: Hex) {
  return {
    address: EP,
    topics: encodeEventTopics({ abi: EVENTS, eventName: "UserOperationRevertReason", args: { userOpHash: OP_HASH, sender } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bytes" }], [1n, revertReason]),
  };
}
function receipt(logs: unknown[], status = "success") { return { status, logs }; }

const TX = `0x${"11".repeat(32)}` as Hex;
const okSim = async () => ({});

async function load() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ALCHEMY_API_KEY", "key");
  vi.stubEnv("NEXT_PUBLIC_ALCHEMY_POLICY_ID", "policy");
  vi.stubEnv("NEXT_PUBLIC_MAGIC_KEY", "pk_live_x");
  const store = new Map<string, string>();
  vi.stubGlobal("window", {});
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return import("@/lib/sponsor");
}

beforeEach(() => {
  magicState.loggedIn = true;
  magicState.send = vi.fn();
  chain.receipts.clear();
  chain.logs = [];
  chain.root = "0x0000000000000000000000000000000000000000";
  chain.identityReads = 0;
});

describe("canSponsor", () => {
  it("is true only for our Magic session's own address", async () => {
    const s = await load();
    expect(await s.canSponsor(USER, "magic")).toBe(true);
    expect(await s.canSponsor(USER.toUpperCase().replace("0X", "0x"), "magic")).toBe(true);
  });

  it("skips non-Magic wallets without touching Magic", async () => {
    const s = await load();
    expect(await s.canSponsor(USER, "injected")).toBe(false);
    expect(await s.canSponsor(USER, "metaMaskSDK")).toBe(false);
  });

  it("skips a partner Magic login (different address than our session)", async () => {
    const s = await load();
    expect(await s.canSponsor("0x000000000000000000000000000000000000bEEF", "magic")).toBe(false);
  });

  it("skips when our Magic session is signed out", async () => {
    magicState.loggedIn = false;
    const s = await load();
    expect(await s.canSponsor(USER, "magic")).toBe(false);
  });

  it("skips while the breaker is open", async () => {
    const s = await load();
    s.__test.tripBreaker();
    expect(await s.canSponsor(USER, "magic")).toBe(false);
  });

  it("is off when keys are missing", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ALCHEMY_POLICY_ID", "");
    const s = await import("@/lib/sponsor");
    expect(s.SPONSOR_CONFIGURED).toBe(false);
    expect(await s.canSponsor(USER, "magic")).toBe(false);
  });
});

describe("sendSponsored", () => {
  it("returns the hash when the user's call succeeded", async () => {
    const s = await load();
    magicState.send.mockResolvedValue({ transactionHash: TX });
    chain.receipts.set(TX, receipt([opLog(USER, true)]));
    await expect(s.sendSponsored(USER, [{ to: USER, data: "0x" }], okSim)).resolves.toBe(TX);
    const arg = magicState.send.mock.calls[0][0];
    expect(arg.chainId).toBe(42220);
    expect(arg.calls[0].value).toBe("0");
  });

  it("surfaces an inner revert by name even though the bundle succeeded", async () => {
    const s = await load();
    const { GOOD_DROPS_ABI } = await import("@/lib/contracts");
    const errAbi = GOOD_DROPS_ABI.filter((x) => x.type === "error" && x.name === "AlreadyClaimed");
    const data = encodeErrorResult({ abi: errAbi, errorName: "AlreadyClaimed" } as never);
    magicState.send.mockResolvedValue({ transactionHash: TX });
    chain.receipts.set(TX, receipt([revertLog(USER, data), opLog(USER, false)]));
    const err = await s.sendSponsored(USER, [{ to: USER, data: "0x" }], okSim).catch((e) => e);
    expect(err).toBeInstanceOf(s.CallRevertedError);
    expect(friendlyClaimError(err).kind).toBe("claimed");
  });

  it("decodes a plain require() string", async () => {
    const s = await load();
    const data = encodeErrorResult({
      abi: [{ type: "error", name: "Error", inputs: [{ type: "string", name: "message" }] }],
      errorName: "Error", args: ["ERC20: transfer amount exceeds balance"],
    });
    expect(s.__test.decodeRevert(data)).toEqual({ name: "Error", reason: "ERC20: transfer amount exceeds balance" });
  });

  it("ignores user ops from other senders in the same bundle", async () => {
    const s = await load();
    const other = "0x000000000000000000000000000000000000bEEF" as Hex;
    magicState.send.mockResolvedValue({ transactionHash: TX });
    chain.receipts.set(TX, receipt([opLog(other, true)]));
    await expect(s.sendSponsored(USER, [{ to: USER, data: "0x" }], okSim)).rejects.toBeInstanceOf(s.CallRevertedError);
  });

  it("treats a throw as success when the op landed anyway (never sends twice)", async () => {
    const s = await load();
    magicState.send.mockRejectedValue(new Error("connection lost"));
    chain.logs = [{ transactionHash: TX }];
    chain.receipts.set(TX, receipt([opLog(USER, true)]));
    const sim = vi.fn(okSim);
    await expect(s.sendSponsored(USER, [{ to: USER, data: "0x" }], sim)).resolves.toBe(TX);
    expect(sim).not.toHaveBeenCalled();
  });

  it("throws the real revert when the call itself would fail, and keeps sponsoring", async () => {
    const s = await load();
    magicState.send.mockRejectedValue(new Error("Magic RPC Error: [-32603] Failed to sign transaction"));
    const real = new Error("The contract function reverted with error: DropExpired()");
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    try {
      const p = s.sendSponsored(USER, [{ to: USER, data: "0x" }], async () => { throw real; }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await p).toBe(real);
    } finally { vi.useRealTimers(); }
    expect(s.__test.breakerOpen()).toBe(false);
  });

  it("reports unavailable and opens the breaker when nothing landed and the call is fine", async () => {
    const s = await load();
    magicState.send.mockRejectedValue(new Error("policy spend limit reached"));
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    try {
      const p = s.sendSponsored(USER, [{ to: USER, data: "0x" }], okSim).catch((e) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await p).toBeInstanceOf(s.SponsorUnavailableError);
    } finally { vi.useRealTimers(); }
    expect(s.__test.breakerOpen()).toBe(true);
  });

  it("on a hang, never falls back: says it's still confirming and opens the breaker", async () => {
    const s = await load();
    magicState.send.mockImplementation(() => new Promise(() => {}));
    const sim = vi.fn(okSim);
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    try {
      const p = s.sendSponsored(USER, [{ to: USER, data: "0x" }], sim).catch((e) => e);
      await vi.advanceTimersByTimeAsync(120_000);
      const err = await p;
      expect(err).not.toBeInstanceOf(s.SponsorUnavailableError);
      expect(err.message).toMatch(/taking longer than usual/);
    } finally { vi.useRealTimers(); }
    expect(sim).not.toHaveBeenCalled();
    expect(s.__test.breakerOpen()).toBe(true);
  });

  it("on a hang, picks up an op that lands late", async () => {
    const s = await load();
    magicState.send.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    try {
      const p = s.sendSponsored(USER, [{ to: USER, data: "0x" }], okSim).catch((e) => e);
      await vi.advanceTimersByTimeAsync(50_000);
      chain.logs = [{ transactionHash: TX }];
      chain.receipts.set(TX, receipt([opLog(USER, true)]));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await p).toBe(TX);
    } finally { vi.useRealTimers(); }
  });

  it("waits for the op on-chain when Magic returns no hash", async () => {
    const s = await load();
    magicState.send.mockResolvedValue({ transactionHash: undefined });
    chain.logs = [{ transactionHash: TX }];
    chain.receipts.set(TX, receipt([opLog(USER, true)]));
    await expect(s.sendSponsored(USER, [{ to: USER, data: "0x" }], okSim)).resolves.toBe(TX);
  });
});

describe("policyAllows (mirrors the webhook)", () => {
  it("refuses an unverified dropper's approve, allows it once verified", async () => {
    const s = await load();
    const { encodeFunctionData, maxUint256 } = await import("viem");
    const { ERC20_ABI, GOOD_DROPS_ADDRESS, G_TOKEN_ADDRESS } = await import("@/lib/contracts");
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [GOOD_DROPS_ADDRESS, maxUint256] });
    expect(await s.policyAllows(USER, [{ to: G_TOKEN_ADDRESS, data }])).toBe(false);
    s.__test.reset();
    chain.root = USER;
    expect(await s.policyAllows(USER, [{ to: G_TOKEN_ADDRESS, data }])).toBe(true);
  });

  it("allows sending G$ only for a verified person, and caches the read", async () => {
    const s = await load();
    const { encodeFunctionData } = await import("viem");
    const { ERC20_ABI, G_TOKEN_ADDRESS } = await import("@/lib/contracts");
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [USER, 1n] });
    expect(await s.policyAllows(USER, [{ to: G_TOKEN_ADDRESS, data }])).toBe(false);
    s.__test.reset();
    chain.root = USER;
    expect(await s.policyAllows(USER, [{ to: G_TOKEN_ADDRESS, data }])).toBe(true);
    expect(await s.policyAllows(USER, [{ to: G_TOKEN_ADDRESS, data }])).toBe(true);
    expect(chain.identityReads).toBe(2);
  });

  it("never allows calls outside GoodDrops, without reading identity", async () => {
    const s = await load();
    chain.root = USER;
    expect(await s.policyAllows(USER, [{ to: "0x000000000000000000000000000000000000dEaD", data: "0x" }])).toBe(false);
    expect(chain.identityReads).toBe(0);
  });
});
