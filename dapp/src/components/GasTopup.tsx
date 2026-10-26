"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Fuel } from "lucide-react";
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
  const [notice, setNotice] = useState(preview);

  useEffect(() => {
    if (preview) return;
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
  }, [address, isVerified, preview]);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="modal-fade-in fixed left-1/2 -translate-x-1/2 z-[1300] pointer-events-none font-sans
        flex items-center gap-2.5 rounded-full bg-nav-active text-white p-1.5 pr-5
        shadow-[0px_4px_16px_0px_#00000029] max-w-[calc(100vw-24px)]"
      style={{ bottom: "calc(140px + env(safe-area-inset-bottom, 0px))" }}
    >
      <span className="w-8 h-8 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
        <Fuel className="w-4 h-4" strokeWidth={2} />
      </span>
      <span className="text-sm/none truncate">Gas topped up — you&apos;re covered for claims</span>
    </div>
  );
}
