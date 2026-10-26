import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { sendPush } from "@/lib/push";

export const runtime = "nodejs";

interface NotifyPayload {
  to:    string; // wallet address
  title: string;
  body:  string;
  url?:  string;
  tag?:  string;
}

// POST /api/push/notify  (internal — called by the webhook handler and crons)
export async function POST(req: NextRequest) {
  // Verify internal secret to prevent abuse
  const secret = req.headers.get("x-internal-secret");
  if (!process.env.INTERNAL_WEBHOOK_SECRET || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read the body once, up front. (It used to be re-read in the error path,
  // which always failed, so expired subscriptions were never cleaned up.)
  let payload: NotifyPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!payload?.to || !payload.title) {
    return NextResponse.json({ error: "Missing to/title" }, { status: 400 });
  }

  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: false, reason: "Push not configured" });

  const result = await sendPush(redis, payload.to, payload);
  if (result.ok) return NextResponse.json({ ok: true });
  // Only a genuine send failure is a 5xx; "no subscription" and "expired" are
  // expected outcomes the caller can ignore.
  return NextResponse.json(result, { status: result.reason === "failed" ? 502 : 200 });
}
