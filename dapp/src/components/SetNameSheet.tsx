"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useSignMessage } from "wagmi";
import { Check, X, Loader2 } from "lucide-react";
import { invalidateProfile, refreshProfile } from "@/hooks/useProfile";

// Mirrors the server rule in /api/profile — kept in sync intentionally.
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

type CheckState = "idle" | "checking" | "available" | "taken" | "invalid";

/**
 * Global "claim your hunter name" sheet. Mounted once at the app root; any nudge
 * (wallet pill, post-claim screen, leaderboard) opens it by dispatching:
 *
 *     window.dispatchEvent(new CustomEvent("gd:setName"))
 *
 * On success it refreshes the profile everywhere (pill, handles, cards) via
 * refreshProfile(), so nothing needs a reload.
 */
export function SetNameSheet() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [open, setOpen]     = useState(false);
  const [input, setInput]   = useState("");
  const [check, setCheck]   = useState<CheckState>("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [done, setDone]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on the global nudge event.
  useEffect(() => {
    const onOpen = () => { setOpen(true); setDone(false); setError(""); };
    window.addEventListener("gd:setName", onOpen);
    return () => window.removeEventListener("gd:setName", onOpen);
  }, []);

  // Focus the field shortly after the sheet animates in.
  useEffect(() => {
    if (open && !done) {
      const t = setTimeout(() => inputRef.current?.focus(), 260);
      return () => clearTimeout(t);
    }
  }, [open, done]);

  // Debounced availability check.
  useEffect(() => {
    if (!open) return;
    const val = input.trim().toLowerCase();
    if (!val)                    { setCheck("idle"); return; }
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
  }, [input, open]);

  const close = useCallback(() => {
    setOpen(false);
    setInput("");
    setCheck("idle");
    setError("");
  }, []);

  const save = useCallback(async () => {
    const username = input.trim();
    if (check !== "available" || !username || !address || saving) return;
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
      setDone(true);
      setTimeout(() => { close(); setDone(false); }, 1500);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      // User rejecting the signature isn't an error worth shouting about.
      const msg = err.shortMessage ?? err.message ?? "";
      setError(/reject|denied|cancel/i.test(msg) ? "" : (msg || "Something went wrong."));
    } finally {
      setSaving(false);
    }
  }, [input, check, address, saving, signMessageAsync, close]);

  const canSave = check === "available" && !saving;
  const preview = input.trim() ? `@${input.trim().toLowerCase()}` : "@yourname";

  const status: Record<CheckState, { icon: React.ReactNode; text: string; color: string }> = {
    idle:      { icon: null, text: "3–24 letters, numbers, _ or -", color: "#8a8d99" },
    checking:  { icon: <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />, text: "Checking…", color: "#8a8d99" },
    available: { icon: <Check size={14} color="#16a34a" />, text: `${preview} is available`, color: "#16a34a" },
    taken:     { icon: <X size={14} color="#dc2626" />, text: "That name is taken", color: "#dc2626" },
    invalid:   { icon: <X size={14} color="#dc2626" />, text: "3–24 letters, numbers, _ or -", color: "#dc2626" },
  };
  const s = status[check];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            style={{
              position: "fixed", inset: 0, zIndex: 4000,
              background: "rgba(17,17,17,0.6)", backdropFilter: "blur(3px)",
            }}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 34, stiffness: 430 }}
            role="dialog" aria-modal="true" aria-label="Claim your hunter name"
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 4001,
              width: "100%", maxWidth: 480, margin: "0 auto",
              background: "#f5f4f0",
              borderRadius: "24px 24px 0 0",
              border: "2px solid #111", borderBottom: "none",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.35)",
              padding: "20px 20px calc(22px + env(safe-area-inset-bottom))",
              maxHeight: "92dvh", overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* grab handle */}
            <div style={{ width: 40, height: 4, borderRadius: 999, background: "#d6d5cf", margin: "0 auto 16px" }} />

            {done ? (
              <div style={{ textAlign: "center", padding: "18px 8px 10px" }}>
                <motion.div
                  initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", damping: 12, stiffness: 300 }}
                  style={{ fontSize: 56, lineHeight: 1, marginBottom: 8 }}
                >
                  🎉
                </motion.div>
                <p style={{ margin: 0, fontWeight: 900, fontSize: 22, color: "#111", letterSpacing: "-0.02em" }}>
                  You&apos;re {preview}
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "#6b6e7a" }}>
                  Hunters will see this on the map, leaderboard &amp; your win cards.
                </p>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 900, fontSize: 20, color: "#111", letterSpacing: "-0.02em" }}>
                      Claim your hunter name
                    </p>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b6e7a", lineHeight: 1.5 }}>
                      So people know it&apos;s you on the map, leaderboard and win cards — instead of a wallet address.
                    </p>
                  </div>
                  <button
                    onClick={close} aria-label="Close"
                    style={{
                      flexShrink: 0, width: 32, height: 32, borderRadius: 10,
                      border: "2px solid #111", background: "#fff", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <X size={16} color="#111" />
                  </button>
                </div>

                {/* Input with @ prefix */}
                <div
                  style={{
                    marginTop: 18, display: "flex", alignItems: "center", gap: 6,
                    background: "#fff", border: "2px solid #111", borderRadius: 14,
                    padding: "0 14px", height: 56,
                    boxShadow: canSave ? "3px 3px 0 #BFFD00" : "3px 3px 0 #111",
                    transition: "box-shadow 0.15s",
                  }}
                >
                  <span style={{ fontSize: 22, fontWeight: 900, color: "#111" }}>@</span>
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value.replace(/\s/g, ""))}
                    onKeyDown={(e) => { if (e.key === "Enter" && canSave) save(); }}
                    placeholder="yourname"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    maxLength={24}
                    inputMode="text"
                    style={{
                      flex: 1, minWidth: 0, border: "none", outline: "none",
                      background: "transparent", fontSize: 20, fontWeight: 800,
                      color: "#111", fontFamily: "inherit", letterSpacing: "-0.01em",
                    }}
                  />
                </div>

                {/* Status line */}
                <div style={{ minHeight: 20, marginTop: 10, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: s.color }}>
                  {s.icon}
                  <span>{s.text}</span>
                </div>

                {error && (
                  <div style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>{error}</div>
                )}

                {/* Save */}
                <button
                  onClick={save}
                  disabled={!canSave}
                  style={{
                    marginTop: 14, width: "100%", height: 54,
                    background: canSave ? "#BFFD00" : "#e8e7e2",
                    color: canSave ? "#111" : "#a8a8a2",
                    border: "2.5px solid", borderColor: canSave ? "#111" : "#d6d5cf",
                    borderRadius: 15, fontWeight: 900, fontSize: 16,
                    letterSpacing: "-0.01em", fontFamily: "inherit",
                    cursor: canSave ? "pointer" : "not-allowed",
                    boxShadow: canSave ? "4px 4px 0 #111" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    transition: "background 0.15s, box-shadow 0.15s",
                  }}
                >
                  {saving
                    ? <><Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} /> Signing…</>
                    : `Claim ${preview}`}
                </button>

                <p style={{ margin: "10px 0 0", fontSize: 11, color: "#9a9da8", textAlign: "center" }}>
                  Free · you sign a message to prove it&apos;s your wallet · change it anytime
                </p>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
