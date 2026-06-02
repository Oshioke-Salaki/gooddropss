import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { getRedis, keys } from "@/lib/redis";

export const runtime = "nodejs";

function getVapid() {
  const pub   = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv  = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL;
  if (!pub || !priv || !email) return null;
  return { pub, priv, email };
}

interface NotifyPayload {
  to:    string; // wallet address
  title: string;
  body:  string;
  url?:  string;
  tag?:  string;
}

// POST /api/push/notify  (internal — called by webhook handler)
export async function POST(req: NextRequest) {
  // Verify internal secret to prevent abuse
  const secret = req.headers.get("x-internal-secret");
  if (secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: NotifyPayload = await req.json();
    const vapid = getVapid();
    const redis = getRedis();

    if (!vapid || !redis) {
      return NextResponse.json({ ok: false, reason: "Push not configured" });
    }

    webpush.setVapidDetails(`mailto:${vapid.email}`, vapid.pub, vapid.priv);

    const raw = await redis.get<string>(keys.subscription(payload.to));
    if (!raw) return NextResponse.json({ ok: false, reason: "No subscription for address" });

    const subscription = typeof raw === "string" ? JSON.parse(raw) : raw;

    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body:  payload.body,
        url:   payload.url ?? "/",
        tag:   payload.tag ?? "gooddrops",
      })
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    // Subscription expired / invalid — clean it up
    const err = e as { statusCode?: number };
    if (err?.statusCode === 410) {
      const redis = getRedis();
      if (redis) {
        const payload: NotifyPayload = await req.json().catch(() => ({ to: "" }));
        if (payload.to) await redis.del(keys.subscription(payload.to));
      }
    }
    console.error("[push/notify]", e);
    return NextResponse.json({ error: "Send failed" }, { status: 500 });
  }
}
