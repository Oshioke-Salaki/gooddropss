"use client";
import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Check, Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { AvatarStudio } from "@/components/avatar/AvatarStudio";
import { avatarId, resolveAvatar, type AvatarChoice } from "@/lib/avatars";
import { useProfile, refreshProfile } from "@/hooks/useProfile";

// Global avatar picker. Mounted once (in Nav); opened from anywhere by dispatching
//   window.dispatchEvent(new CustomEvent("gd:editAvatar"))
// Saving signs a tiny message and stores the avatar id on the profile:
// no uploads, no gas, no moderation.
export function AvatarPicker() {
  const { address } = useAccount();
  const profile = useProfile(address);
  const { signMessageAsync } = useSignMessage();

  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<AvatarChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onOpen = () => { setErr(""); setSaved(false); setChoice(null); setOpen(true); };
    window.addEventListener("gd:editAvatar", onOpen);
    return () => window.removeEventListener("gd:editAvatar", onOpen);
  }, []);

  const current = resolveAvatar(profile?.avatar, address ?? "");
  const value = choice ?? current;
  const changed = avatarId(value) !== (profile?.avatar ?? "");

  const save = useCallback(async () => {
    if (!address || saving || !changed) return;
    const avatar = avatarId(value);
    setSaving(true); setErr("");
    try {
      const timestamp = Date.now();
      const message = `GoodDrops: set avatar "${avatar}" at ${timestamp}`;
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/profile/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, avatar, signature, timestamp }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't save. Try again."); return; }
      refreshProfile(address);
      setSaved(true);
      setTimeout(() => setOpen(false), 600);
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? "";
      setErr(/reject|denied|cancel/i.test(m) ? "" : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }, [address, saving, changed, value, signMessageAsync]);

  if (!open || !address) return null;
  const busy = saving || saved;

  return (
    // Above the edit-profile sheet (1400), which is where this usually opens from.
    <Sheet title="Your avatar" onClose={() => setOpen(false)} dismissible={!busy} width={480} zIndex={1500}>
      <div className="pt-6">
        <AvatarStudio value={value} onChange={setChoice} disabled={busy} />
      </div>

      <p role="status" aria-live="polite" className="h-4 mt-4 text-sm/none text-center text-danger truncate">{err}</p>

      <button
        type="button"
        onClick={save}
        disabled={!changed || busy}
        className={`mt-3 w-full h-14 rounded-full bg-brand text-white text-base/none cursor-pointer
          flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90
          disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]
          ${saved ? "disabled:!bg-brand" : ""}`}
      >
        {saved ? <><Check className="w-5 h-5" /> Saved</>
          : saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</>
          : "Save avatar"}
      </button>
    </Sheet>
  );
}
