import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import type { RiddleRecord } from "@/lib/riddles";

export const runtime = "nodejs";

// GET /api/riddles/[dropId]?claimer=0x…
//
// Returns the QUESTION ONLY. The answer (and its hash and salt) never leave the
// server — the whole feature rests on that.
//
// `lockedByOther` lets the UI say "someone solved this first" instead of letting
// a hunter walk to a drop they can't currently claim.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dropId: string }> },
) {
  try {
    const { dropId } = await params;
    if (!/^\d+$/.test(dropId)) {
      return NextResponse.json({ error: "Invalid drop id" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
    }

    const record = await redis.get<RiddleRecord>(keys.riddle(dropId));
    if (!record) {
      return NextResponse.json({ riddle: null });
    }

    const claimer = req.nextUrl.searchParams.get("claimer")?.toLowerCase() ?? null;
    const holder  = await redis.get<string>(keys.riddleLock(dropId));

    return NextResponse.json({
      riddle: {
        question:      record.question,
        lockedByOther: !!holder && holder !== claimer,
        lockedByMe:    !!holder && holder === claimer,
      },
    });
  } catch (e) {
    console.error("[riddles GET]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
