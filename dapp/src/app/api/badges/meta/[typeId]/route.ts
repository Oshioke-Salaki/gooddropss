import { NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { BUILTIN_BADGES, badgeTypeId, type BadgeDef } from "@/lib/badges";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

// Resolve a decimal uint256 typeId (from tokenURI = baseURI + typeId) back to its
// badge definition, across builtins + admin-created customs.
async function defForTypeId(typeIdStr: string): Promise<BadgeDef | null> {
  let target: bigint;
  try { target = BigInt(typeIdStr); } catch { return null; }

  for (const b of BUILTIN_BADGES) if (badgeTypeId(b.id) === target) return b;

  const redis = getRedis();
  if (redis) {
    const custom = (await redis.hgetall<Record<string, string>>(keys.badgeDefs())) ?? {};
    for (const raw of Object.values(custom)) {
      try {
        const d = (typeof raw === "string" ? JSON.parse(raw) : raw) as BadgeDef;
        if (d?.id && badgeTypeId(d.id) === target) return d;
      } catch { /* skip */ }
    }
  }
  return null;
}

// GET /api/badges/meta/[typeId] — ERC-721 metadata JSON for a badge type.
export async function GET(_req: Request, { params }: { params: Promise<{ typeId: string }> }) {
  const { typeId } = await params;
  const def = await defForTypeId(typeId);

  const base = {
    name: def ? `GoodDrops · ${def.name}` : "GoodDrops Badge",
    description: def?.description ?? "A GoodDrops presence badge — proof a real human earned it in the real world.",
    image: `${SITE_URL}/api/badges/image/${encodeURIComponent(typeId)}`,
    external_url: `${SITE_URL}`,
    attributes: [
      { trait_type: "Badge", value: def?.name ?? "Unknown" },
      { trait_type: "Soulbound", value: "Yes" },
      { trait_type: "Type", value: def?.builtin ? "Core" : "Event" },
    ],
  };
  // Cache: metadata for a type never changes.
  return NextResponse.json(base, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
