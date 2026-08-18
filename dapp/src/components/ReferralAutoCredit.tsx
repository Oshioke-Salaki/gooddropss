"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useReferral } from "@/hooks/useReferral";
import { fetchHasActivity } from "@/lib/subgraph";

// Headless — replaces the old tap-to-credit card. An invited newcomer's referrer
// is credited automatically once the newcomer (a) is a verified human AND (b) has
// actually done a basic task: claimed a drop or created one. Gating on a real
// action means ambassadors only earn credit for hunters who genuinely engage —
// not bare sign-ups.
//
// When both are true, the invitee's OWN wallet signs the attribution silently in
// the background (Magic embedded wallets, the primary connector, don't prompt).
// The signature still proves THIS invitee consented (their wallet + their link),
// so a referrer can never credit strangers — we've just made it automatic.
export function ReferralAutoCredit() {
  const { address } = useAccount();
  const { canAccept, acceptReferral } = useReferral();
  const [didTask, setDidTask] = useState(false);
  const tried = useRef(false);

  // Detect the basic task instantly: a claim fires gd:streak-updated / gd:claim-success,
  // a drop fires gd:drop-created. Also a cheap subgraph check on mount catches
  // anything already done in a prior session.
  useEffect(() => {
    if (!canAccept || !address || didTask) return;
    let alive = true;
    fetchHasActivity(address).then((has) => { if (alive && has) setDidTask(true); }).catch(() => {});
    const onAction = () => setDidTask(true);
    window.addEventListener("gd:streak-updated", onAction);
    window.addEventListener("gd:claim-success", onAction);
    window.addEventListener("gd:drop-created", onAction);
    return () => {
      alive = false;
      window.removeEventListener("gd:streak-updated", onAction);
      window.removeEventListener("gd:claim-success", onAction);
      window.removeEventListener("gd:drop-created", onAction);
    };
  }, [canAccept, address, didTask]);

  // Fire the silent credit once verified + task done.
  useEffect(() => {
    if (!canAccept || !didTask || tried.current) return;
    tried.current = true;
    acceptReferral()
      .then((ok) => { if (!ok) tried.current = false; })
      .catch(() => { tried.current = false; });
  }, [canAccept, didTask, acceptReferral]);

  return null;
}
