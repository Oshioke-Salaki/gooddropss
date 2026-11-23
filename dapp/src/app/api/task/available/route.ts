import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis } from "@/lib/redis";
import { resolveIdentityRoot } from "@/lib/identityRoot";
import { liveRewards, type ChainReward } from "@/lib/taskRewards";
import { getSpot } from "@/lib/spotStore";
import { isSpotActive } from "@/lib/spotStatus";

export const runtime = "nodejs";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/task/available?spotId=&address=
// The rewards a customer can earn at this shop right now (lib/taskRewards), so
// the shop sheet and the payment receipt can show the reward code in place.
// `address` is optional; with it, a reward held for this customer still shows.
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ rewards: [] }, { headers: NO_STORE });

  const spotId = req.nextUrl.searchParams.get("spotId") ?? "";
  if (!spotId || spotId.length > 64) return NextResponse.json({ error: "spotId required" }, { status: 400 });
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  if (address && !ADDR_RE.test(address)) return NextResponse.json({ error: "Invalid address" }, { status: 400 });

  try {
    // Only live shops run rewards, and an owner can't earn their own.
    const spot = await getSpot(redis, spotId);
    if (!spot || !isSpotActive(spot) || (address && spot.ownerAddress?.toLowerCase() === address)) {
      return NextResponse.json({ rewards: [] }, { headers: NO_STORE });
    }
    const root = address ? await resolveIdentityRoot(address) : null;
    const rewards = await liveRewards(redis, spotId, {
      root,
      readDrops: async (ids) => {
        const res = await publicClient.multicall({
          contracts: ids.map((id) => ({
            address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [BigInt(id)],
          })),
        });
        return res.map((r): ChainReward | null => {
          if (r.status !== "success") return null;
          const d = r.result as unknown as { status: number; expiry: number; amount: bigint; hint: string };
          return { status: Number(d.status), expiry: Number(d.expiry), amount: d.amount, hint: d.hint };
        });
      },
    });
    return NextResponse.json({ rewards }, { headers: NO_STORE });
  } catch (e) {
    console.error("[task/available]", e);
    return NextResponse.json({ error: "Couldn't load rewards right now." }, { status: 503, headers: NO_STORE });
  }
}
