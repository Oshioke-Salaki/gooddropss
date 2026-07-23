"use client";
import { useState } from "react";
import { Copy, Check, Share2, Users } from "lucide-react";
import { useReferral } from "@/hooks/useReferral";
import { recruiterTier } from "@/lib/referral";

// "Invite friends" surface — a hunter's personal invite link, how many people
// they've brought in, and their recruiter tier. Density is the whole game: every
// neighbour someone brings makes more drops appear near everyone.
export function InviteCard() {
  const { count, inviteLink } = useReferral();
  const [copied, setCopied] = useState(false);
  const tier = recruiterTier(count);

  if (!inviteLink) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  }

  async function share() {
    const text = "Come hunt real G$ on GoodDrops with me 💰";
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "GoodDrops", text, url: inviteLink }); return; } catch { /* cancelled */ }
    }
    copy();
  }

  return (
    <div style={{
      background: "#111", color: "#fff", border: "2.5px solid #111",
      borderRadius: 18, padding: "18px", boxShadow: "4px 4px 0 #BFFD00",
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Users size={18} color="#BFFD00" />
          <span style={{ fontWeight: 900, fontSize: 16 }}>Invite friends</span>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#BFFD00", color: "#111", fontWeight: 900, fontSize: 12, padding: "4px 10px", borderRadius: 999 }}>
          <span>{tier.icon}</span>{tier.label}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "14px 0 4px" }}>
        <span style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: "#BFFD00" }}>{count}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#9a9da8" }}>
          {count === 1 ? "hunter joined" : "hunters joined"} through you
        </span>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#9a9da8" }}>
        Every neighbour you bring makes more drops appear near everyone. 🌍
      </p>

      {/* Link + copy */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{
          flex: 1, minWidth: 0, background: "#1c1c1c", border: "2px solid #333",
          borderRadius: 12, padding: "0 12px", height: 46, display: "flex", alignItems: "center",
          fontSize: 12.5, color: "#cfcfd4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {inviteLink.replace(/^https?:\/\//, "")}
        </div>
        <button onClick={copy} aria-label="Copy invite link"
          style={{ flexShrink: 0, width: 46, height: 46, background: "#fff", color: "#111", border: "2px solid #111", borderRadius: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {copied ? <Check size={18} /> : <Copy size={17} />}
        </button>
      </div>

      <button onClick={share}
        style={{
          marginTop: 10, width: "100%", height: 48, background: "#BFFD00", color: "#111",
          border: "2.5px solid #BFFD00", borderRadius: 13, fontWeight: 900, fontSize: 15,
          cursor: "pointer", fontFamily: "inherit",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
        <Share2 size={17} /> Share invite
      </button>
    </div>
  );
}
