import { NextRequest, NextResponse } from "next/server";
import { isAddress, recoverMessageAddress, type Hex } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { FLOW_CHAIN_ID, FLOW_COUNCIL, FLOW_ELIGIBILITY_URL, buildClaimMessage } from "@/lib/flowstate";

export const runtime = "nodejs";
export const maxDuration = 75;

/** Flow State accepts a claim signed up to 5 minutes ago; stay inside that. */
const MAX_AGE_MS = 4 * 60 * 1000;
/** One claim in flight per wallet; longer than the upstream timeout below. */
const COOLDOWN_S = 75;

/**
 * POST /api/flowstate/claim  Body: { address, issuedAt, signature }
 *
 * Forwards a wallet's signed "claim voting rights" message to Flow State's
 * eligibility service, which adds the wallet as a voter in the GoodBuilders
 * council if its GoodDollar identity qualifies. The browser can't call that
 * service directly (no CORS), so it goes through here.
 *
 * The council and chain are fixed: nothing the caller sends picks where the
 * claim goes. We forward only the wallet address and its signed message, never
 * an email, session or token. The signature is checked here first so we don't
 * relay junk on anyone's behalf.
 */
export async function POST(req: NextRequest) {
  let body: { address?: unknown; issuedAt?: unknown; signature?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }

  const address = typeof body.address === "string" ? body.address : "";
  const issuedAt = Number(body.issuedAt);
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!isAddress(address)) return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > MAX_AGE_MS || issuedAt - Date.now() > 60_000) {
    return NextResponse.json({ error: "That took too long. Please try again.", expired: true }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return NextResponse.json({ error: "Couldn't confirm it's you." }, { status: 400 });

  // A plain wallet signature (what email wallets and wallet apps produce).
  // Flow State re-checks it on its side as well.
  try {
    const signer = await recoverMessageAddress({ message: buildClaimMessage(address, issuedAt), signature: signature as Hex });
    if (signer.toLowerCase() !== address.toLowerCase()) {
      return NextResponse.json({ error: "Couldn't confirm it's you." }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "Couldn't confirm it's you." }, { status: 401 });
  }

  const redis = getRedis();
  if (redis) {
    const first = await redis.set(keys.flowClaimRl(address), "1", { nx: true, ex: COOLDOWN_S }).catch(() => "OK");
    if (first === null) return NextResponse.json({ error: "Still working on your last request. Give it a moment.", busy: true }, { status: 429 });
  }

  try {
    const res = await fetch(FLOW_ELIGIBILITY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, chainId: FLOW_CHAIN_ID, councilId: FLOW_COUNCIL, signature, issuedAt }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as { success?: boolean; alreadyClaimed?: boolean; reason?: string; error?: string } | null;
    if (!data) return NextResponse.json({ error: "Flow State didn't answer. Please try again." }, { status: 502 });
    if (data.success) return NextResponse.json({ ok: true });
    if (data.alreadyClaimed) {
      return NextResponse.json({ alreadyClaimed: true, error: "Your GoodDollar identity already votes from another wallet." }, { status: 409 });
    }
    if (data.reason === "expired_signature") {
      return NextResponse.json({ expired: true, error: "That took too long. Please try again." }, { status: 400 });
    }
    console.warn("[flowstate/claim] refused", address, data.error, data.reason);
    // Flow State's own wording is technical; keep a plain message, mark it final
    // unless it's clearly temporary.
    const temporary = res.status >= 500 || /busy|try again|timeout/i.test(data.error ?? "");
    return NextResponse.json({ error: temporary ? "Flow State is busy. Please try again in a moment." : "Flow State couldn't add you as a voter.", final: !temporary, detail: data.error ?? null }, { status: temporary ? 503 : 422 });
  } catch (e) {
    console.error("[flowstate/claim]", e);
    return NextResponse.json({ error: "Couldn't reach Flow State. Please try again." }, { status: 502 });
  } finally {
    if (redis) await redis.del(keys.flowClaimRl(address)).catch(() => {});
  }
}
