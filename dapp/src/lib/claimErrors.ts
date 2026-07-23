// Turns the raw, scary errors that wallets / RPCs / the GoodDollar SDK throw into
// short, honest, actionable messages. Never dump a raw "-32603 Load failed" or
// "insufficient funds for gas * price + value: have 111…" at a hunter again.

export type ClaimErrorKind =
  | "rejected"   // user dismissed the wallet prompt (show nothing)
  | "claimed"    // someone else already claimed it (terminal)
  | "expired"    // the drop expired (terminal)
  | "self"       // can't claim your own drop (terminal)
  | "gas"        // not enough CELO for the network fee / faucet couldn't top up
  | "network"    // RPC/timeout/rate-limit — transient
  | "verify"     // GoodDollar verification needed
  | "location"   // not close enough
  | "unknown";

export interface FriendlyError {
  message:  string;   // "" means show nothing (user simply cancelled)
  terminal: boolean;  // true → retrying can't succeed (offer "back to map", not "try again")
  kind:     ClaimErrorKind;
}

// Pull a searchable string out of whatever was thrown (Error, viem error with
// shortMessage/details/cause, plain object, string).
export function extractErrorText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  const e = raw as Record<string, unknown>;
  const parts = [
    e.shortMessage, e.details, e.message, e.reason,
    (e.cause as Record<string, unknown> | undefined)?.shortMessage,
    (e.cause as Record<string, unknown> | undefined)?.message,
    (e.cause as Record<string, unknown> | undefined)?.details,
  ].filter((p): p is string => typeof p === "string");
  return parts.join(" · ");
}

export function friendlyClaimError(raw: unknown): FriendlyError {
  const text = extractErrorText(raw);
  const m = text.toLowerCase();

  // User simply dismissed the wallet prompt — not an error worth showing.
  if (/user rejected|user denied|rejected the request|denied transaction|action_rejected|request rejected|user cancell?ed|cancell?ed by user/.test(m))
    return { message: "", terminal: false, kind: "rejected" };

  // Already claimed / no longer active — retrying can't win.
  if (/already claimed|alreadyclaimed|already been claimed|dropinactive|no longer active|not active anymore|solved (this|the) riddle first|someone else|reserved|being claimed/.test(m))
    return { message: "Someone beat you to it — this drop has already been claimed.", terminal: true, kind: "claimed" };

  // Expired (but not a *proof* expiry, which is transient — handled below).
  if (/dropexpired|drop has expired|drop expired/.test(m))
    return { message: "This drop has expired and can no longer be claimed.", terminal: true, kind: "expired" };

  if (/selfclaim|claim your own|own drop/.test(m))
    return { message: "You can't claim your own drop.", terminal: true, kind: "self" };

  // Gas / faucet — the big one behind the reported errors. Not enough CELO for the
  // network fee, or GoodDollar's gas faucet couldn't top the wallet up.
  if (/insufficient funds|insufficient balance|gas \* price|gas required exceeds|balance threshold|after faucet|faucet|out of gas|not enough celo|funds for gas/.test(m))
    return { message: "You don't have enough CELO for the tiny network fee, and the gas faucet is busy right now. Give it a minute, then tap Try again.", terminal: false, kind: "gas" };

  // Server proof expired / already used → just retry to mint a fresh one.
  if (/proofexpired|proof expired|proofalreadyused|proof.*(used|expired)|deadline|signature expired/.test(m))
    return { message: "That took a little too long — tap Try again for a fresh attempt.", terminal: false, kind: "network" };

  // RPC / network / rate-limit — transient. Covers "Magic RPC Error [-32603] Load failed".
  if (/load failed|network error|networkerror|timeout|timed out|failed to fetch|-32603|-32000|rpc|connection|econn|econnreset|502|503|504|bad gateway|service unavailable|rate limit|too many requests|nonce|replacement transaction/.test(m))
    return { message: "Network hiccup — check your connection and tap Try again.", terminal: false, kind: "network" };

  if (/not whitelisted|notwhitelisted|not verified|identity|whitelist/.test(m))
    return { message: "You need to verify with GoodDollar before you can claim.", terminal: false, kind: "verify" };

  if (/too far|out of range|not close enough|proximity|location|gps/.test(m))
    return { message: "You're not close enough to this drop — get nearer and try again.", terminal: false, kind: "location" };

  // Anything else: stay human, never leak the raw string.
  return { message: "Couldn't complete the claim — please try again.", terminal: false, kind: "unknown" };
}

// Same idea for the daily UBI claim (GoodDollar Citizen SDK), which mostly fails
// on the gas faucet. Reuses the claim mapper; only the fallback copy differs.
export function friendlyUbiError(raw: unknown): string {
  const fe = friendlyClaimError(raw);
  if (fe.kind === "rejected") return "";
  if (fe.kind === "gas")
    return "GoodDollar's gas faucet is busy — it couldn't cover the fee to send your UBI. Try again in a minute.";
  if (fe.kind === "unknown") return "Couldn't claim your UBI right now — please try again.";
  return fe.message;
}
