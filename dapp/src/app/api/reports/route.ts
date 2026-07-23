import { NextRequest, NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";
import { getRedis, keys } from "@/lib/redis";
import { isVerifiedHuman } from "@/lib/identityRoot";
import { cleanLandmarkName } from "@/lib/landmarks";
import {
  isReportReason, reportMessage, DROP_ID_RE, REPORT_DETAIL_MAX,
  type DropReport,
} from "@/lib/reports";

export const runtime = "nodejs";

const SIG_WINDOW = 24 * 60 * 60 * 1000;

// POST /api/reports — a verified hunter flags a drop.
// Body: { dropId, reason, detail?, signature, timestamp }
export async function POST(req: NextRequest) {
  let body: { dropId?: string; reason?: string; detail?: string; signature?: string; timestamp?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const { dropId, reason, signature, timestamp } = body;

  if (!dropId || !DROP_ID_RE.test(dropId))
    return NextResponse.json({ error: "Invalid drop" }, { status: 400 });
  if (!isReportReason(reason))
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  if (!signature || typeof signature !== "string" || !signature.startsWith("0x"))
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
    return NextResponse.json({ error: "Missing timestamp" }, { status: 400 });
  if (Math.abs(Date.now() - timestamp) > SIG_WINDOW)
    return NextResponse.json({ error: "Signature expired — try again" }, { status: 400 });

  // cleanLandmarkName strips control chars + collapses whitespace (reused here).
  const detail = typeof body.detail === "string"
    ? cleanLandmarkName(body.detail).slice(0, REPORT_DETAIL_MAX) || undefined
    : undefined;

  // Recover signer, must be a verified human (Sybil-resistant anti-spam).
  let signer: string;
  try {
    signer = (await recoverMessageAddress({
      message: reportMessage(dropId, reason, timestamp),
      signature: signature as `0x${string}`,
    })).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  if (!(await isVerifiedHuman(signer)))
    return NextResponse.json({ error: "Verify with GoodDollar to report." }, { status: 403 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });

  try {
    const report: DropReport = {
      dropId, reporter: signer, reason,
      ts: Math.floor(Date.now() / 1000),
      ...(detail ? { detail } : {}),
    };
    // One report per (reporter, drop) — re-reporting just updates in place.
    await redis.set(keys.dropReport(dropId, signer), JSON.stringify(report));
    await redis.sadd(keys.dropReporters(dropId), signer);
    await redis.sadd(keys.reportedDropsIndex(), dropId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[reports/post]", e);
    return NextResponse.json({ error: "Could not submit report" }, { status: 500 });
  }
}
