import { NextRequest, NextResponse } from "next/server";
import { firstSight, gcConfig, store, syncCashOut, verifySignature, type GcCashOut } from "@/lib/goodcashServer";

export const runtime = "nodejs";

// POST /api/goodcash/webhook ← GoodCash. Signed with GOODCASH_WEBHOOK_SECRET
// (HMAC over the RAW body, within 5 minutes). Each event is handled once; the
// same event may arrive twice and that's fine. We answer fast (< 5 s).
//
// cashout.paid is what adds a cash out to the central total. Failed, refunded
// and expired ones free the person's daily allowance again.
export async function POST(req: NextRequest) {
  const secret = process.env.GOODCASH_WEBHOOK_SECRET;
  if (!secret || !gcConfig()) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("goodcash-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  let event: { id?: string; type?: string; mode?: string; data?: GcCashOut };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad body" }, { status: 400 }); }
  if (!event.id || !event.type) return NextResponse.json({ error: "Bad body" }, { status: 400 });

  // A test event can never touch the live total, and the other way round.
  if (event.mode && event.mode !== gcConfig()!.mode) return NextResponse.json({ ok: true, ignored: "mode" });
  if (!event.type.startsWith("cashout.") || event.type === "cashout.test" || !event.data?.id) {
    return NextResponse.json({ ok: true });
  }

  const s = store();
  if (!s) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 }); // GoodCash retries
  if (!(await firstSight(s, event.id))) return NextResponse.json({ ok: true, duplicate: true });
  try {
    await syncCashOut(s, event.data);
  } catch (e) {
    console.error("[goodcash webhook]", e);
    return NextResponse.json({ error: "Try again" }, { status: 500 }); // retried later
  }
  return NextResponse.json({ ok: true });
}
