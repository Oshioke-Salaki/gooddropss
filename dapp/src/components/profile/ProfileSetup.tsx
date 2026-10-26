"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { AtSign, Check, Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { AVATAR_IMAGES } from "@/lib/avatarPresets";
import { useProfile, invalidateProfile, refreshProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";

// Mirrors the server rule in /api/profile — kept in sync intentionally.
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

// How long a dismissed step stays quiet before we offer it again. Long enough
// not to nag, short enough that a profile doesn't stay faceless forever.
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
const snoozeKey = (step: Step, address: string) => `gd:setup:${step}:${address.toLowerCase()}`;

function snoozed(step: Step, address: string): boolean {
  try {
    const t = Number(localStorage.getItem(snoozeKey(step, address)) ?? 0);
    return Date.now() - t < SNOOZE_MS;
  } catch { return false; }
}
function snooze(step: Step, address: string) {
  try { localStorage.setItem(snoozeKey(step, address), String(Date.now())); } catch { /* private mode */ }
}

type Step = "avatar" | "name";

/**
 * Profile setup — the two-step onboarding and the global "set a name" sheet.
 *
 * Runs once at the app root. When a signed-in person's profile has no avatar,
 * the avatar step opens by itself (new accounts and existing ones alike); once
 * that's done or skipped, the name step follows if there's no username. Each
 * step can be dismissed, and a dismissed step stays quiet for two weeks on
 * this device so it never turns into a nag.
 *
 * Any surface can still open the name step on demand:
 *     window.dispatchEvent(new CustomEvent("gd:setName"))
 */
export function ProfileSetup() {
  const { address, isConnected } = useAccount();
  const { ready } = useAuth();
  const profile = useProfile(address);
  const pathname = usePathname();

  const [step, setStep] = useState<Step | null>(null);
  // Only auto-open once per sign-in — the profile refreshing after a save must
  // not re-trigger the flow for a step the person just skipped.
  const offeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !isConnected || !address || profile === undefined) return;
    if (pathname.startsWith("/admin")) return;
    if (offeredFor.current === address) return;
    offeredFor.current = address;

    const next: Step | null =
      !profile?.avatar && !snoozed("avatar", address) ? "avatar"
      : !profile?.username && !snoozed("name", address) ? "name"
      : null;
    if (!next) return;
    // A beat after sign-in, so the auth sheet has finished leaving before this
    // one arrives — two sheets crossing reads as a glitch.
    const t = setTimeout(() => setStep(next), 450);
    return () => clearTimeout(t);
  }, [ready, isConnected, address, profile, pathname]);

  // Signing out resets, so the next account gets its own offer.
  useEffect(() => {
    if (!isConnected) { offeredFor.current = null; setStep(null); }
  }, [isConnected]);

  useEffect(() => {
    const onOpen = () => setStep("name");
    window.addEventListener("gd:setName", onOpen);
    return () => window.removeEventListener("gd:setName", onOpen);
  }, []);

  const afterAvatar = useCallback(() => {
    // Straight into the name step if there's still no name; otherwise done.
    setStep(profile?.username ? null : "name");
  }, [profile?.username]);

  if (!address || !step) return null;

  if (step === "avatar") {
    return (
      <AvatarStep
        address={address}
        onDone={afterAvatar}
        onSkip={() => { snooze("avatar", address); afterAvatar(); }}
      />
    );
  }
  return (
    <NameStep
      address={address}
      onClose={() => { snooze("name", address); setStep(null); }}
      onDone={() => setStep(null)}
    />
  );
}

// ── Step 1: avatar ────────────────────────────────────────────────────────────

export function AvatarStep({
  address, onDone, onSkip,
}: { address: string; onDone: () => void; onSkip: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(async () => {
    if (!picked || saving) return;
    setSaving(true);
    setError("");
    try {
      const timestamp = Date.now();
      const message = `GoodDrops: set avatar "${picked}" at ${timestamp}`;
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, avatar: picked, signature, timestamp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Couldn't save your avatar. Try again."); return; }
      refreshProfile(address);
      setSaved(true);
      // A beat to see the confirmation before the next step slides in.
      setTimeout(onDone, 700);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      const msg = err.shortMessage ?? err.message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "" : (msg || "Something went wrong."));
    } finally {
      setSaving(false);
    }
  }, [picked, saving, address, signMessageAsync, onDone]);

  const busy = saving || saved;

  return (
    <Sheet
      title="Choose an avatar"
      onClose={onSkip}
      dismissible={!busy}
      zIndex={1600}
      headerAction={
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="shrink-0 h-8 px-4 rounded-full bg-surface text-sm/none text-heading cursor-pointer
            motion-safe:transition-colors hover:bg-nav-controls disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Skip
        </button>
      }
    >
      <AvatarGrid value={picked} onChange={setPicked} disabled={busy} className="pt-6" />

      <p
        role="status"
        aria-live="polite"
        className={`h-4 mt-4 text-sm/none text-center truncate ${error ? "text-danger" : "text-nav-muted"}`}
      >
        {error}
      </p>

      <button
        type="button"
        onClick={save}
        disabled={!picked || busy}
        className="mt-3 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
          flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
          disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
      >
        {saved ? <><Check className="w-5 h-5" /> Saved</>
          : saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</>
          : "Next"}
      </button>

      <p className="mt-4 text-xs/[140%] text-nav-muted text-center">
        You can always change your avatar within your profile page.
      </p>
    </Sheet>
  );
}

