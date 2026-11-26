import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { readRewardGas } from "@/lib/rewardGasServer";
import { REWARD_WALLET_ADDRESS } from "@/lib/contracts";

export const runtime = "nodejs";

// GET /api/admin/reward-gas — can the reward wallet pay for gas? Admin only.
export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  try {
    return NextResponse.json({ wallet: REWARD_WALLET_ADDRESS, ...(await readRewardGas()) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't read the chain" }, { status: 503 });
  }
}
