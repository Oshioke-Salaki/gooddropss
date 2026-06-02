import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";
import { parseDropHint } from "@/lib/utils";

export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const origin = req.nextUrl.origin;

    // Support both Goldsky formats
    const type  = body.type  ?? body.event ?? "";
    const data  = body.data  ?? body.payload ?? {};

    if (type.includes("DropClaimed") || data.status === "1" || data.status === 1) {
      const dropper = data.dropper ?? data.fields?.dropper ?? "";
      const amount  = data.amount  ?? data.fields?.amount  ?? "0";
      const dropId  = data.dropId  ?? data.id ?? "";
      const hint    = data.hint    ?? data.fields?.hint    ?? "";

      // Track campaign claim count in Redis
      if (hint) {
        const { campaignId } = parseDropHint(hint);
        if (campaignId) {
          const redis = getRedis();
          if (redis) await redis.incr(keys.campaignClaims(campaignId));
        }
      }

      if (dropper) {
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

    if (type.includes("DropCreated")) {
      // Flash drop alert — broadcast not possible without stored locations,
      // so we notify the dropper their drop is live.
      const dropper = data.dropper ?? data.fields?.dropper ?? "";
      const amount  = data.amount  ?? data.fields?.amount  ?? "0";
      const dropId  = data.dropId  ?? data.id ?? "";
      const expiry  = Number(data.expiry ?? data.fields?.expiry ?? 0);
      const createdAt = Number(data.createdAt ?? data.fields?.createdAt ?? 0);
      const isFlash = createdAt > 0 && expiry > 0 && expiry - createdAt <= 3600;

      if (dropper && isFlash) {
        await sendPush(
          origin,
          dropper,
          "⚡ Your flash drop is live!",
          `${formatAmount(amount)} G$ is now live — expires in under 1 hour!`,
          `/drop/${dropId}`,
          `flash-${dropId}`
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push/webhook]", e);
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}
