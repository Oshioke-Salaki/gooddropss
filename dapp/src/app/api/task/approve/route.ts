import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis } from "@/lib/redis";
import { approveMessage, NONCE_RE } from "@/lib/taskLock";
import { approveTaskToken, parseApproveToken } from "@/lib/taskApprove";
import { scannerAddress } from "@/lib/scannerSession";
import { ownerVerification, OWNER_GATE } from "@/lib/dropGate";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const NO_STORE = { "Cache-Control": "private, no-store" };

// POST /api/task/approve  Body: { nonce | code, merchantWallet?, signature? }
// The shop owner scans the customer's code (or types its 6 digits) and approves
// it. Who is approving is proven one of two ways:
//   • the scanner is unlocked on this phone (lib/scannerSession): no signature;
//   • legacy: a signature over this exact nonce (older open pages still send it).
// The owner must be GoodDollar-verified at the moment of approval. The rules
// themselves live in lib/taskApprove.
//
// 401 { code: "scanner_locked" } means "unlock the scanner, then send this again".
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const token = parseApproveToken(body.code ?? body.nonce);
  if (!token) return NextResponse.json({ error: "That code doesn't look right." }, { status: 400 });

  const claimed = typeof body.merchantWallet === "string" ? body.merchantWallet.toLowerCase() : "";
  if (claimed && !ADDR_RE.test(claimed)) return NextResponse.json({ error: "Invalid merchant wallet" }, { status: 400 });

  let merchant: string;
  if (typeof body.signature === "string" && body.signature) {
    // Legacy: signed exactly this nonce. Through the chain client so smart-contract
    // wallets (ERC-1271/6492) verify too. Only ever the long nonce, never the short code.
    if (!claimed || !NONCE_RE.test(token)) return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 });
    try {
      const ok = await publicClient.verifyMessage({ address: claimed as Hex, message: approveMessage(token), signature: body.signature as Hex });
      if (!ok) return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 });
    } catch { return NextResponse.json({ error: "Couldn't confirm it's you. Please try again." }, { status: 401 }); }
    merchant = claimed;
  } else {
    const unlocked = await scannerAddress(redis);
    // No session, or it belongs to a different wallet than the one now signed in.
    if (!unlocked || (claimed && claimed !== unlocked)) {
      return NextResponse.json(
        { error: "Unlock your scanner to approve rewards.", code: "scanner_locked" },
        { status: 401, headers: NO_STORE },
      );
    }
    merchant = unlocked;
  }

  // Verified owners only, on every approval (verification can lapse mid-day).
  const gate = await ownerVerification(merchant);
  if (gate !== "verified") {
    return NextResponse.json({ error: OWNER_GATE[gate].error }, { status: OWNER_GATE[gate].status, headers: NO_STORE });
  }

  const result = await approveTaskToken(redis, {
    token,
    merchant,
    readDrop: async (dropId) => {
      const d = await publicClient.readContract({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(dropId)],
      });
      return { status: Number(d.status), expiry: Number(d.expiry) };
    },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
  return NextResponse.json({ ok: true, dropId: result.dropId }, { headers: NO_STORE });
}
