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
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        background: dark ? "rgba(255,255,255,0.05)" : "#f5f4f0",
        border: `1.5px solid ${dark ? "rgba(255,255,255,0.12)" : "#e8e6e0"}`,
        borderRadius: 10,
        padding: "9px 12px",
        fontSize: 11.5, lineHeight: 1.45,
        color: dark ? "#9a9db0" : "#5a5a5a",
      }}
    >
      <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 1 }} color={dark ? "#BFFD00" : "#111"} />
      <span>
        <b style={{ color: dark ? "#fff" : "#111" }}>Real G$, straight to your wallet.</b>{" "}
        Only hunt in safe, public places — never enter private property or unsafe areas to claim a drop.
      </span>
    </div>
  );
}
