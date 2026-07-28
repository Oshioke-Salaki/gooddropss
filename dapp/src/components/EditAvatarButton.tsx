"use client";
import { useAccount } from "wagmi";

// A small "🎨" chip overlaid on the profile avatar — only for the owner. Opens
// the global AvatarPicker. Kept as a tiny client island so the profile page can
// stay a server component.
export function EditAvatarButton({ address }: { address: string }) {
  const { address: connected } = useAccount();
  if (!connected || connected.toLowerCase() !== address.toLowerCase()) return null;

  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("gd:editAvatar"))}
      title="Change your avatar"
      aria-label="Change your avatar"
      style={{
        position: "absolute", bottom: 2, right: 2,
        width: 30, height: 30, borderRadius: "50%",
        background: "#BFFD00", border: "2.5px solid #111",
        boxShadow: "2px 2px 0 #111",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, cursor: "pointer", lineHeight: 1, padding: 0,
      }}
    >
      🎨
    </button>
  );
}
