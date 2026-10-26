"use client";
import { useState, useEffect } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Avatar } from "@/components/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { AVATAR_IMAGES } from "@/lib/avatarPresets";
import { useProfile, refreshProfile } from "@/hooks/useProfile";

// Global avatar picker. Mounted once (in Nav); opened from anywhere by dispatching
//   window.dispatchEvent(new CustomEvent("gd:editAvatar"))
// Picking one signs a tiny message and saves the preset id to the profile —
// no uploads, no gas, no moderation.
export function AvatarPicker() {
  const { address } = useAccount();
  const profile = useProfile(address);
  const { signMessageAsync } = useSignMessage();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // preset id being saved ("__default__" for reset)
  const [err, setErr] = useState("");

  useEffect(() => {
    const onOpen = () => { setErr(""); setOpen(true); };
    window.addEventListener("gd:editAvatar", onOpen);
    return () => window.removeEventListener("gd:editAvatar", onOpen);
  }, []);

  if (!open) return null;

  const current = profile?.avatar ?? "";

  async function choose(id: string) {
    if (!address || saving) return;
    const avatar = id === "__default__" ? "" : id;
    setSaving(id); setErr("");
    try {
      const timestamp = Date.now();
      const message = `GoodDrops: set avatar "${avatar}" at ${timestamp}`;
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/profile/avatar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, avatar, signature, timestamp }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't save — try again."); return; }
      refreshProfile(address);
      setTimeout(() => setOpen(false), 220);
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? "";
      setErr(/reject|denied/i.test(m) ? "Cancelled." : "Couldn't save — try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    // Above the edit-profile sheet (1400), which is where this usually opens from.
    <Sheet title="Choose your avatar" onClose={() => setOpen(false)} dismissible={!saving} width={560} zIndex={1500}>
      <p className="text-sm/[140%] text-nav-muted mt-3">
        No uploads — just pick one. It shows everywhere you do.
      </p>

      {err && (
        <p role="alert" className="text-sm/none text-danger mt-4">{err}</p>
      )}

      <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 gap-2 mt-6">
        <PresetTile
          label="default"
          selected={current === ""}
          busy={saving === "__default__"}
          disabled={!!saving}
          onClick={() => choose("__default__")}
        >
          <Avatar address={address ?? "0x0"} size={56} ringColor="transparent" />
        </PresetTile>

        {AVATAR_IMAGES.map((a) => (
          <PresetTile
            key={a.id}
            label={a.name}
            selected={current === a.id}
            busy={saving === a.id}
            disabled={!!saving}
            onClick={() => choose(a.id)}
          >
            <Avatar address={address ?? "0x0"} preset={a.id} size={56} ringColor="transparent" />
          </PresetTile>
        ))}
      </div>
    </Sheet>
  );
}

function PresetTile({
  children, label, selected, busy, disabled, onClick,
}: {
  children: React.ReactNode; label: string; selected: boolean; busy: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={label}
      className={`flex flex-col items-center gap-2 p-2 rounded-2xl cursor-pointer min-w-0
        motion-safe:transition-colors disabled:cursor-wait
        ${selected ? "bg-surface" : "hover:bg-surface/60"}`}
    >
      <span
        className={`rounded-full leading-none ${selected ? "ring-2 ring-brand ring-offset-2 ring-offset-white" : ""}
          ${busy ? "opacity-50" : ""}`}
      >
        {children}
      </span>
      <span className="text-xs/none text-nav-muted truncate max-w-full">
        {busy ? "Saving…" : label}
      </span>
    </button>
  );
}
