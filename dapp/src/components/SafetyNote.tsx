"use client";
import { ShieldCheck } from "lucide-react";

/**
 * Trust + safety reassurance shown near the claim action. GoodDrops sends real
 * humans to physical coordinates, so a lightweight safety reminder is both
 * responsible and trust-building for users new to crypto.
 */
export function SafetyNote({ dark = false }: { dark?: boolean }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 text-xs/[150%] ${
        dark ? "bg-white/5 text-white/70" : "bg-surface text-nav-muted"
      }`}
    >
      <ShieldCheck
        className={`w-4 h-4 shrink-0 mt-0.5 ${dark ? "text-white" : "text-heading"}`}
        strokeWidth={2}
      />
      <span>
        <span className={dark ? "text-white" : "text-heading"}>Real G$, straight to your wallet.</span>{" "}
        Only hunt in safe, public places. Never enter private property or unsafe areas to claim a drop.
      </span>
    </div>
  );
}
