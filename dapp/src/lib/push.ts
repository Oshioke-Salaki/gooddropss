import webpush from "web-push";
import type { Redis } from "@upstash/redis";
import { keys } from "@/lib/redis";

// One place that sends a web push and keeps the subscriber list honest.
//
// Every sender (the notify endpoint, the Goldsky webhook, the crons) goes
// through here, so an expired subscription is cleaned up the first time any of
// them hits it instead of erroring on every send forever after.

export interface PushMessage {
  title: string;
  body:  string;
  url?:  string;
  tag?:  string;
}

export type PushResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "no-subscription" | "expired" | "failed" };

let vapidSet = false;
function ensureVapid(): boolean {
  if (vapidSet) return true;
  const pub   = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv  = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL;
  if (!pub || !priv || !email) return false;
  webpush.setVapidDetails(`mailto:${email}`, pub, priv);
  vapidSet = true;
  return true;
}

/** Forget a subscriber everywhere background jobs would look for them. */
async function forget(redis: Redis, address: string) {
  const a = address.toLowerCase();
  await Promise.all([
    redis.del(keys.subscription(a)),
    redis.srem(keys.subscribersIndex(), a),
    redis.hdel(keys.huntersLoc(), a), // no subscription, no nearby alerts
  ]);
}

export async function sendPush(redis: Redis, address: string, msg: PushMessage): Promise<PushResult> {
  if (!ensureVapid()) return { ok: false, reason: "not-configured" };

  const raw = await redis.get<string | object>(keys.subscription(address));
  if (!raw) {
    // The subscription itself has a 90-day TTL, but the index entry doesn't —
    // prune it here so cron batches stop spending slots on dead addresses.
    await redis.srem(keys.subscribersIndex(), address.toLowerCase()).catch(() => {});
    return { ok: false, reason: "no-subscription" };
  }
  const subscription = typeof raw === "string" ? JSON.parse(raw) : raw;

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: msg.title,
        body:  msg.body,
        url:   msg.url ?? "/",
        tag:   msg.tag ?? "gooddrops",
      }),
    );
    return { ok: true };
  } catch (e) {
    // 404/410 = the browser unsubscribed or the subscription expired. That's a
    // normal outcome for any long-lived list, not a server error.
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      await forget(redis, address).catch(() => {});
      return { ok: false, reason: "expired" };
    }
    console.error("[push] send failed", status ?? "", (e as Error)?.message ?? e);
    return { ok: false, reason: "failed" };
  }
}
