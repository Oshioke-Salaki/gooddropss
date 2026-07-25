import { getRedis, keys } from "@/lib/redis";
import { BUILTIN_BADGES, badgeTypeId, type BadgeDef } from "@/lib/badges";

export const runtime = "nodejs";

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

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// GET /api/badges/image/[typeId] — a branded 1:1 SVG badge card (soulbound token
// art). Self-contained (no external assets), so it renders anywhere.
export async function GET(_req: Request, { params }: { params: Promise<{ typeId: string }> }) {
  const { typeId } = await params;
  const def = await defForTypeId(typeId);
  const emoji = def?.emoji ?? "🏅";
  const name = esc(def?.name ?? "GoodDrops Badge");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#1c1c1c"/><stop offset="100%" stop-color="#0a0a0a"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#BFFD00"/><stop offset="100%" stop-color="#8FBF00"/>
    </linearGradient>
  </defs>
  <rect width="600" height="600" fill="url(#bg)"/>
  <circle cx="300" cy="248" r="150" fill="none" stroke="url(#ring)" stroke-width="6" opacity="0.9"/>
  <circle cx="300" cy="248" r="150" fill="#111"/>
  <text x="300" y="248" font-size="150" text-anchor="middle" dominant-baseline="central">${emoji}</text>
  <text x="300" y="452" font-family="'Space Grotesk',Arial,sans-serif" font-size="42" font-weight="800" fill="#fff" text-anchor="middle">${name}</text>
  <text x="300" y="500" font-family="'Space Grotesk',Arial,sans-serif" font-size="22" font-weight="700" fill="#BFFD00" text-anchor="middle" letter-spacing="3">GOODDROPS · SOULBOUND</text>
  <text x="300" y="548" font-family="'Space Grotesk',Arial,sans-serif" font-size="18" fill="#666" text-anchor="middle">proof of presence</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
