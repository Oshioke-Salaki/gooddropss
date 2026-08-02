"use client";
import { useEffect, useState } from "react";

// Merchant-facing explainer for reward drops. Collapsible, and remembers if the
// merchant has dismissed it (so it's helpful once, then out of the way).
const KEY = "gd_rewards_explainer_open";

export function HowRewardsWork() {
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === "0") setOpen(false); } catch { /* ignore */ }
    setReady(true);
  }, []);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  if (!ready) return null;

  return (
    <div className="border-2 border-ink rounded-2xl bg-card shadow-brutal-sm mb-5 overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="font-black text-sm">🎁 How reward drops work</span>
        <span className="text-xs font-bold text-muted">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2.5">
          <Step n={1} title="Create a reward">
            Fund some G$ and set a task — e.g. <b className="text-ink">&ldquo;Buy any coffee&rdquo;</b>. It drops on the
            map right at your shop with a 🎁 tag.
          </Step>
          <Step n={2} title="A hunter does the task">
            A verified customer completes it in-store, taps <b className="text-ink">&ldquo;I did it&rdquo;</b>, and shows
            you a one-time code on their phone.
          </Step>
          <Step n={3} title="Scan to pay them">
            Tap <b className="text-ink">📷 Scan &amp; approve</b>, scan their code (or type it), and sign. The reward G$
            lands in their wallet instantly.
          </Step>

          <div className="bg-lime/40 border border-ink/20 rounded-xl px-3 py-2.5 text-xs text-ink/80 leading-relaxed">
            🔒 <b>Safe by design:</b> only you can approve your rewards, the customer must be at your shop, and each code
            is single-use and expires in ~2 minutes — a screenshot is useless. You never pay gas to approve.
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-lime border-2 border-ink flex items-center justify-center font-black text-sm">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-black text-sm leading-tight">{title}</p>
        <p className="text-xs text-muted mt-0.5 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
