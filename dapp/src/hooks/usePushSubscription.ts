"use client";
import { useState, useEffect, useCallback } from "react";
import { useAccount } from "wagmi";

export type PushStatus = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading";

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

export function usePushSubscription() {
  const { address } = useAccount();
  const [status, setStatus] = useState<PushStatus>("loading");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    navigator.serviceWorker.ready.then((sw) =>
      sw.pushManager.getSubscription()
    ).then((sub) => {
      setStatus(sub ? "subscribed" : "unsubscribed");
    }).catch(() => setStatus("unsubscribed"));
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return false;
      }

      const sw  = await navigator.serviceWorker.ready;

      // Clear any stale subscription before subscribing (VAPID key changes cause "push service error")
      const existing = await sw.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();

      let sub: PushSubscription;

      if (vapidKey) {
        sub = await sw.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
        // Store subscription server-side
        await fetch("/api/push/subscribe", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ subscription: sub.toJSON(), address }),
        });
      } else {
        // VAPID not configured — just request permission for in-app browser notifications
        sub = await sw.pushManager.subscribe({ userVisibleOnly: true }).catch(() => null as unknown as PushSubscription);
      }

      setStatus("subscribed");
      return true;
    } catch (e) {
      console.error("[usePushSubscription] subscribe failed", e);
      setStatus("unsubscribed");
      return false;
    }
  }, [address]);

  const unsubscribe = useCallback(async () => {
    try {
      const sw  = await navigator.serviceWorker.ready;
      const sub = await sw.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      if (address) {
        await fetch("/api/push/subscribe", {
          method:  "DELETE",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ address }),
        });
      }
      setStatus("unsubscribed");
    } catch (e) {
      console.error("[usePushSubscription] unsubscribe failed", e);
    }
  }, [address]);

  return { status, subscribe, unsubscribe };
}
