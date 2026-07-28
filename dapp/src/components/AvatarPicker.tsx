"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAccount, useSignMessage } from "wagmi";
import { Avatar } from "@/components/Avatar";
import { AVATAR_PRESETS } from "@/lib/avatarPresets";
import { useProfile, refreshProfile } from "@/hooks/useProfile";

// Global avatar picker. Mounted once (in Nav); opened from anywhere by dispatching
//   window.dispatchEvent(new CustomEvent("gd:editAvatar"))
// Picking a vibe signs a tiny message and saves the preset id to the profile —
// no uploads, no gas, no moderation.
export function AvatarPicker() {
  const { address } = useAccount();
  const profile = useProfile(address);
  const { signMessageAsync } = useSignMessage();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // preset id being saved ("__default__" for reset)
  const [err, setErr] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onOpen = () => { setErr(""); setOpen(true); };
    window.addEventListener("gd:editAvatar", onOpen);
    return () => window.removeEventListener("gd:editAvatar", onOpen);
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!mounted || !open) return null;

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

  const close = () => { if (!saving) setOpen(false); };

  return createPortal(
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 2000,
        background: "rgba(17,17,17,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-cream border-t-2 sm:border-2 border-ink"
        style={{
          width: "min(560px, 100%)", maxHeight: "88dvh", overflowY: "auto",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 -12px 40px rgba(0,0,0,0.3)",
        }}
      >
        {/* handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 42, height: 4, borderRadius: 2, background: "#ccc" }} />
        </div>

        <div style={{ padding: "8px 18px 26px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 900, fontSize: 20, color: "#111" }}>Pick your vibe ✨</p>
              <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "#5a5a5a" }}>
                No uploads, no fees — just tap one. It saves to your profile everywhere.
              </p>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              style={{
                width: 32, height: 32, borderRadius: "50%", border: "2px solid #111",
                background: "#fff", cursor: "pointer", fontWeight: 800, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >✕</button>
          </div>

          {err && <p style={{ margin: "8px 0 0", fontSize: 12, fontWeight: 700, color: "#FF3B3B" }}>{err}</p>}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              gap: 12, marginTop: 16,
            }}
          >
            {/* Default (generated) */}
            <PresetTile
              label="default"
              selected={current === ""}
              busy={saving === "__default__"}
              onClick={() => choose("__default__")}
            >
              <Avatar address={address ?? "0x0"} size={56} />
            </PresetTile>

            {AVATAR_PRESETS.map((p) => (
              <PresetTile
                key={p.id}
                label={p.name}
                selected={current === p.id}
                busy={saving === p.id}
                onClick={() => choose(p.id)}
              >
                <Avatar address={address ?? "0x0"} preset={p.id} size={56} />
              </PresetTile>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PresetTile({
  children, label, selected, busy, onClick,
}: {
  children: React.ReactNode; label: string; selected: boolean; busy: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        background: selected ? "#BFFD00" : "#fff",
        border: "2px solid #111",
        borderRadius: 16,
        boxShadow: selected ? "2px 2px 0 #111" : "none",
        padding: "12px 6px 9px", cursor: busy ? "wait" : "pointer",
        fontFamily: "inherit", transition: "transform 0.12s, box-shadow 0.12s",
        position: "relative",
      }}
      onMouseEnter={(e) => { if (!selected) { e.currentTarget.style.boxShadow = "2px 2px 0 #111"; e.currentTarget.style.transform = "translate(-1px,-1px)"; } }}
      onMouseLeave={(e) => { if (!selected) { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; } }}
    >
      <div style={{ opacity: busy ? 0.5 : 1 }}>{children}</div>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: "#111", lineHeight: 1.1, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 78 }}>
        {busy ? "saving…" : label}
      </span>
    </button>
  );
}
