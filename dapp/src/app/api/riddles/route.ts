import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, verifyMessage } from "viem";
import { celo } from "viem/chains";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";
import {
  hashAnswer, normalizeAnswer, riddleOwnershipMessage,
  RIDDLE_MAX_ANSWER, RIDDLE_MAX_QUESTION,
  type RiddleRecord,
} from "@/lib/riddles";

export const runtime = "nodejs";

const onChainClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

// POST /api/riddles
// Body: { dropId, question, answer, signature }
//
// Attaching a riddle to a drop you don't own would let anyone brick a stranger's
// drop, so ownership is proved two ways at once: the dropper address is read from
// the CHAIN (never trusted from the request), and the caller must produce a
// signature from that exact address. Riddles are write-once — no overwrite, which
// also makes the signature safe to replay.
export async function POST(req: NextRequest) {
  try {
    const { dropId, question, answer, signature } = await req.json();

    if (
      typeof dropId    !== "string" || !/^\d+$/.test(dropId) ||
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
    // An answer that normalises to nothing (e.g. "???") could never be matched.
    if (!normalizeAnswer(answer)) {
      return NextResponse.json({ error: "Answer must contain letters or numbers" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
    }

    // ── Ownership: the chain is the source of truth ─────────────────────────
    const drop = await onChainClient.readContract({
      address:      GOOD_DROPS_ADDRESS,
      abi:          GOOD_DROPS_ABI,
      functionName: "getDrop",
      args:         [BigInt(dropId)],
    });

    if (!drop || drop.dropper === "0x0000000000000000000000000000000000000000") {
      return NextResponse.json({ error: "Drop not found" }, { status: 404 });
    }

    const valid = await verifyMessage({
      address:   drop.dropper as `0x${string}`,
      message:   riddleOwnershipMessage(dropId),
      signature: signature as `0x${string}`,
    });
    if (!valid) {
      return NextResponse.json({ error: "Not the owner of this drop" }, { status: 403 });
    }

    // ── Write once ──────────────────────────────────────────────────────────
    const salt   = crypto.randomUUID();
    const record: RiddleRecord = {
      question:   q,
      answerHash: await hashAnswer(answer, salt),
      salt,
      dropper:    drop.dropper.toLowerCase(),
      createdAt:  Math.floor(Date.now() / 1000),
    };

    const stored = await redis.set(keys.riddle(dropId), record, { nx: true });
    if (stored === null) {
      return NextResponse.json({ error: "This drop already has a riddle" }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[riddles POST]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
