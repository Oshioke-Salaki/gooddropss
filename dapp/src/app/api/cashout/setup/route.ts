import { NextRequest, NextResponse } from "next/server";
import { formatUnits } from "viem";
import { banks, cashOutEnabled, gc, gcConfig, store, usedTodayWei, ADDR_RE, type GcLimits } from "@/lib/goodcashServer";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { DAILY_CAP_G } from "@/lib/goodcash";

export const runtime = "nodejs";

// GET /api/cashout/setup?wallet=0x… → everything the cash-out screen needs to open:
// whether it's on, the limits, the banks, and how much of today's cap is left.
export async function GET(req: NextRequest) {
  if (!cashOutEnabled()) return NextResponse.json({ enabled: false });
  // A cheap "is it on?" for the wallet menu, without calling GoodCash.
  if (req.nextUrl.searchParams.has("probe")) return NextResponse.json({ enabled: true });
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";

  const [limits, bankList] = await Promise.all([gc<GcLimits>("/v1/limits"), banks()]);
  if (!limits.ok || !bankList.ok) {
    return NextResponse.json({ enabled: true, error: (limits.ok ? (bankList as { error: { message: string } }).error : limits.error).message }, { status: 503 });
  }

  let leftTodayG = DAILY_CAP_G;
  const s = store();
  if (s && ADDR_RE.test(wallet)) {
    const root = await resolveIdentityRoot(wallet);
    const used = Number(formatUnits(await usedTodayWei(s, root), 18));
    leftTodayG = Math.max(0, Math.floor(DAILY_CAP_G - used));
  }

  return NextResponse.json({
    enabled: true,
    mode: gcConfig()!.mode,
    minimumG: limits.data.minimumG,
    maximumG: limits.data.maximumG,
    feePercent: limits.data.feePercent,
    dailyCapG: DAILY_CAP_G,
    leftTodayG,
    banks: bankList.data,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