/** The 3-up picker (4-up on phones so it fits without scrolling). */
export function AvatarGrid({
  value, onChange, disabled, className = "",
}: { value: string | null; onChange: (id: string) => void; disabled?: boolean; className?: string }) {
  return (
    <div
      role="radiogroup"
      aria-label="Choose an avatar"
      className={`grid grid-cols-4 lg:grid-cols-3 gap-4 lg:gap-5 ${className}`}
    >
      {AVATAR_IMAGES.map((a) => {
        const on = value === a.id;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={a.name}
            disabled={disabled}
            onClick={() => onChange(a.id)}
            className={`relative aspect-square w-full rounded-full overflow-hidden cursor-pointer
              motion-safe:transition-[box-shadow,transform] disabled:cursor-wait
              ${on ? "ring-2 ring-brand" : "hover:ring-2 hover:ring-line motion-safe:hover:scale-[1.03]"}`}
            style={{ background: a.bg }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.src}
              alt=""
              draggable={false}
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
              className="absolute inset-0 w-full h-full object-cover select-none"
            />
          </button>
        );
      })}
    </div>
  );
}

// ── Step 2: username ──────────────────────────────────────────────────────────

type CheckState = "idle" | "invalid" | "checking" | "available" | "taken";

export function NameStep({
  address, onClose, onDone,
}: { address: string; onClose: () => void; onDone: () => void }) {
  const { signMessageAsync } = useSignMessage();
  const [input, setInput] = useState("");
  const [check, setCheck] = useState<CheckState>("idle");
  const [saving, setSaving] = useState(false);
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the field on desktop only — on a phone that would throw the keyboard
  // up before the sheet has even landed.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const val = input.trim().toLowerCase();
    if (!val)                    { setCheck("idle");    return; }
    if (!USERNAME_RE.test(val))  { setCheck("invalid"); return; }
    setCheck("checking");
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/profile/check?username=${encodeURIComponent(val)}`);
        const data = await res.json();
        setCheck(data.available ? "available" : "taken");
      } catch {
        setCheck("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [input]);

  const canSave = check === "available" && !saving && !savedAs;

  const save = useCallback(async () => {
    const username = input.trim();
    if (!canSave || !username) return;
    setSaving(true);
    setError("");
    try {
      const timestamp = Date.now();
      const message   = `GoodDrops: claim username "${username}" at ${timestamp}`;
      const signature = await signMessageAsync({ message });
      const res  = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, username, signature, timestamp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Couldn't save that name. Try another."); return; }
      invalidateProfile(address);
      refreshProfile(address);
      setSavedAs(username.toLowerCase());
      setTimeout(onDone, 1400);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      const msg = err.shortMessage ?? err.message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "" : (msg || "Something went wrong."));
    } finally {
      setSaving(false);
    }
  }, [input, canSave, address, signMessageAsync, onDone]);

  const hint: { text: string; tone: "muted" | "ok" | "bad" } | null = error
    ? { text: error, tone: "bad" }
    : check === "invalid"   ? { text: "3–24 characters: letters, numbers, _ or -", tone: "muted" }
    : check === "checking"  ? { text: "Checking…", tone: "muted" }
    : check === "taken"     ? { text: "That name is taken", tone: "bad" }
    : check === "available" ? { text: "Available", tone: "ok" }
    : null;

  return (
    <Sheet title="Enter a username" onClose={onClose} dismissible={!saving && !savedAs} zIndex={1600}>
      {savedAs ? (
        <div className="flex flex-col items-center text-center pt-8 pb-2 gap-y-4">
          <span className="w-14 h-14 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            <Check className="w-7 h-7" />
          </span>
          <p className="text-xl/none text-heading">You&apos;re @{savedAs}</p>
          <p className="text-sm/[140%] text-nav-muted">
            That&apos;s how people will see you on the map and the rankings.
          </p>
        </div>
      ) : (
        <form className="pt-6 flex flex-col" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="relative block">
            <span className="sr-only">Username</span>
            <AtSign
              className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-heading pointer-events-none"
              strokeWidth={2}
            />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value.replace(/\s/g, "")); setError(""); }}
              placeholder="username"
              maxLength={24}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={saving}
              aria-invalid={check === "invalid" || check === "taken" || !!error}
              className="w-full h-14 rounded-full bg-surface pl-12 pr-5 text-base/none text-heading
                placeholder:text-nav-muted border border-transparent outline-none
                motion-safe:transition-colors focus:border-brand disabled:opacity-60"
            />
          </label>

          <p
            role="status"
            aria-live="polite"
            className={`h-4 mt-3 px-5 text-sm/none truncate ${
              hint?.tone === "bad" ? "text-danger" : hint?.tone === "ok" ? "text-brand" : "text-nav-muted"
            }`}
          >
            {hint?.text ?? ""}
          </p>

          <button
            type="submit"
            disabled={!canSave}
            className="mt-3 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
              flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
              disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
          >
            {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : "Finish"}
          </button>
        </form>
      )}
    </Sheet>
  );
}
