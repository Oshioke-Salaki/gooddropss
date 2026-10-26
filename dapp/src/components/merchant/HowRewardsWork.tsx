"use client";
import { useEffect, useState } from "react";
import { Gift, Camera, ShieldCheck, ChevronDown } from "lucide-react";

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
    <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 p-6 text-left cursor-pointer
          motion-safe:transition-colors hover:bg-surface/60"
      >
        <span className="flex items-center gap-4 min-w-0">
          <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
            <Gift className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <span className="text-lg/none text-heading truncate">How reward drops work</span>
        </span>
        <ChevronDown
          className={`w-5 h-5 shrink-0 text-nav-muted motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="px-6 pb-6 flex flex-col gap-y-5">
          <Step n={1} title="Create a reward">
            Fund some G$ and set a task — e.g. <span className="text-heading">&ldquo;Buy any coffee&rdquo;</span>.
            It drops on the map right at your shop as a reward.
          </Step>
          <Step n={2} title="A hunter does the task">
            A verified customer completes it in-store, taps <span className="text-heading">&ldquo;I did it&rdquo;</span>,
            and shows you a one-time code on their phone.
          </Step>
          <Step n={3} title="Scan to pay them">
            Tap <span className="inline-flex items-center gap-1 text-heading"><Camera className="w-3.5 h-3.5" strokeWidth={2} /> Scan &amp; approve</span>,
            scan their code (or type it), and sign. The reward G$ lands in their wallet instantly.
          </Step>

          <div className="flex gap-3 rounded-2xl bg-surface px-4 py-3.5 text-sm/[140%] text-nav-muted">
            <ShieldCheck className="w-4.5 h-4.5 shrink-0 mt-px text-heading" strokeWidth={1.75} />
            <span>
              <span className="text-heading">Safe by design:</span> only you can approve your rewards, the customer must
              be at your shop, and each code is single-use and expires in about 5 minutes — a screenshot is useless.
              You never pay gas to approve.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="shrink-0 w-8 h-8 rounded-full bg-brand-soft text-brand flex items-center justify-center text-sm/none">
        {n}
      </span>
      <div className="min-w-0 flex flex-col gap-y-2 pt-1.5">
        <p className="text-base/none text-heading">{title}</p>
        <p className="text-sm/[140%] text-nav-muted">{children}</p>
      </div>
    </div>
  );
}
