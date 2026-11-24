"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Coins, Gift, MapPin } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { useFirstDrop } from "@/hooks/useFirstDrop";
import { track } from "@/lib/analytics";

// ── When to ask ─────────────────────────────────────────────────────────────
// Right after a daily claim is the moment: they've just been handed G$. Also,
// gently, on a visit (for people who claim elsewhere), but never more than once
// every few days, and never more than a handful of times in all.

const memKey = (a: string) => `gd:fd-nudge:${a.toLowerCase()}`;
const LOAD_GAP_MS = 3 * 86_400_000;
const CLAIM_GAP_MS = 12 * 3_600_000;
const MAX_SHOWS = 5;

type Memory = { n: number; last: number };
function recall(a: string): Memory {
  try { return { n: 0, last: 0, ...JSON.parse(localStorage.getItem(memKey(a)) ?? "{}") }; } catch { return { n: MAX_SHOWS, last: Date.now() }; }
}
function remember(a: string) {
  const m = recall(a);
  try { localStorage.setItem(memKey(a), JSON.stringify({ n: m.n + 1, last: Date.now() })); } catch { /* private mode */ }
}
function mayShow(a: string, gapMs: number): boolean {
  const m = recall(a);
  return m.n < MAX_SHOWS && Date.now() - m.last > gapMs;
}

const anyDialogOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');
const QUIET_ROUTES = ["/admin", "/auth", "/switch-to-email", "/renew", "/merchant", "/sponsor"];

/** Opens the drop drawer: in place on the map, or by going there. */
export function openDropDrawer(router: ReturnType<typeof useRouter>, pathname: string) {
  if (pathname === "/") window.dispatchEvent(new CustomEvent("gd:open-drop"));
  else router.push("/?drop=1");
}

/**
 * The first-drop nudge. Mounted once, app-wide.
 *   • after a daily claim (or now and then on a visit), invites a verified
 *     person who has never dropped to hide their first drop, for 200 G$;
 *   • when any drop lands, tells the server, so the bonus is registered and
 *     sent at once (the server also catches up on its own).
 */
export function FirstDropNudge() {
  const { address } = useSignedInAccount();
  const pathname = usePathname();
  const router = useRouter();
  const fd = useFirstDrop(address);
  const status = fd.view?.status;
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<"claim" | "visit" | null>(null);
  const offering = status === "offer";
  const quietRoute = QUIET_ROUTES.some((r) => pathname.startsWith(r));

  // Triggers: a claim just happened, or a visit.
  useEffect(() => {
    if (!address) return;
    const onClaim = () => setTrigger("claim");
    window.addEventListener("gd:ubi-claimed", onClaim);
    return () => window.removeEventListener("gd:ubi-claimed", onClaim);
  }, [address]);
  useEffect(() => {
    if (address && offering && !trigger && mayShow(address, LOAD_GAP_MS)) setTrigger("visit");
  }, [address, offering, trigger]);

  // Show it at a quiet moment: after the claim sheet (or anything else) closes.
  useEffect(() => {
    if (!trigger || !address || !offering || open || quietRoute) return;
    if (!mayShow(address, trigger === "claim" ? CLAIM_GAP_MS : LOAD_GAP_MS)) { setTrigger(null); return; }
    const startAt = Date.now() + (trigger === "claim" ? 900 : 6000);
    let quiet = 0;
    const t = window.setInterval(() => {
      if (Date.now() < startAt) return;
      quiet = anyDialogOpen() ? 0 : quiet + 1;
      if (quiet >= 3) {
        window.clearInterval(t);
        remember(address);
        setOpen(true);
        track("first_drop_nudge", { action: "shown" });
      }
    }, 400);
    return () => window.clearInterval(t);
  }, [trigger, address, offering, open, quietRoute]);

  // A drop landed: register the bonus straight away.
  const { report } = fd;
  const reported = useRef(false);
  useEffect(() => {
    if (!address) return;
    const onDrop = (e: Event) => {
      const det = (e as CustomEvent<{ dropper?: string; dropId?: string } | undefined>).detail;
      if (det?.dropper && det.dropper !== address.toLowerCase()) return;
      if (status !== "offer" || reported.current) return;
      reported.current = true;
      void report(det?.dropId).then((v) => {
        reported.current = false;
        if (v) track("first_drop_bonus", { status: v.status });
      });
    };
    window.addEventListener("gd:drop-created", onDrop);
    return () => window.removeEventListener("gd:drop-created", onDrop);
  }, [address, status, report]);

  const close = useCallback(() => { setOpen(false); setTrigger(null); }, []);

  if (!open || !offering) return null;
  return (
    <FirstDropSheet
      bonusG={fd.view?.bonusG ?? 200}
      onStart={() => {
        track("first_drop_nudge", { action: "start" });
        close();
        openDropDrawer(router, pathname);
      }}
      onLater={() => { track("first_drop_nudge", { action: "later" }); close(); }}
    />
  );
}

