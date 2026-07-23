import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, recoverMessageAddress } from "viem";
import { celo } from "viem/chains";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";
import {
  hashAnswer, normalizeAnswer, riddleTokenMessage, RIDDLE_TOKEN_RE,
  RIDDLE_MAX_ANSWER, RIDDLE_MAX_QUESTION,
  type RiddleRecord, type RiddleTokenRecord,
} from "@/lib/riddles";

export const runtime = "nodejs";

const ZERO = "0x0000000000000000000000000000000000000000";
// Pending token records self-expire. Binding normally happens seconds after the
// signature, but we keep them a full day so a dropper who's interrupted mid-flow
// (network blip, app closed) can still resume the bind — with no new signature.
const TOKEN_TTL_S = 24 * 60 * 60;

const onChainClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

// POST /api/riddles — STORE phase (before the drop exists).
// Body: { token, question, answer, signature }
//
// The dropper signs a random token; we recover the signer and stash the riddle
// under that token. Taking the signature up-front means a rejected prompt costs
// nothing — no on-chain drop is created — so a riddle drop can never be stranded
// by a skipped signature. The answer is only ever stored salted + hashed.
export async function POST(req: NextRequest) {
  try {
    const { token, question, answer, signature } = await req.json();

    if (
      typeof token     !== "string" || !RIDDLE_TOKEN_RE.test(token) ||
      typeof question  !== "string" ||
      typeof answer    !== "string" ||
      typeof signature !== "string" || !signature.startsWith("0x")
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const q = question.trim();
    if (!q || q.length > RIDDLE_MAX_QUESTION) {
      return NextResponse.json({ error: "Question is empty or too long" }, { status: 400 });
    }
    if (answer.length > RIDDLE_MAX_ANSWER) {
      return NextResponse.json({ error: "Answer is too long" }, { status: 400 });
    }
    if (!normalizeAnswer(answer)) {
      return NextResponse.json({ error: "Answer must contain letters or numbers" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    // Recover the signer — this is the person who will own the riddle. No chain
    // read here: the drop doesn't exist yet. Ownership is enforced at bind time.
    let owner: string;
    try {
      owner = (await recoverMessageAddress({
        message: riddleTokenMessage(token),
        signature: signature as `0x${string}`,
      })).toLowerCase();
    } catch {
      return NextResponse.json({ error: "Bad signature" }, { status: 401 });
    }

    const salt = crypto.randomUUID();
    const record: RiddleTokenRecord = {
      question:   q,
      answerHash: await hashAnswer(answer, salt),
      salt,
      owner,
      createdAt:  Math.floor(Date.now() / 1000),
    };

    // Write-once per token. A repeat with the same token (retry) is a no-op success.
    const stored = await redis.set(keys.riddleToken(token), record, { nx: true, ex: TOKEN_TTL_S });
    if (stored === null) return NextResponse.json({ ok: true, already: true });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[riddles POST]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PATCH /api/riddles — BIND phase (after the drop exists).
// Body: { token, dropId }
//
// No signature: authorisation is that the token's signer (recorded at store time)
// matches the drop's on-chain dropper. A griefer can't bind their token to someone
// else's drop (owner ≠ dropper), and it's a plain network call so it can't be
// stranded by a wallet prompt — it's safely auto-retryable.
export async function PATCH(req: NextRequest) {
  try {
    const { token, dropId } = await req.json();
    if (typeof token !== "string" || !RIDDLE_TOKEN_RE.test(token))
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    if (typeof dropId !== "string" || !/^\d+$/.test(dropId))
      return NextResponse.json({ error: "Invalid drop id" }, { status: 400 });

    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

    // Idempotent: if it's already bound (e.g. a retry after a lost response), succeed.
    const existing = await redis.get<RiddleRecord>(keys.riddle(dropId));
    if (existing) {
      await redis.del(keys.riddleToken(token));
      return NextResponse.json({ ok: true, already: true });
    }

    const pending = await redis.get<RiddleTokenRecord>(keys.riddleToken(token));
    if (!pending) return NextResponse.json({ error: "Riddle setup expired or not found" }, { status: 404 });

    const drop = await onChainClient.readContract({
      address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(dropId)],
    });
    if (!drop || drop.dropper === ZERO) {
      return NextResponse.json({ error: "Drop not found" }, { status: 404 });
    }

    // The signer of the token must be the drop's creator — no cross-binding.
    if (pending.owner !== drop.dropper.toLowerCase()) {
      return NextResponse.json({ error: "Not the owner of this drop" }, { status: 403 });
    }

    const record: RiddleRecord = {
      question:   pending.question,
      answerHash: pending.answerHash,
      salt:       pending.salt,
      dropper:    drop.dropper.toLowerCase(),
      createdAt:  Math.floor(Date.now() / 1000),
    };

    // Write-once per drop. If a concurrent retry beat us, that's fine — succeed.
    await redis.set(keys.riddle(dropId), record, { nx: true });
    await redis.del(keys.riddleToken(token));

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[riddles PATCH]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
