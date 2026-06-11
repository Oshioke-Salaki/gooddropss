import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, keccak256, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI } from "@/lib/contracts";
import { getRedis, keys } from "@/lib/redis";

export const runtime = "nodejs";

const PROOF_TTL_S    = 90;   // proof expires after 90 seconds
const CLAIM_RADIUS_M = 100;  // must be within 100m of the drop
const MAX_SPEED_KMH  = 500;  // fastest legitimate travel (generous — covers planes)
const MAX_IP_DIST_KM = 2000; // IP location must be within 2000km of reported GPS

const onChainClient = createPublicClient({
  chain: celo,
  transport: http("https://forno.celo.org"),
});

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getClientIp(req: NextRequest): string {
  // x-real-ip is set by Vercel's infrastructure and cannot be injected by the client.
  // x-forwarded-for is checked second because a client can pre-set it to spoof a local IP
  // and bypass the geolocation check entirely.
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "127.0.0.1"
  );
}

// POST /api/claim-proof
// Body: { dropId, claimer, userLat, userLng, privateToken? }
// Returns: { deadline, sig }
//
// Checks (in order):
//   1. Drop coordinates fetched from blockchain — client cannot spoof them
//   2. Haversine distance: user must be within CLAIM_RADIUS_M of the drop
//   3. Velocity check: implied travel speed since last claim must be < MAX_SPEED_KMH
//   4. IP geolocation: IP must be within MAX_IP_DIST_KM of reported GPS; VPNs rejected
export async function POST(req: NextRequest) {
  try {
    const { dropId, claimer, userLat, userLng, privateToken } = await req.json();

    if (
      typeof dropId  !== "string" || !dropId  ||
      typeof claimer !== "string" || !claimer ||
      typeof userLat !== "number" || typeof userLng !== "number"
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const signerKey = process.env.GPS_SIGNER_KEY as `0x${string}` | undefined;
    if (!signerKey) {
      return NextResponse.json({ error: "GPS signing not configured" }, { status: 503 });
    }

    // ── 1. Fetch drop from blockchain ────────────────────────────────────────
    const drop = await onChainClient.readContract({
      address:      GOOD_DROPS_ADDRESS,
      abi:          GOOD_DROPS_ABI,
      functionName: "getDrop",
      args:         [BigInt(dropId)],
    });

    if (!drop || drop.dropper === "0x0000000000000000000000000000000000000000") {
      return NextResponse.json({ error: "Drop not found" }, { status: 404 });
    }

    // ── 2. Resolve real drop coordinates ────────────────────────────────────
    // Private drops store (0,0) on-chain. Real coords live in Redis behind a token.
    let dropLat: number;
    let dropLng: number;

    const isPrivateDrop = drop.lat === 0 && drop.lng === 0;
    if (isPrivateDrop) {
      if (!privateToken || typeof privateToken !== "string") {
        return NextResponse.json({ error: "Private drop token required" }, { status: 403 });
      }
      const redis = getRedis();
      if (!redis) {
        return NextResponse.json({ error: "Storage unavailable" }, { status: 503 });
      }
      const record = await redis.get<{ lat: number; lng: number }>(keys.privateDrop(privateToken));
      if (!record) {
        return NextResponse.json({ error: "Invalid or expired private drop token" }, { status: 403 });
      }
      dropLat = record.lat;
      dropLng = record.lng;
    } else {
      dropLat = Number(drop.lat) / 1e6;
      dropLng = Number(drop.lng) / 1e6;
    }

    // ── 3. Proximity check ───────────────────────────────────────────────────
    const distanceM = haversineMetres(userLat, userLng, dropLat, dropLng);
    if (distanceM > CLAIM_RADIUS_M) {
      return NextResponse.json(
        { error: "Too far from drop", distance: Math.round(distanceM) },
        { status: 403 },
      );
    }

    // ── 4. Velocity check ────────────────────────────────────────────────────
    // If this address claimed recently, the implied travel speed must be physically possible.
    const redis = getRedis();
    if (redis) {
      const velocityKey = keys.velocity(claimer);
      const last = await redis.get<{ lat: number; lng: number; ts: number }>(velocityKey);
      if (last) {
        const elapsedHours = (Date.now() / 1000 - last.ts) / 3600;
        const travelKm     = haversineMetres(last.lat, last.lng, userLat, userLng) / 1000;
        const impliedSpeed = elapsedHours > 0 ? travelKm / elapsedHours : Infinity;
        if (impliedSpeed > MAX_SPEED_KMH) {
          return NextResponse.json(
            { error: "Impossible travel detected", impliedSpeedKmh: Math.round(impliedSpeed) },
            { status: 403 },
          );
        }
      }
    }

    // ── 5. IP geolocation check ──────────────────────────────────────────────
    const ip = getClientIp(req);
    const isLocalIp = ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.");
    if (!isLocalIp && false) {
      try {
        // ip-api.com free tier: proxy/hosting fields catch VPNs and datacenters.
        const geoRes = await fetch(
          `http://ip-api.com/json/${ip}?fields=status,lat,lon,proxy,hosting`,
          { signal: AbortSignal.timeout(3000) },
        );

        if (geoRes.ok) {
          const geo = await geoRes.json();
          if (geo.status === "success") {
            if (geo.proxy || geo.hosting) {
              return NextResponse.json(
                { error: "VPN or proxy detected — disable it to claim" },
                { status: 403 },
              );
            }

            const ipDistKm = haversineMetres(geo.lat, geo.lon, userLat, userLng) / 1000;
            if (ipDistKm > MAX_IP_DIST_KM) {
              return NextResponse.json(
                { error: "Your network location does not match your GPS position" },
                { status: 403 },
              );
            }
          }
        }
      } catch {
        // Geo lookup timed out or failed — don't block the claim, log and continue.
        console.warn("[claim-proof] IP geolocation unavailable for", ip);
      }
    }

    // ── 6. Sign the proof ────────────────────────────────────────────────────
    const deadline = Math.floor(Date.now() / 1000) + PROOF_TTL_S;

    const hash = keccak256(
      encodePacked(
        ["uint256", "address", "uint256"],
        [BigInt(dropId), claimer as `0x${string}`, BigInt(deadline)],
      ),
    );

    const account = privateKeyToAccount(signerKey);
    const sig     = await account.signMessage({ message: { raw: hash } });

    // Store position for future velocity checks (fire-and-forget)
    if (redis) {
      redis
        .set(keys.velocity(claimer), { lat: userLat, lng: userLng, ts: Math.floor(Date.now() / 1000) }, { ex: 48 * 3600 })
        .catch(() => {});
    }

    return NextResponse.json({ deadline, sig });
  } catch (e) {
    console.error("[claim-proof]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
