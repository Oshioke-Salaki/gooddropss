"use client";
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { formatG$ } from "@/lib/utils";
import { DROP_STATUS } from "@/types";
import { useMyDrops } from "@/hooks/useMyDrops";

// Server push already covers claims when the app is closed (api/push/webhook);
// this is the in-app backup, so it can afford to be unhurried.
const POLL_MS = 180_000;

// Watches the signed-in person's own drops for new claims and fires a browser
// notification. Polls their drops (not the whole map) every few minutes while the
// tab is visible — the map only carries live drops, so a claimed drop of yours
// would otherwise never be seen here.
export function useDropNotifications() {
  const { address } = useAccount();
  const { drops, fetchDrops } = useMyDrops(address);
  const prevClaimedIdsRef = useRef<Set<string>>(new Set());
  const initializedRef    = useRef(false);

  useEffect(() => {
    initializedRef.current = false;
    prevClaimedIdsRef.current = new Set();
    if (!address) return;
    fetchDrops({ fresh: false });
    const tick = () => { if (document.visibilityState === "visible") fetchDrops({ fresh: true }); };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [address, fetchDrops]);

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

      const title = "Your drop was claimed";
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
