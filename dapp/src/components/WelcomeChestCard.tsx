"use client";
import { useEffect, useRef, useState } from "react";
import { Gift, Loader2, Navigation, ShieldCheck, X } from "lucide-react";
import { useAccount } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { haversineDistance } from "@/lib/utils";
import { spotLabel, type WelcomeView } from "@/lib/welcome";
import type { LatLng } from "@/types";
import { track } from "@/lib/analytics";

type LiveView = Extract<WelcomeView, { state: "live" }>;

interface Props {
  view: WelcomeView | null;
  userLoc: LatLng | null;
  hiding: boolean;
  error: string;
  onHide: () => void;
  onHunt: (v: LiveView) => void;
  /** Tells the page whether the card is up, so the cold-start card steps aside. */
  onVisibleChange?: (visible: boolean) => void;
}

function walk(m: number): string {
  if (m < 30) return "right here";
  if (m < 1000) return `${Math.round(m / 10) * 10} m away`;
  return `${(m / 1000).toFixed(1)} km away`;
}

function timeLeft(expiry: number, now: number): string {
  const s = Math.max(0, expiry - now);
  const h = Math.floor(s / 3600);
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"} left to find it`;
  const m = Math.max(1, Math.floor(s / 60));
  return `${m} minute${m === 1 ? "" : "s"} left to find it`;
}

/**
 * The new player's first win. Signed-out visitors see it as a reason to sign up,
 * unverified players as a reason to verify, and verified ones get it hidden a
 * short walk away and hunt it with the radar.
 */
export function WelcomeChestCard({ view, userLoc, hiding, error, onHide, onHunt, onVisibleChange }: Props) {
  const { address } = useAccount();
  const { login } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const state = !address ? "signed-out" : view?.state ?? null;
  const shown = !dismissed && (state === "signed-out" || state === "verify" || state === "ready" || state === "creating" || state === "live" || state === "full");

  useEffect(() => { onVisibleChange?.(shown); }, [shown, onVisibleChange]);

  // Lift the map's floating buttons above the card on phones (same as the cold-start card).
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.setProperty("--gd-cold-inset", "0px");
    const el = cardRef.current;
    if (!shown || !el) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const publish = () => root.style.setProperty("--gd-cold-inset", wide.matches ? "0px" : `${el.offsetHeight + 12}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    wide.addEventListener("change", publish);
    return () => { ro.disconnect(); wide.removeEventListener("change", publish); clear(); };
  }, [shown]);

  if (!shown) return null;

  const live = view?.state === "live" ? view : null;
  const dist = live && userLoc ? haversineDistance(userLoc.lat, userLoc.lng, live.lat, live.lng) : null;

  let title: string;
  let body: React.ReactNode;
  let action: React.ReactNode = null;
  let Icon = Gift;
  const primary = "h-12 w-full rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:opacity-70 disabled:cursor-wait";

  switch (state) {
    case "signed-out":
      title = "A welcome chest is waiting for you";
      body = "Sign up and we'll hide real G$ a short walk from you. Find it and it's yours.";
      action = <button type="button" className={primary} onClick={() => { track("welcome_tapped", { action: "signup" }); login(); }}>Sign up to get it</button>;
      break;
    case "verify":
      Icon = ShieldCheck;
      title = "Unlock your welcome chest";
      body = "Do the quick face check with GoodDollar to prove you're a real person. Then we'll hide G$ near you to find.";
      action = <button type="button" className={primary} onClick={() => { track("welcome_tapped", { action: "verify" }); window.dispatchEvent(new CustomEvent("gd:openVerify")); }}>Get verified</button>;
      break;
    case "ready":
      title = "Your welcome chest is ready";
      body = "We'll hide some G$ a short walk from you. Find it and it's yours. Some chests hold a lot more than others.";
      action = (
        <button type="button" className={primary} disabled={hiding} onClick={() => { track("welcome_tapped", { action: "hide" }); onHide(); }}>
          {hiding ? <><Loader2 className="w-5 h-5 animate-spin" /> Hiding your chest…</> : <><Gift className="w-5 h-5" strokeWidth={2} /> Hide my chest</>}
        </button>
      );
      break;
    case "creating":
      title = "Hiding your chest…";
      body = "This takes a few seconds.";
      action = <button type="button" className={primary} disabled><Loader2 className="w-5 h-5 animate-spin" /> Almost ready</button>;
      break;
    case "live":
      title = dist !== null ? `Your chest is ${walk(dist)}` : "Your chest is hidden";
      body = <>It&apos;s {spotLabel(live!.kind, live!.name)}. {timeLeft(live!.expiry, now)}.</>;
      action = (
        <button type="button" className={primary} onClick={() => { track("welcome_tapped", { action: "hunt" }); onHunt(live!); }}>
          <Navigation className="w-5 h-5" strokeWidth={2} /> Start hunting
        </button>
      );
      break;
    default: // full
      title = "Today's welcome chests are all out";
      body = "Come back tomorrow and we'll hide one for you. Until then, look around the map for drops.";
  }

  return (
    <div
      ref={cardRef}
      role="region"
      aria-label={title}
      className="modal-rise fixed left-1/2 -translate-x-1/2 w-[min(440px,calc(100vw-24px))] font-sans
        bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-5"
      style={{ bottom: "calc(var(--gd-nav-h, 0px) + 12px)", zIndex: 1001 }}
    >
      <div className="flex items-center gap-3">
        <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-brand text-white flex items-center justify-center">
          <Icon className="w-5 h-5" strokeWidth={1.9} />
        </span>
        <p className="flex-1 min-w-0 text-lg/[1.2] text-heading line-clamp-2">{title}</p>
        {state !== "creating" && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="w-8 h-8 shrink-0 rounded-full bg-surface text-nav-muted flex items-center justify-center
              cursor-pointer motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
      </div>
      <p className="text-sm/[140%] text-nav-muted mt-3">{body}</p>
      {error && <p role="alert" className="text-sm/[140%] text-danger mt-3">{error}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
