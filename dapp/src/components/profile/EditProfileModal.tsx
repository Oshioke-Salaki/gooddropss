"use client";
import { useCallback, useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import { AtSign } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/Avatar";
import { AvatarGrid } from "./ProfileSetup";
import { useProfile, invalidateProfile, refreshProfile } from "@/hooks/useProfile";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

type Check = "idle" | "same" | "invalid" | "checking" | "available" | "taken";

interface Props {
  address: string;
  onClose: () => void;
}

/**
 * Edit your profile: avatar + username, one Save.
 *
 * "Change avatar" swaps the big avatar for the picker grid in place; picking
 * only marks a choice. Nothing is written until Save, which commits whichever
 * of the two actually changed — each through its existing signed endpoint, so
 * the server-side rules (and the onboarding steps) stay the single source of truth.
 */
export function EditProfileModal({ address, onClose }: Props) {
  const profile = useProfile(address);
  const { signMessageAsync } = useSignMessage();
  const currentName = profile?.username ?? "";
  const currentAvatar = profile?.avatar ?? "";

  const [input, setInput] = useState(currentName);
  const [touched, setTouched] = useState(false);
  const [check, setCheck] = useState<Check>("idle");
  const [picking, setPicking] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null); // null = untouched
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The profile can land after we open. Until the person types, mirror it.
  useEffect(() => {
    if (!touched) setInput(currentName);
  }, [currentName, touched]);

  // Debounced availability check. Unchanged and empty both mean "nothing to
  // save" for the name, so Save stays off without a message.
  useEffect(() => {
    const val = input.trim().toLowerCase();
    if (!val)                               { setCheck("idle");    return; }
    if (val === currentName.toLowerCase())  { setCheck("same");    return; }
    if (!USERNAME_RE.test(val))             { setCheck("invalid"); return; }
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
  }, [input, currentName]);

  const nameChanged   = check === "available";
  const nameBlocking  = check === "invalid" || check === "taken" || check === "checking";
  const avatarChanged = avatar !== null && avatar !== currentAvatar;
  const canSave = (nameChanged || avatarChanged) && !nameBlocking && !saving;

  const save = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      if (avatarChanged && avatar !== null) {
        const timestamp = Date.now();
        const message   = `GoodDrops: set avatar "${avatar}" at ${timestamp}`;
        const signature = await signMessageAsync({ message });
        const res  = await fetch("/api/profile/avatar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, avatar, signature, timestamp }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setError(data.error ?? "Couldn't save your avatar. Try again."); return; }
      }

      if (nameChanged) {
        const username  = input.trim();
        const timestamp = Date.now();
        const message   = `GoodDrops: claim username "${username}" at ${timestamp}`;
        const signature = await signMessageAsync({ message });
        const res  = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, username, signature, timestamp }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The avatar (if any) is already saved — reflect that before bailing.
          refreshProfile(address);
          setError(data.error ?? "Couldn't save that name. Try another.");
          return;
        }
      }

      invalidateProfile(address);
      refreshProfile(address);
      onClose();
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      const msg = err.shortMessage ?? err.message ?? "";
      // Declining the signature isn't an error worth shouting about.
      setError(/reject|denied|cancel/i.test(msg) ? "" : (msg || "Something went wrong."));
      refreshProfile(address);
    } finally {
      setSaving(false);
    }
  }, [canSave, avatarChanged, avatar, nameChanged, input, address, signMessageAsync, onClose]);

  const hint: { text: string; tone: "muted" | "ok" | "bad" } | null = error
    ? { text: error, tone: "bad" }
    : check === "invalid"   ? { text: "3–24 characters: letters, numbers, _ or -", tone: "muted" }
    : check === "checking"  ? { text: "Checking…", tone: "muted" }
    : check === "taken"     ? { text: "That name is taken", tone: "bad" }
    : check === "available" ? { text: "Available", tone: "ok" }
    : null;

  const selected = avatar ?? currentAvatar;

  return (
    <Sheet title="Edit your profile" onClose={onClose} dismissible={!saving}>
      {/* ── Avatar ─────────────────────────────────────────────────────────── */}
      {picking ? (
        <AvatarGrid value={selected} onChange={setAvatar} disabled={saving} className="pt-6 pb-6" />
      ) : (
        <div className="flex flex-col items-center pt-6 pb-6">
          <Avatar
            address={address}
            username={profile?.username}
            preset={selected}
            size={100}
            ringColor="transparent"
          />
          <button
            type="button"
            onClick={() => setPicking(true)}
            disabled={saving}
            className="mt-4 h-8 px-4 rounded-full border border-nav-muted/50 text-sm/none text-heading
              cursor-pointer motion-safe:transition-colors hover:bg-surface disabled:opacity-50"
          >
            Change avatar
          </button>
        </div>
      )}

      <div className="border-t border-line -mx-6" />

      {/* ── Username ───────────────────────────────────────────────────────── */}
      <form
        className="pt-6 flex flex-col"
        onSubmit={(e) => { e.preventDefault(); save(); }}
      >
        <label className="relative block">
          <span className="sr-only">Username</span>
          <AtSign
            className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-heading pointer-events-none"
            strokeWidth={2}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => { setTouched(true); setInput(e.target.value); setError(""); }}
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

        {/* Fixed-height slot so the button never jumps as the hint comes and goes. */}
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
            motion-safe:transition-colors hover:bg-brand/90
            disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </Sheet>
  );
}
