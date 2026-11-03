"use client";
import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";

/**
 * What the customer shows at the counter. The "paid … ago" line keeps ticking,
 * so a cashier can tell a live receipt from an old screenshot at a glance.
 */
export function ShopReceipt({ amount, shop, tx, paidAt, onDone }: {
  amount: string; shop: string; tx: string; paidAt: number; onDone: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - paidAt) / 1000));
  const agoText = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)} min ${secs % 60}s ago`;
  const when = new Date(paidAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex flex-col items-center text-center pt-6 pb-2 gap-y-5">
      <div className="w-full rounded-3xl bg-brand text-white p-6 flex flex-col items-center gap-y-3">
        <span className="success-pop w-14 h-14 rounded-full bg-white/15 flex items-center justify-center">
          <Check className="w-8 h-8" strokeWidth={2.25} />
        </span>
        <p className="text-base/none text-white/80">Paid to {shop}</p>
        <p className="text-[44px]/none tabular-nums break-all">{amount} <span className="text-xl/none">G$</span></p>
        <p className="text-sm/none text-white/80 tabular-nums" aria-live="off">
          {when} · paid {agoText}
        </p>
        <p className="mt-1 rounded-full bg-white/15 px-3 py-2 text-xs/none tracking-[0.12em] tabular-nums">
          REF {tx.slice(-6).toUpperCase()}
        </p>
      </div>
      <p className="text-sm/[140%] text-nav-muted">Show this screen to the cashier. It&apos;s already in their wallet.</p>
      <a
        href={`https://celoscan.io/tx/${tx}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm/none text-brand hover:underline"
      >
        View receipt <ExternalLink className="w-4 h-4" />
      </a>
      <button
        type="button"
        onClick={onDone}
        className="w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
          motion-safe:transition-colors hover:bg-brand/90"
      >
        Done
      </button>
    </div>
  );
}