// ── The sheet ───────────────────────────────────────────────────────────────

/** A little map scene: streets, a bobbing pin, the bonus coin. Decorative. */
function Scene({ bonusG }: { bonusG: number }) {
  return (
    <div aria-hidden className="relative h-[184px] sm:h-[200px] overflow-hidden rounded-[28px] bg-brand">
      {/* Dot grid */}
      <div className="absolute inset-0 opacity-[0.22] bg-[radial-gradient(circle,#fff_1px,transparent_1.2px)] bg-[length:18px_18px]" />
      {/* Streets */}
      <div className="absolute -left-6 top-[38%] h-3 w-[130%] -rotate-[9deg] bg-white/[0.09]" />
      <div className="absolute -left-6 top-[74%] h-2 w-[130%] rotate-[4deg] bg-white/[0.07]" />
      <div className="absolute left-[22%] -top-6 h-[140%] w-2.5 rotate-[14deg] bg-white/[0.08]" />
      <div className="absolute right-[18%] -top-6 h-[140%] w-2 -rotate-[8deg] bg-white/[0.06]" />
      {/* A soft glow behind the pin */}
      <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0)_65%)]" />

      {/* Confetti flecks */}
      <span className="absolute left-[12%] top-[20%] h-2 w-2 rounded-full bg-[#FFC83D]" />
      <span className="absolute left-[26%] top-[66%] h-1.5 w-3 rotate-[30deg] rounded-full bg-white/70" />
      <span className="absolute right-[14%] bottom-[18%] h-2 w-2 rotate-45 rounded-[2px] bg-[#FF8FB1]" />
      <span className="absolute right-[30%] top-[14%] h-1.5 w-1.5 rounded-full bg-white/80" />
      <span className="absolute left-[40%] bottom-[12%] h-1.5 w-1.5 rounded-full bg-[#7CE0B5]" />

      {/* The pin, its ripple and shadow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%]">
        <div className="relative flex flex-col items-center">
          <span className="fd-ripple absolute bottom-[-6px] h-9 w-9 rounded-full border-2 border-white/70" />
          <span className="fd-bob relative z-10 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-white shadow-[0_10px_30px_rgba(10,10,90,0.35)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/treasure-chest.png" alt="" width={44} height={44} className="h-11 w-11 object-contain" />
          </span>
          <span className="fd-shadow mt-3 h-2.5 w-12 rounded-full bg-[#0A0A5A] blur-[3px]" />
        </div>
      </div>

      {/* The bonus coin */}
      <div className="absolute right-4 top-4 sm:right-6 sm:top-5">
        <div className="success-pop [animation-delay:250ms]">
          <div className="fd-float flex items-center gap-1.5 rounded-full bg-white py-1.5 pl-1.5 pr-3 shadow-[0_8px_24px_rgba(10,10,90,0.3)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gdollartoken-logo.svg" alt="" width={24} height={24} className="h-6 w-6" />
            <span className="font-anta text-[17px]/none text-heading">+{bonusG}</span>
            <span className="text-xs/none text-brand">G$</span>
          </div>
        </div>
      </div>
      <div className="absolute left-4 bottom-4 sm:left-6 sm:bottom-5 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1.5 text-[11px]/none text-white backdrop-blur-sm">
        <Gift className="h-3.5 w-3.5" strokeWidth={2} /> First drop bonus
      </div>
    </div>
  );
}

