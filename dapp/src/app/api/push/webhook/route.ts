import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import type { Redis } from "@upstash/redis";
import { parseDropHint, gpsToDeg, haversineDistance } from "@/lib/utils";
import { normalizeWebhook, readField } from "@/lib/webhookNormalize";

export const runtime = "nodejs";

// "Drop near you" broadcast tuning.
const NEARBY_RADIUS_M   = 2000;             // how close counts as "near you"
const NEARBY_COOLDOWN_S = 20 * 60;          // min gap between nearby pings per hunter
const NEARBY_FRESH_S    = 3 * 24 * 60 * 60; // ignore stale shared locations
const NEARBY_MAX        = 100;              // cap fan-out per drop

// POST /api/push/webhook
// Called by Goldsky when DropClaimed or DropCreated events fire.
// Goldsky webhook body shape (adjust if their format differs):
// {
//   "id": "...",
//   "type": "DropClaimed" | "DropCreated",
//   "data": {
//     "dropId": "42",
//     "dropper": "0x...",
//     "claimer": "0x...",
//     "amount": "10000000000000000000",
//     ...
//   }
// }

function formatAmount(wei: string): string {
  const n = Number(wei) / 1e18;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

async function sendPush(baseUrl: string, to: string, title: string, body: string, url: string, tag: string) {
  await fetch(`${baseUrl}/api/push/notify`, {
    method:  "POST",
    headers: {
      "Content-Type":       "application/json",
      "x-internal-secret":  process.env.INTERNAL_WEBHOOK_SECRET ?? "",
    },
    body: JSON.stringify({ to, title, body, url, tag }),
  });
}

// Alert hunters who opted into location-based alerts and are within range of a
// brand-new public drop. Coarse locations only; each hunter is rate-limited and
// the fan-out is capped. Never notifies the dropper about their own drop.
async function notifyNearby(
  baseUrl: string, redis: Redis,
  opts: { dropId: string; dropperLower: string; lat: number; lng: number; amount: string },
) {
  const all = (await redis.hgetall<Record<string, string>>(keys.huntersLoc())) ?? {};
  const now = Math.floor(Date.now() / 1000);
  const candidates: { addr: string; dist: number }[] = [];
  const stale: string[] = [];

  for (const [addr, raw] of Object.entries(all)) {
    if (addr === opts.dropperLower) continue;
    const [latS, lngS, tsS] = String(raw).split(",");
    const lat = Number(latS), lng = Number(lngS), ts = Number(tsS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { stale.push(addr); continue; }
    if (!Number.isFinite(ts) || now - ts > NEARBY_FRESH_S) { stale.push(addr); continue; }
    const dist = haversineDistance(opts.lat, opts.lng, lat, lng);
    if (dist <= NEARBY_RADIUS_M) candidates.push({ addr, dist });
  }

  // Prune stale rows so the hash doesn't grow unbounded.
  if (stale.length) await redis.hdel(keys.huntersLoc(), ...stale);

  candidates.sort((a, b) => a.dist - b.dist);
  let sent = 0;
  for (const { addr } of candidates) {
    if (sent >= NEARBY_MAX) break;
    // Atomic rate-limit: NX set fails (returns null) if a cooldown is live.
    const ok = await redis.set(keys.hunterNearbyCd(addr), "1", { nx: true, ex: NEARBY_COOLDOWN_S });
    if (!ok) continue;
    await sendPush(
      baseUrl, addr,
      "💰 New drop near you!",
      `${formatAmount(opts.amount)} G$ just dropped nearby — first to find it wins.`,
      `/drop/${opts.dropId}`,
      `nearby-${opts.dropId}`,
    );
    sent++;
  }
  return sent;
}

// Events older than this are treated as backfill/replay and never push — so a
// re-index or a Mirror bootstrap can't blast stale "new drop near you" pings.
const FRESH_EVENT_S = 15 * 60;

export async function POST(req: NextRequest) {
  // If a Goldsky webhook secret is configured, require it — stops anyone from
  // forging drop events to trigger spam pushes. Optional (backwards-compatible):
  // when unset, the endpoint stays open as before. Goldsky sends the secret in
  // the `goldsky-webhook-secret` header.
  const expectedSecret = process.env.GOLDSKY_WEBHOOK_SECRET;
  if (expectedSecret) {
    const got = req.headers.get("goldsky-webhook-secret") ?? req.headers.get("x-goldsky-secret");
    if (got !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();
    const origin = req.nextUrl.origin;
    const { created, claimed, fields } = normalizeWebhook(body);

    const f = (k: string): unknown => readField(fields, k);

    const dropper = String(f("dropper") ?? "");
    const amount  = String(f("amount") ?? "0");
    const dropId  = String(f("dropId") ?? f("id") ?? "");
    const hint    = String(f("hint") ?? "");
    const nowS    = Math.floor(Date.now() / 1000);

    if (claimed) {
      // Track campaign claim count in Redis
      if (hint) {
        const { campaignId } = parseDropHint(hint);
        if (campaignId) {
          const redis = getRedis();
          if (redis) await redis.incr(keys.campaignClaims(campaignId));
        }
      }

      const claimedAt = Number(f("claimedAt") ?? 0);
      const claimFresh = claimedAt === 0 || nowS - claimedAt <= FRESH_EVENT_S;
      if (dropper && claimFresh) {
        await sendPush(
          origin,
          dropper,
          "Your drop was claimed! 🎯",
          `Someone found your ${formatAmount(amount)} G$ drop. Check your wallet!`,
          `/drop/${dropId}`,
          `claim-${dropId}`
        );
      }
    }

    if (created) {
      const expiry    = Number(f("expiry") ?? 0);
      const createdAt = Number(f("createdAt") ?? 0);
      // Only act on genuinely fresh creations (guards against backfill replay).
      const createFresh = createdAt === 0 || nowS - createdAt <= FRESH_EVENT_S;
      const isFlash = createdAt > 0 && expiry > 0 && expiry - createdAt <= 3600;

      // Flash drop alert — let the dropper know their short-lived drop is live.
      if (dropper && isFlash && createFresh) {
        await sendPush(
          origin,
          dropper,
          "⚡ Your flash drop is live!",
          `${formatAmount(amount)} G$ is now live — expires in under 1 hour!`,
          `/drop/${dropId}`,
          `flash-${dropId}`
        );
      }

      // "Drop near you" broadcast to opted-in hunters. Public drops only — a
      // private drop must never reveal itself on the map or via a broadcast.
      const isPrivate = hint ? parseDropHint(hint).isPrivate : false;
      const lat = gpsToDeg(Number(f("lat") ?? NaN));
      const lng = gpsToDeg(Number(f("lng") ?? NaN));
      const redis = getRedis();
      if (redis && dropId && createFresh && !isPrivate &&
          Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
        try {
          await notifyNearby(origin, redis, {
            dropId,
            dropperLower: dropper.toLowerCase(),
            lat, lng, amount,
          });
        } catch (e) {
          console.error("[push/webhook] nearby broadcast failed", e);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push/webhook]", e);
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}
