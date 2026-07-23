"use client";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useBalance, useSignMessage, usePublicClient, useWalletClient } from "wagmi";
import { formatUnits } from "viem";
import { Copy, Check, LogOut, Pencil, X, Loader2, Zap, User } from "lucide-react";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useProfile, invalidateProfile } from "@/hooks/useProfile";
import { formatG$ } from "@/lib/utils";
import { friendlyUbiError } from "@/lib/claimErrors";
import { ClaimSDK } from "@goodsdks/citizen-sdk";
import { IdentitySDK, useIdentitySDK } from "@goodsdks/identity-sdk";

interface Props {
  address: `0x${string}`;
  isVerified: boolean;
  onDisconnect: () => void;
  onClose: () => void;
  onOpenVerify: () => void;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;

export function WalletModal({ address, isVerified, onDisconnect, onClose, onOpenVerify }: Props) {
  const [copied,      setCopied]      = useState(false);
  const [editing,     setEditing]     = useState(false);
  const [input,       setInput]       = useState("");
  const [checkState,  setCheckState]  = useState<"idle"|"checking"|"available"|"taken"|"invalid">("idle");
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { balance }             = useGoodDollarProfile();
  const { data: nativeBalance } = useBalance({ address });
  const profile                 = useProfile(address);
  const { signMessageAsync }    = useSignMessage();
  const publicClient            = usePublicClient();
  const { data: walletClient }  = useWalletClient();
  const identitySDKHook         = useIdentitySDK("production");

  // ── UBI claim state ───────────────────────────────────────────────────────
  const [streak, setStreak] = useState<{ current: number; best: number } | null>(null);

  useEffect(() => {
    fetch(`/api/engagement?address=${address}`)
      .then((r) => r.json())
      .then((d) => { if (d.streak) setStreak(d.streak); })
      .catch(() => {});
  }, [address]);

  const [ubiEntitlement, setUbiEntitlement] = useState<bigint | null>(null);
  const [ubiStatus,      setUbiStatus]      = useState<"can_claim"|"already_claimed"|"not_whitelisted"|"loading">("loading");
  const [ubiClaiming,    setUbiClaiming]    = useState(false);
  const [ubiClaimDone,   setUbiClaimDone]   = useState(false);
  const [ubiErr,         setUbiErr]         = useState("");

  useEffect(() => {
    if (!address || !publicClient || !walletClient) return;
    const identitySDK = identitySDKHook ?? new (IdentitySDK as any)(publicClient, walletClient, "production");
    const sdk = new ClaimSDK({
      account:     address,
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      identitySDK:  identitySDK as any,
      env:          "production",
    });
    sdk.getWalletClaimStatus()
      .then((s) => {
        setUbiStatus(s.status as any);
        setUbiEntitlement(s.entitlement);
      })
      .catch(() => setUbiStatus("already_claimed"));
  }, [address, !!publicClient, !!walletClient]);

  async function handleUbiClaim() {
    if (!address || !publicClient || !walletClient) return;
    setUbiClaiming(true);
    setUbiErr("");
    try {
      const identitySDK = identitySDKHook ?? new (IdentitySDK as any)(publicClient, walletClient, "production");
      const sdk = new ClaimSDK({
        account:     address,
        publicClient: publicClient as any,
        walletClient: walletClient as any,
        identitySDK:  identitySDK as any,
        env:          "production",
      });
      await sdk.claim();
      setUbiClaimDone(true);
      setUbiStatus("already_claimed");
    } catch (e: unknown) {
      const msg = friendlyUbiError(e);
      if (msg) setUbiErr(msg);
    } finally {
      setUbiClaiming(false);
    }
  }

  const celoAmt = nativeBalance
    ? parseFloat(formatUnits(nativeBalance.value, nativeBalance.decimals)).toFixed(3)
    : "—";

  const avatarColor = `#${address.slice(2, 8)}`;
  const avatarText  = address.slice(2, 4).toUpperCase();
  const shortAddr   = `${address.slice(0, 6)}…${address.slice(-4)}`;

  // Auto-focus input when editing opens
  useEffect(() => {
    if (editing) {
      setInput(profile?.username ?? "");
      setCheckState("idle");
      setSaveError("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editing, profile?.username]);

  // Debounced availability check
  useEffect(() => {
    if (!editing) return;
    const val = input.trim().toLowerCase();
    if (!val) { setCheckState("idle"); return; }
    if (!USERNAME_RE.test(val)) { setCheckState("invalid"); return; }
    if (val === profile?.username?.toLowerCase()) { setCheckState("available"); return; }

    setCheckState("checking");
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/profile/check?username=${encodeURIComponent(val)}`);
        const data = await res.json();
        setCheckState(data.available ? "available" : "taken");
      } catch {
        setCheckState("idle");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [input, editing, profile?.username]);

  async function handleSave() {
    const username = input.trim();
    if (checkState !== "available" || !username) return;
    setSaving(true);
    setSaveError("");
    try {
      const timestamp = Date.now();
      const message   = `GoodDrops: claim username "${username}" at ${timestamp}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, username, signature, timestamp }),
      });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error ?? "Failed"); return; }

      invalidateProfile(address);
      // Re-fetch to update UI
      await fetch(`/api/profile?address=${address.toLowerCase()}`);
      setEditing(false);
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setSaveError(err.shortMessage ?? err.message ?? "Cancelled");
    } finally {
      setSaving(false);
    }
  }

  function copyAddress() {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const checkIcon = {
    idle:      null,
    checking:  <Loader2 size={13} color="#888" style={{ animation: "spin 1s linear infinite" }} />,
    available: <Check size={13} color="#22c55e" />,
    taken:     <X size={13} color="#ef4444" />,
    invalid:   <X size={13} color="#ef4444" />,
  }[checkState];

  const checkText = {
    idle:      "",
    checking:  "Checking…",
    available: "Available",
    taken:     "Already taken",
    invalid:   "3–24 chars, letters/numbers/_/-",
  }[checkState];

  const checkColor = {
    idle:      "#888",
    checking:  "#888",
    available: "#22c55e",
    taken:     "#ef4444",
    invalid:   "#ef4444",
  }[checkState];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[1190]" onClick={onClose} />

      {/* Card */}
      <div
        className="fixed z-[1200]"
        style={{
          top: 62,
          right: 12,
          width: "min(300px, calc(100vw - 24px))",
          fontFamily: "inherit",
        }}
      >
        <div style={{
          background: "#f5f4f0",
          border: "2.5px solid #111",
          borderRadius: 20,
          boxShadow: "5px 5px 0 #111",
          overflow: "hidden",
        }}>

          {/* ── Identity ──────────────────────────────────────────────────────── */}
          <div style={{ padding: "18px 18px 14px", borderBottom: "2px solid #111" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Avatar */}
              <div style={{
                width: 46, height: 46, borderRadius: "50%",
                background: avatarColor,
                border: "2.5px solid #111",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 900, fontSize: 14, color: "#fff",
                flexShrink: 0, textShadow: "0 1px 2px rgba(0,0,0,0.45)",
              }}>
                {avatarText}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Username or address */}
                {profile?.username ? (
                  <p style={{ margin: 0, fontWeight: 900, fontSize: 17, color: "#111", lineHeight: 1.2 }}>
                    @{profile.username}
                  </p>
                ) : (
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14, fontFamily: "monospace", color: "#111" }}>
                    {shortAddr}
                  </p>
                )}
                {profile?.username && (
                  <p style={{ margin: "2px 0 0", fontSize: 12, fontFamily: "monospace", color: "#888" }}>
                    {shortAddr}
                  </p>
                )}
              </div>

              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  onClick={copyAddress}
                  title="Copy address"
                  style={{
                    width: 34, height: 34,
                    background: copied ? "#BFFD00" : "#fff",
                    border: "2px solid #111", borderRadius: 9,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", transition: "background 0.15s",
                  }}
                >
                  {copied ? <Check size={14} color="#111" /> : <Copy size={14} color="#111" />}
                </button>

                {/* Edit username */}
                <button
                  onClick={() => setEditing((e) => !e)}
                  title={profile?.username ? "Edit username" : "Set username"}
                  style={{
                    width: 34, height: 34,
                    background: editing ? "#111" : "#fff",
                    border: "2px solid #111", borderRadius: 9,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <Pencil size={14} color={editing ? "#BFFD00" : "#111"} />
                </button>
              </div>
            </div>

            {/* ── Username edit form ─────────────────────────────────────────── */}
            {editing && (
              <div style={{ marginTop: 14 }}>
                <div style={{
                  display: "flex", alignItems: "center",
                  border: "2px solid #111", borderRadius: 10,
                  background: "#fff", overflow: "hidden",
                }}>
                  <span style={{ padding: "0 0 0 12px", fontWeight: 800, fontSize: 15, color: "#888", userSelect: "none" }}>
                    @
                  </span>
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value.replace(/\s/g, ""))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
                    placeholder="your_username"
                    maxLength={24}
                    style={{
                      flex: 1, border: "none", outline: "none",
                      padding: "9px 8px", fontSize: 15, fontWeight: 700,
                      background: "transparent", fontFamily: "inherit",
                    }}
                  />
                  {checkIcon && (
                    <span style={{ paddingRight: 10 }}>{checkIcon}</span>
                  )}
                </div>

                {/* Check status */}
                {checkText && (
                  <p style={{ margin: "5px 0 0", fontSize: 11, fontWeight: 700, color: checkColor }}>
                    {checkText}
                  </p>
                )}

                {/* Save error */}
                {saveError && (
                  <p style={{ margin: "5px 0 0", fontSize: 11, fontWeight: 700, color: "#ef4444" }}>
                    {saveError}
                  </p>
                )}

                <button
                  onClick={handleSave}
                  disabled={checkState !== "available" || saving}
                  style={{
                    marginTop: 10, width: "100%", padding: "10px",
                    background: checkState === "available" && !saving ? "#BFFD00" : "#eee",
                    color: checkState === "available" && !saving ? "#111" : "#aaa",
                    border: "2px solid",
                    borderColor: checkState === "available" && !saving ? "#111" : "#ddd",
                    borderRadius: 10,
                    boxShadow: checkState === "available" && !saving ? "2px 2px 0 #111" : "none",
                    fontWeight: 800, fontSize: 14,
                    cursor: checkState === "available" && !saving ? "pointer" : "not-allowed",
                    fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  }}
                >
                  {saving
                    ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Signing…</>
                    : profile?.username ? "Update username" : "Claim username"
                  }
                </button>
              </div>
            )}
          </div>

          {/* ── Hunting streak ───────────────────────────────────────────────── */}
          {streak && streak.current > 0 && (
            <div style={{ borderBottom: "1.5px solid #e8e6e0", padding: "10px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 34, height: 34, background: "#FF6400",
                border: "2px solid #111", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, flexShrink: 0,
              }}>
                🔥
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                  {streak.current}-day hunting streak
                </p>
                <p style={{ margin: 0, fontSize: 10, color: "#888" }}>
                  Best: {streak.best} days · Keep hunting daily!
                </p>
              </div>
              <div style={{
                background: streak.current >= 7 ? "#FF6400" : "#f5f4f0",
                color: streak.current >= 7 ? "#fff" : "#888",
                border: "1.5px solid #111",
                borderRadius: 8, padding: "3px 10px",
                fontSize: 11, fontWeight: 900,
              }}>
                {streak.current >= 30 ? "🏆 Legend" : streak.current >= 7 ? "🔥 On Fire" : `Day ${streak.current}`}
              </div>
            </div>
          )}

          {/* ── Balances ─────────────────────────────────────────────────────── */}
          <div>
            <div style={{
              padding: "13px 18px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderBottom: "1.5px solid #e8e6e0",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 34, height: 34, background: "#BFFD00",
                  border: "2px solid #111", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 900, color: "#111",
                }}>
                  G$
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#111" }}>G$ Balance</p>
                </div>
              </div>
              <span style={{ fontWeight: 900, fontSize: 17, color: "#111" }}>
                {formatG$(balance)}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#888", marginLeft: 3 }}>G$</span>
              </span>
            </div>

            <div style={{
              padding: "13px 18px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 34, height: 34, background: "#FCFF52",
                  border: "2px solid #111", borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16,
                }}>
                  🌿
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#111" }}>Celo</p>
                  <p style={{ margin: 0, fontSize: 10, color: "#888", fontWeight: 600 }}>For transaction fees</p>
                </div>
              </div>
              <span style={{ fontWeight: 900, fontSize: 17, color: "#111" }}>
                {celoAmt}
                <span style={{ fontSize: 12, fontWeight: 700, color: "#888", marginLeft: 3 }}>CELO</span>
              </span>
            </div>
          </div>

          {/* ── UBI / Engagement Rewards ──────────────────────────────────────── */}
          {isVerified && (
            <div style={{ borderTop: "1.5px solid #e8e6e0" }}>
              {ubiClaimDone ? (
                <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🎉</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                      G$ claimed!
                    </p>
                    <p style={{ margin: 0, fontSize: 10, color: "#888" }}>
                      {ubiEntitlement ? `+${formatG$(ubiEntitlement)} G$ added to your wallet` : "UBI claimed successfully"}
                    </p>
                  </div>
                </div>
              ) : ubiStatus === "can_claim" ? (
                <button
                  onClick={handleUbiClaim}
                  disabled={ubiClaiming}
                  style={{
                    width: "100%", padding: "11px 18px",
                    background: ubiClaiming ? "#f0f0f0" : "#BFFD0022",
                    border: "none", display: "flex", alignItems: "center", gap: 10,
                    cursor: ubiClaiming ? "wait" : "pointer", fontFamily: "inherit", textAlign: "left",
                  }}
                >
                  {ubiClaiming
                    ? <Loader2 size={18} color="#888" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                    : <Zap size={18} color="#BFFD00" style={{ flexShrink: 0 }} />
                  }
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#111" }}>
                      {ubiClaiming ? "Claiming…" : `Claim ${ubiEntitlement ? formatG$(ubiEntitlement) : ""} G$ UBI`}
                    </p>
                    <p style={{ margin: 0, fontSize: 10, color: "#888" }}>
                      Your daily GoodDollar UBI is ready
                    </p>
                  </div>
                  {!ubiClaiming && (
                    <span style={{
                      background: "#BFFD00", color: "#111", fontSize: 10, fontWeight: 900,
                      padding: "2px 7px", borderRadius: 100, border: "1.5px solid #111",
                    }}>Claim</span>
                  )}
                </button>
              ) : ubiStatus === "already_claimed" ? (
                <div style={{ padding: "11px 18px", display: "flex", alignItems: "center", gap: 10, opacity: 0.6 }}>
                  <Check size={16} color="#888" />
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#888" }}>
                    Daily G$ UBI already claimed
                  </p>
                </div>
              ) : null}
              {ubiErr && (
                <p style={{ margin: "0 18px 8px", fontSize: 11, color: "#FF3B3B", fontWeight: 700 }}>{ubiErr}</p>
              )}
            </div>
          )}

          {/* ── GD verification nudge ─────────────────────────────────────────── */}
          {!isVerified && (
            <div style={{ borderTop: "1.5px solid #e8e6e0" }}>
              <button
                onClick={() => { onOpenVerify(); onClose(); }}
                style={{
                  width: "100%", padding: "11px 18px", background: "#FFF3E0",
                  border: "none", display: "flex", alignItems: "center", gap: 10,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                }}
              >
                <span style={{ fontSize: 18 }}>⚡</span>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "#FF6400" }}>
                    Verify your account
                  </p>
                  <p style={{ margin: 0, fontSize: 10, color: "#FF6400", opacity: 0.8 }}>
                    Required to claim drops
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* ── Profile + Disconnect ─────────────────────────────────────────── */}
          <div style={{ padding: "12px 14px 14px", borderTop: "2px solid #111", display: "flex", flexDirection: "column", gap: 8 }}>
            <Link
              href={`/hunter/${address.toLowerCase()}`}
              onClick={onClose}
              style={{
                width: "100%", padding: "11px",
                background: "#BFFD00", color: "#111",
                border: "2px solid #111", borderRadius: 12,
                boxShadow: "2px 2px 0 #111",
                fontWeight: 800, fontSize: 14, textDecoration: "none",
                cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <User size={15} />
              View my profile
            </Link>
            <button
              onClick={() => { onDisconnect(); onClose(); }}
              style={{
                width: "100%", padding: "11px",
                background: "#111", color: "#fff",
                border: "2px solid #111", borderRadius: 12,
                boxShadow: "2px 2px 0 #555",
                fontWeight: 800, fontSize: 14,
                cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
