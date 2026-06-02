"use client";
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { formatG$ } from "@/lib/utils";
import { DROP_STATUS, type Drop } from "@/types";

// Monitors the user's own drops for new claims and fires browser/push notifications.
export function useDropNotifications(drops: Drop[]) {
  const { address } = useAccount();
  const prevClaimedIdsRef = useRef<Set<string>>(new Set());
  const initializedRef    = useRef(false);

  useEffect(() => {
    if (!address || drops.length === 0) return;

    const myDrops = drops.filter(
      (d) => d.dropper.toLowerCase() === address.toLowerCase()
    );

    const nowClaimed = new Set(
      myDrops
        .filter((d) => d.status === DROP_STATUS.Claimed)
        .map((d) => String(d.id))
    );

    if (!initializedRef.current) {
      // First run — seed the set without notifying
      prevClaimedIdsRef.current = nowClaimed;
      initializedRef.current = true;
      return;
    }

    for (const id of nowClaimed) {
      if (prevClaimedIdsRef.current.has(id)) continue;
      // Newly claimed drop detected
      const drop = myDrops.find((d) => String(d.id) === id);
      if (!drop) continue;

      const title = "Your drop was claimed! 🎯";
      const body  = `Someone found your ${formatG$(drop.amount)} G$ drop!`;

      // Browser notification (works when tab is open or PWA is in foreground)
      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          navigator.serviceWorker?.ready.then((sw) => {
            sw.showNotification(title, {
              body,
              icon:  "/icons/192",
              badge: "/icons/192",
              tag:   `claim-${id}`,
              data:  { url: `/drop/${id}` },
            });
          }).catch(() => {
            // Fallback to basic Notification if SW not available
            new Notification(title, { body, icon: "/icons/192" });
          });
        }
      }
    }

    prevClaimedIdsRef.current = nowClaimed;
  }, [drops, address]);
}