const STEPS = [
  { icon: MapPin, title: "Pick a spot", body: "Where people pass" },
  { icon: Gift, title: "Hide G$", body: "Any amount" },
  { icon: Coins, title: "Get 200 G$", body: "Once it's live" },
] as const;

/** The sheet itself, state in, events out (kept separate so it can be previewed). */
export function FirstDropSheet({ bonusG, onStart, onLater }: { bonusG: number; onStart: () => void; onLater: () => void }) {
  const steps = STEPS.map((s, i) => (i === 2 ? { ...s, title: `Get ${bonusG} G$` } : s));
  return (
    <Sheet title="Your first drop" onClose={onLater} width={440} zIndex={1460}>
      <div className="flex flex-col pt-1">
        <Scene bonusG={bonusG} />

        <h3 className="mt-6 font-anta text-[26px]/[110%] sm:text-[28px]/[110%] text-heading text-center">
          Hide your first drop
        </h3>
        <p className="mt-2.5 mx-auto max-w-[330px] text-center text-sm/[150%] text-nav-muted">
          Leave some G$ for someone nearby to find. Once it&apos;s live, we send you{" "}
          <span className="text-heading">{bonusG} G$</span> as a thank you.
        </p>

        <ol className="mt-6 grid grid-cols-3 gap-2">
          {steps.map((s, i) => (
            <li key={s.title} className="flex flex-col items-center text-center rounded-2xl bg-surface px-2 py-3.5">
              <span className={`flex h-9 w-9 items-center justify-center rounded-full ${i === 2 ? "bg-brand text-white" : "bg-white text-brand"}`}>
                <s.icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <span className="mt-2.5 text-[13px]/[125%] text-heading">{s.title}</span>
              <span className="mt-1 text-[11px]/[130%] text-nav-muted">{s.body}</span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={onStart}
          className="mt-6 h-14 w-full rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
        >
          <MapPin className="h-[18px] w-[18px]" strokeWidth={2} />
          Hide my first drop
        </button>
        <button
          type="button"
          onClick={onLater}
          className="mt-2 h-11 w-full rounded-full text-sm/none text-nav-muted cursor-pointer motion-safe:transition-colors hover:text-heading hover:bg-surface"
        >
          Maybe later
        </button>
        <p className="mt-2 text-center text-xs/[145%] text-nav-muted">
          One per person, for your very first drop.
        </p>
      </div>
    </Sheet>
  );
}

// ── Pieces used inside the drop flow ────────────────────────────────────────

/** A chip in the drop drawer while the bonus is still on offer. */
export function FirstDropChip({ bonusG }: { bonusG: number }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-brand-soft py-1.5 pl-1.5 pr-3 text-sm/none text-brand">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-white">
        <Gift className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <span className="truncate">First drop: we send you {bonusG} G$</span>
    </span>
  );
}

/** On the "your drop is live" screen, once the bonus is earned. */
export function FirstDropEarned({ bonusG, sent }: { bonusG: number; sent: boolean }) {
  return (
    <div role="status" className="mt-4 flex items-center gap-3 rounded-2xl bg-brand p-4 text-white">
      <span className="success-pop flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/gdollartoken-logo.svg" alt="" width={28} height={28} className="h-7 w-7" />
      </span>
      <div className="min-w-0">
        <p className="text-base/[130%]">
          <span className="font-anta">+{bonusG} G$</span> first drop bonus
        </p>
        <p className="mt-0.5 text-xs/[140%] text-white/75">
          {sent ? "Sent to your wallet. Welcome to the dropper club." : "On its way to your wallet."}
        </p>
      </div>
    </div>
  );
}

