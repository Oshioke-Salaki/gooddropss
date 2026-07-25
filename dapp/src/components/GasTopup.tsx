"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { publicClient } from "@/lib/publicClient";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { parseEther } from "viem";

// Headless, app-wide. When a verified hunter's CELO balance is too low to pay
// gas, quietly request a faucet top-up BEFORE they hit "insufficient funds" mid-
// claim. The server enforces all real limits (identity-root cooldowns, circuit
// breakers) — this is just the trigger, throttled client-side so we don't ping
// the API on every mount.
const LOW_BALANCE = parseEther("0.005");
const ASK_KEY     = "gd_gas_last_ask";
const ASK_GAP_MS  = 6 * 60 * 60 * 1000; // at most one ask per 6h per device

export function GasTopup() {
  const { address } = useAccount();
  const { isVerified } = useIdentityStatus();
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    if (!address || !isVerified) return;
    try {
      const last = Number(localStorage.getItem(ASK_KEY) ?? 0);
      if (Date.now() - last < ASK_GAP_MS) return;
    } catch { /* storage blocked — still fine, server throttles */ }

    let cancelled = false;
    (async () => {
      try {
        const balance = await publicClient.getBalance({ address });
        if (cancelled || balance >= LOW_BALANCE) return;
        try { localStorage.setItem(ASK_KEY, String(Date.now())); } catch { /* ignore */ }
        const res = await fetch("/api/gas-topup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        });
        const d = await res.json().catch(() => ({}));
        if (!cancelled && d.ok) {
          setNotice(true);
          setTimeout(() => setNotice(false), 5000);
        }
      } catch { /* silent — this is a background nicety */ }
    })();
    return () => { cancelled = true; };
  }, [address, isVerified]);

  if (!notice) return null;
  return (
    <div style={{
      position: "fixed", left: "50%", transform: "translateX(-50%)",
      bottom: "calc(140px + env(safe-area-inset-bottom))", zIndex: 1300,
      background: "#111", color: "#BFFD00", border: "1.5px solid #BFFD00",
      borderRadius: 100, padding: "8px 16px", fontSize: 12.5, fontWeight: 800,
      fontFamily: "'Space Grotesk', sans-serif",
      boxShadow: "0 6px 24px rgba(0,0,0,0.4)", pointerEvents: "none",
    }}>
      ⛽ Gas topped up — you&apos;re covered for claims
    </div>
  );
}
