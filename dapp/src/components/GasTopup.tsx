"use client";
import { useEffect } from "react";
import { useAccount } from "wagmi";
import { Zap } from "lucide-react";
import { toast } from "@/lib/toast";
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

/** `preview` shows the notice without asking the faucet — design QA only. */
export function GasTopup({ preview = false }: { preview?: boolean } = {}) {
  const { address } = useAccount();
  const { isVerified } = useIdentityStatus();

  useEffect(() => {
    if (preview) { notify(); return; }
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
        if (!cancelled && d.ok) notify();
      } catch { /* silent — this is a background nicety */ }
    })();
    return () => { cancelled = true; };
  }, [address, isVerified, preview]);

  return null;
}

function notify() {
  toast("You're topped up for claiming", {
    id: "gas-topup",
    description: "GoodDollar covered the small cost of claiming, so it stays free for you.",
    icon: <Zap className="w-4 h-4" strokeWidth={2} />,
  });
}
