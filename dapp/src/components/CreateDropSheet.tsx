"use client";
import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useWriteContract, useSignMessage } from "wagmi";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { parseUnits, maxUint256 } from "viem";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS,
  GOOD_DROPS_ABI,
  G_TOKEN_ADDRESS,
  ERC20_ABI,
  CLAIM_RADIUS_M,
} from "@/lib/contracts";
import {
  degToGps, formatG$,
  buildPrivateHint, buildPrivateHintNoTarget, buildCampaignHint, buildRiddleHint,
  X_HANDLES, X_HASHTAGS,
} from "@/lib/utils";
import {
  RIDDLE_MAX_ANSWER, RIDDLE_MAX_QUESTION,
  normalizeAnswer, riddleOwnershipMessage,
} from "@/lib/riddles";
import { LocationPickerSheet } from "@/components/LocationPickerSheet";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, Share2, Lock, Puzzle } from "lucide-react";
import { decodeEventLog } from "viem";
import clsx from "clsx";

const DURATIONS = [
  { label: "1h",  seconds: 3_600 },
  { label: "6h",  seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
  { label: "7d",  seconds: 604_800 },
  { label: "30d", seconds: 2_592_000 },
];

type Status = "idle" | "approving" | "dropping" | "riddle" | "riddleFailed" | "done" | "error";

// A riddle can only be attached AFTER createDrop is mined (dropId doesn't exist
// before that). If the signature is rejected or the POST fails, the drop is
// already on-chain and marked [R] — live, escrowed, and unclaimable until the
// riddle lands. Retrying must therefore re-attach the riddle to THAT drop, never
// re-run createDrop (which would hide a second drop and spend the G$ twice).
//
// Parked on disk so closing the sheet, or the whole app, doesn't strand the drop.
const PENDING_KEY = "gd:pending-riddle";

interface PendingRiddle {
  dropId:   string;
  question: string;
  answer:   string;
}

function loadPending(): PendingRiddle | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingRiddle) : null;
  } catch { return null; }
}
function savePending(p: PendingRiddle) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch {}
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

interface Props {
  open: boolean;
  userLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  onSuccess: () => void;
  campaignId?: string;
  campaignName?: string;
  campaignColor?: string;
}

export function CreateDropSheet({ open, userLocation, onClose, onSuccess, campaignId, campaignName, campaignColor }: Props) {
  const { address, isConnected } = useSignedInAccount();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { balance, isFetching: balanceFetching } = useGoodDollarProfile();

  // ── Location (set via picker) ───────────────────────────────────────────────
  const [lat, setLat]           = useState<number | null>(null);
  const [lng, setLng]           = useState<number | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Form fields ────────────────────────────────────────────────────────────
  const [amount,        setAmount]        = useState("10");
  const [duration,      setDuration]      = useState(86_400);
  const [hint,          setHint]          = useState("");
  const [status,        setStatus]        = useState<Status>("idle");
  const [errMsg,        setErrMsg]        = useState("");
  // ── Private drop ────────────────────────────────────────────────────────────
  const [isPrivate,     setIsPrivate]     = useState(false);
  const [targetAddress, setTargetAddress] = useState("");
  const [createdDropId, setCreatedDropId] = useState<bigint | null>(null);
  const [privateToken,  setPrivateToken]  = useState<string | null>(null);
  const [linkCopied,    setLinkCopied]    = useState(false);
  // ── Riddle lock (optional) ──────────────────────────────────────────────────
  const [hasRiddle,      setHasRiddle]      = useState(false);
  const [riddleQuestion, setRiddleQuestion] = useState("");
  const [riddleAnswer,   setRiddleAnswer]   = useState("");
  const [pending,        setPending]        = useState<PendingRiddle | null>(null);
  // True only when we're recovering a drop stranded by an EARLIER session. The
  // form's amount/location state is long gone by then, so we must not reuse the
  // normal success screen — it would confidently show the default "10 G$".
  const [resuming,       setResuming]       = useState(false);

  // A drop stranded by an earlier failure (signature cancelled, app closed mid-flow)
  // is live on-chain, escrowed and unclaimable. Surface it the moment the sheet
  // opens so it can be finished, rather than silently leaving the G$ locked.
  useEffect(() => {
    if (!open) return;
    const p = loadPending();
    if (p) {
      setPending(p);
      setResuming(true);
      setStatus("riddleFailed");
      setErrMsg("");
    }
  }, [open]);

  const reset = useCallback(() => {
    setStatus("idle");
    setErrMsg("");
    setHint("");
    setAmount("10");
    setDuration(86_400);
    setLat(null);
    setLng(null);
    setPlaceName(null);
    setIsPrivate(false);
    setTargetAddress("");
    setCreatedDropId(null);
    setPrivateToken(null);
    setLinkCopied(false);
    setHasRiddle(false);
    setRiddleQuestion("");
    setRiddleAnswer("");
  }, []);

  const handleClose = () => { reset(); onClose(); };

  // ── Location picker confirmed ───────────────────────────────────────────────
  function handleLocationConfirm(pickedLat: number, pickedLng: number, name: string | null) {
    setLat(pickedLat);
    setLng(pickedLng);
    setPlaceName(name);
    setPickerOpen(false);
  }

  // ── On-chain drop ───────────────────────────────────────────────────────────
  async function handleDrop() {
    if (!address || lat === null || lng === null) return;
    // Never create a second drop while one is stranded — that would escrow the
    // user's G$ twice.
    if (pending) return;
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) { setErrMsg("Enter a valid amount."); return; }
    // hintMaxLen already accounts for the [P:…] / [R] prefix overhead.
    if (hint.length > hintMaxLen) {
      setErrMsg(`Clue is too long (max ${hintMaxLen} chars).`);
      return;
    }

    const amountBig = parseUnits(amount, 18);
    if (amountBig > balance) {
      setErrMsg(`Insufficient balance — you have ${formatG$(balance)} G$, need ${formatG$(amountBig)} G$.`);
      return;
    }
    const expiry = Math.floor(Date.now() / 1000) + duration + 120;

    // For private drops: store real coordinates server-side and pass (0,0) on-chain
    // so GPS coordinates are never readable from the blockchain or events.
    let onChainLat = lat;
    let onChainLng = lng;
    let token: string | null = null;

    if (isPrivate && !campaignId) {
      const res = await fetch("/api/private-drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) { setErrMsg("Could not store private drop — try again."); return; }
      const data = await res.json();
      token = data.token as string;
      onChainLat = 0;
      onChainLng = 0;
    }

    // Build stored hint: campaign drops take priority over private encoding
    const baseHint = campaignId
      ? buildCampaignHint(hint, campaignId)
      : isPrivate
        ? (targetAddress.trim()
            ? buildPrivateHint(hint, targetAddress.trim())
            : buildPrivateHintNoTarget(hint))
        : hint;

    // [R] goes outermost so the riddle lock is visible on-chain regardless of
    // whatever private/campaign encoding sits underneath it.
    const storedHint = riddleOn ? buildRiddleHint(baseHint) : baseHint;

    try {
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
        args: [address, GOOD_DROPS_ADDRESS],
      });
      if (allowance < amountBig) {
        setStatus("approving");
        const approveTx = await writeContractAsync({
          address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [GOOD_DROPS_ADDRESS, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }
      setStatus("dropping");
      const dropTx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
        args: [degToGps(onChainLat), degToGps(onChainLng), amountBig as bigint, expiry, storedHint],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: dropTx });

      // Extract the created drop ID from the DropCreated event log
      let newDropId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi:       GOOD_DROPS_ABI,
            data:      log.data,
            topics:    log.topics,
            eventName: "DropCreated",
          });
          if (decoded.args.dropId !== undefined) {
            newDropId = decoded.args.dropId as bigint;
            break;
          }
        } catch { /* not this log */ }
      }

      // Stamp the on-chain dropId onto the private-drop record
      if (token && newDropId !== null) {
        fetch("/api/private-drops", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, dropId: newDropId.toString() }),
        }).catch(() => {});
        setPrivateToken(token);
        // Persist token locally so the share link is recoverable even if this modal is closed
        try { localStorage.setItem(`gd:privdrop:${newDropId}`, token); } catch {}
      }

      setCreatedDropId(newDropId);

      // Attach the riddle. The drop is already on-chain and marked [R] at this
      // point, so failure here is NOT recoverable by retrying handleDrop — park
      // it and let attachRiddle() finish the job.
      if (riddleOn && newDropId !== null) {
        const pending: PendingRiddle = {
          dropId:   newDropId.toString(),
          question: riddleQuestion.trim(),
          answer:   riddleAnswer,
        };
        savePending(pending);
        setPending(pending);
        const ok = await attachRiddle(pending);
        if (!ok) return; // attachRiddle set status → "riddleFailed"
      }

      setStatus("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong — try again.");
      setStatus("error");
    }
  }

  // Signs proof-of-ownership and stores the riddle. Returns false (and leaves the
  // sheet in "riddleFailed") if it couldn't — so the caller never falls through to
  // a success screen for a drop that's still locked.
  async function attachRiddle(p: PendingRiddle): Promise<boolean> {
    setStatus("riddle");
    setErrMsg("");
    try {
      const signature = await signMessageAsync({ message: riddleOwnershipMessage(p.dropId) });
      const res = await fetch("/api/riddles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropId:   p.dropId,
          question: p.question,
          answer:   p.answer,
          signature,
        }),
      });

      // 409 = a riddle is already stored for this drop. That means a previous
      // attempt actually succeeded (the response was just lost), so we're done.
      if (res.ok || res.status === 409) {
        clearPending();
        setCreatedDropId(BigInt(p.dropId));
        return true;
      }

      const body = await res.json().catch(() => ({}));
      setErrMsg(body.error ?? "Could not save the riddle.");
      setStatus("riddleFailed");
      return false;
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      // Most common cause by far: the user dismissed the signature prompt.
      setErrMsg(err.shortMessage ?? err.message ?? "Signature was cancelled.");
      setStatus("riddleFailed");
      return false;
    }
  }

  function handleShare() {
    const loc = placeName ? `near ${placeName}` : "at a secret spot";
    const text = `I just hid ${amount} G$ ${loc} 🎯\n\nCan you find it? Hunt it down on GoodDrops 💰\n\n${X_HANDLES}\n${X_HASHTAGS}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      "_blank", "noopener,noreferrer"
    );
  }

  const busy = status === "approving" || status === "dropping" || status === "riddle";
  const amountNum = parseFloat(amount);
  const amountWei = !isNaN(amountNum) && amountNum > 0
    ? parseUnits(amount, 18)
    : 0n;
  const insufficientBalance = isConnected && !balanceFetching && amountWei > 0n && amountWei > balance;
  // Private prefix overhead: "[P:0x1234567890abcdef1234567890abcdef12345678]" = 46 chars
  // Riddle prefix overhead: "[R]" = 3 chars
  const hintMaxLen = (isPrivate ? 154 : 200) - (hasRiddle ? 3 : 0);

  // A riddle only counts if it's actually usable: an answer that normalises to
  // nothing (e.g. "???") could never be matched, and the server rejects it.
  const riddleReady =
    riddleQuestion.trim().length > 0 &&
    riddleQuestion.trim().length <= RIDDLE_MAX_QUESTION &&
    riddleAnswer.length <= RIDDLE_MAX_ANSWER &&
    normalizeAnswer(riddleAnswer).length > 0;
  const riddleOn = hasRiddle && riddleReady;

  // The clue is public and on-chain. Writing "under the RED bench" and then asking
  // "what colour is the bench?" hands the answer away — the single easiest way to
  // ruin a riddle, and the exact shape of our own placeholder text. Warn, don't
  // block: a clue may legitimately contain the word by coincidence.
  const answerNorm = normalizeAnswer(riddleAnswer);
  const answerLeaked =
    hasRiddle &&
    answerNorm.length > 2 &&
    normalizeAnswer(hint).includes(answerNorm);

  const canDrop =
    isConnected && lat !== null && lng !== null &&
    !isNaN(amountNum) && amountNum > 0 && hint.length <= hintMaxLen &&
    (!hasRiddle || riddleReady) &&
    !busy && !insufficientBalance;

  const btnLabel =
    status === "approving" ? "One moment…" :
    status === "dropping"  ? "Hiding…" :
    status === "riddle"    ? "Locking riddle…" :
    status === "error"     ? "Try again" :
    `Drop ${amount || "?"} G$`;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        animate={{ opacity: open && !pickerOpen ? 1 : 0, pointerEvents: open && !pickerOpen ? "auto" : "none" }}
        transition={{ duration: 0.2 }}
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1002,
          backgroundColor: "rgba(17,17,17,0.55)",
          backdropFilter: "blur(2px)",
          opacity: 0, pointerEvents: "none",
        }}
      />

      {/* Sheet */}
      <motion.div
        animate={{ y: open && !pickerOpen ? 0 : "100%" }}
        initial={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 420 }}
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1003,
          borderRadius: "24px 24px 0 0",
          background: "#f5f4f0",
          borderTop: "2px solid #111",
          maxHeight: "92dvh",
          overflowY: "auto",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#888" }} />
        </div>

        <div className="px-5 pb-10 pt-2 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight">Drop G$</h2>
              {campaignName ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    style={{ background: campaignColor || "#BFFD00" }}
                    className="inline-block w-2.5 h-2.5 rounded-full border border-ink"
                  />
                  <p className="text-sm font-bold text-ink">{campaignName} campaign drop</p>
                </div>
              ) : (
                <p className="text-sm text-muted mt-0.5">Hide money anywhere in the world</p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full border-2 border-ink flex items-center justify-center font-bold text-sm hover:bg-ink hover:text-lime transition-colors"
            >✕</button>
          </div>

          {/* Success state */}
          {status === "done" && (() => {
            const base = typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz";
            const shareUrl = createdDropId !== null
              ? `${base}/drop/${createdDropId}${privateToken ? `?k=${privateToken}` : ""}`
              : null;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── Hero card ── */}
                <div style={{
                  background: "#111", border: "2px solid #111",
                  borderRadius: 20, boxShadow: "4px 4px 0 #BFFD00",
                  padding: "28px 20px 22px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 52, marginBottom: 14, lineHeight: 1 }}>🎉</div>
                  <p style={{ margin: "0 0 14px", fontWeight: 900, fontSize: 26, color: "#BFFD00", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                    Drop hidden!
                  </p>

                  {/* Amount pill */}
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    background: "#BFFD00", color: "#111",
                    border: "2px solid #BFFD00", borderRadius: 100,
                    padding: "6px 18px", fontWeight: 900, fontSize: 20,
                    marginBottom: placeName ? 8 : 18,
                  }}>
                    💰 {amount} G$
                  </div>

                  {placeName && (
                    <p style={{ margin: "0 0 18px", fontSize: 13, color: "#888", fontWeight: 600 }}>
                      📍 {placeName}
                    </p>
                  )}

                  <button
                    onClick={handleShare}
                    style={{
                      width: "100%", padding: "12px",
                      background: "transparent", color: "#BFFD00",
                      border: "2px solid #BFFD00", borderRadius: 12,
                      fontWeight: 800, fontSize: 14, letterSpacing: "0.01em",
                      cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      transition: "background 0.15s, color 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#BFFD00"; e.currentTarget.style.color = "#111"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#BFFD00"; }}
                  >
                    <span>Post on 𝕏</span><span style={{ fontSize: 16 }}>↗</span>
                  </button>
                </div>

                {/* ── Share card ── */}
                {shareUrl && (
                  <div style={{
                    background: "#fff", border: "2px solid #111",
                    borderRadius: 20, boxShadow: "3px 3px 0 #111",
                    overflow: "hidden",
                  }}>
                    {/* QR section */}
                    <div style={{
                      background: "#f5f4f0", borderBottom: "2px solid #111",
                      padding: "20px 20px 16px", textAlign: "center",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
                    }}>
                      <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888" }}>
                        {isPrivate ? "📫 Private invitation" : "🔗 Drop link"}
                      </p>
                      <div style={{
                        background: "#fff", border: "2.5px solid #111",
                        borderRadius: 14, padding: 14,
                        boxShadow: "3px 3px 0 #111",
                        display: "inline-block",
                      }}>
                        <QRCodeSVG value={shareUrl} size={148} level="M" includeMargin={false} />
                      </div>
                      <p style={{ margin: 0, fontSize: 11, color: "#888", fontWeight: 600, maxWidth: 220, lineHeight: 1.5 }}>
                        {isPrivate
                          ? "Only people with this link can find the drop"
                          : "Scan to jump straight to the drop"}
                      </p>
                    </div>

                    {/* URL + copy */}
                    <div style={{ padding: "12px 14px", borderBottom: "1.5px solid #e8e6e0" }}>
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: "#f5f4f0", border: "2px solid #111",
                        borderRadius: 10, padding: "7px 8px 7px 12px",
                      }}>
                        <span style={{
                          flex: 1, minWidth: 0, fontFamily: "monospace",
                          fontSize: 11, color: "#666",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {shareUrl}
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(shareUrl).then(() => {
                              setLinkCopied(true);
                              setTimeout(() => setLinkCopied(false), 2000);
                            });
                          }}
                          style={{
                            flexShrink: 0,
                            display: "flex", alignItems: "center", gap: 6,
                            background: linkCopied ? "#BFFD00" : "#111",
                            color: linkCopied ? "#111" : "#BFFD00",
                            border: "none", borderRadius: 8,
                            padding: "7px 13px", fontWeight: 800, fontSize: 12,
                            cursor: "pointer", fontFamily: "inherit",
                            transition: "background 0.15s, color 0.15s",
                          }}
                        >
                          {linkCopied ? <Check size={12} /> : <Copy size={12} />}
                          {linkCopied ? "Copied!" : "Copy link"}
                        </button>
                      </div>
                    </div>

                    {/* Share via OS sheet */}
                    {typeof navigator !== "undefined" && "share" in navigator && (
                      <button
                        onClick={() => navigator.share?.({ title: "GoodDrops — hidden G$", url: shareUrl })}
                        style={{
                          width: "100%", padding: "14px 16px",
                          background: "transparent", border: "none",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          fontWeight: 800, fontSize: 14, color: "#111",
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f4f0"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <Share2 size={16} />
                        Share drop link
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={() => { onSuccess(); reset(); }}
                  style={{
                    width: "100%", padding: "12px",
                    background: "transparent", border: "none",
                    fontWeight: 700, fontSize: 14, color: "#888",
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#111"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "#888"; }}
                >
                  Done — back to map
                </button>
              </div>
            );
          })()}

          {/* ── Stranded drop: on-chain and [R]-marked, but no riddle stored ──
              The G$ is escrowed and nobody can claim it until the riddle lands.
              This screen retries ONLY the attach — re-running the drop would hide
              a second one and spend the balance twice. */}
          {pending && (status === "riddleFailed" || (resuming && status === "riddle")) && (
            <div style={{
              background: "#fff8e6", border: "2.5px solid #111",
              borderRadius: 18, boxShadow: "4px 4px 0 #111",
              padding: "22px 20px",
            }}>
              <p style={{ margin: "0 0 6px", fontWeight: 900, fontSize: 18 }}>
                ⚠️ One step left
              </p>
              <p style={{ margin: "0 0 14px", fontSize: 13, color: "#5a5a5a", lineHeight: 1.6 }}>
                Drop <strong>#{pending.dropId}</strong> is live and your G$ is safely escrowed —
                but its riddle didn&apos;t save, so nobody can claim it yet.
                Sign once to finish. This sends no transaction and costs nothing.
              </p>

              {errMsg && (
                <p style={{
                  margin: "0 0 12px", padding: "10px 12px",
                  background: "#FFE5E5", border: "1.5px solid #FF3B3B",
                  borderRadius: 10, color: "#C81E1E", fontSize: 12, fontWeight: 600,
                }}>
                  {errMsg}
                </p>
              )}

              <button
                onClick={async () => {
                  const ok = await attachRiddle(pending);
                  if (!ok) return;
                  if (resuming) {
                    // Recovered from an earlier session: the form's amount and
                    // location are gone, so skip the success hero (it would show a
                    // wrong, default amount) and just return to a refreshed map.
                    setPending(null);
                    setResuming(false);
                    onSuccess();
                    reset();
                  } else {
                    setPending(null);
                    setStatus("done");
                  }
                }}
                disabled={status === "riddle"}
                className="btn-brutal w-full py-3.5 rounded-xl font-black text-base bg-lime text-ink"
                style={status === "riddle" ? { opacity: 0.6, cursor: "wait" } : undefined}
              >
                {status === "riddle" ? "Signing…" : "Finish setting the riddle"}
              </button>

              <button
                onClick={() => {
                  // Escape hatch. The drop stays [R]-marked and unclaimable, so the
                  // G$ comes back via reclaim once it expires — say so plainly
                  // rather than pretending this is a clean cancel.
                  clearPending();
                  setPending(null);
                  setResuming(false);
                  reset();
                }}
                disabled={status === "riddle"}
                style={{
                  width: "100%", marginTop: 10, padding: 10,
                  background: "transparent", border: "none",
                  fontWeight: 700, fontSize: 12, color: "#888",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Skip — I&apos;ll reclaim the G$ when it expires
              </button>
            </div>
          )}

          {status !== "done" && status !== "riddleFailed" && !resuming && (
            <>
              {/* ── Location picker row ────────────────────────────────────── */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted">
                  Drop location
                </label>

                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full text-left"
                >
                  {lat !== null && lng !== null ? (
                    /* Location chosen */
                    <div className="flex items-center gap-3 bg-lime border-2 border-ink rounded-xl px-4 py-3 shadow-brutal-sm">
                      <span className="text-xl shrink-0">📍</span>
                      <div className="flex-1 min-w-0">
                        {placeName && (
                          <p className="font-black text-sm leading-tight truncate">{placeName}</p>
                        )}
                        <p className="text-xs text-ink/60 font-mono mt-0.5">
                          {lat.toFixed(5)}°, {lng.toFixed(5)}°
                        </p>
                      </div>
                      <span className="text-xs font-bold text-ink/50 shrink-0">Change →</span>
                    </div>
                  ) : (
                    /* No location yet */
                    <div className="flex items-center gap-3 border-2 border-dashed border-ink rounded-xl px-4 py-4 hover:bg-border transition-colors">
                      <div className="w-10 h-10 rounded-full bg-ink flex items-center justify-center shrink-0">
                        <span className="text-lime text-lg">🗺️</span>
                      </div>
                      <div>
                        <p className="font-black text-sm">Choose a location</p>
                        <p className="text-xs text-muted mt-0.5">
                          Search anywhere or pan the map
                        </p>
                      </div>
                      <span className="ml-auto text-xl">→</span>
                    </div>
                  )}
                </button>
              </div>

              {/* ── Amount ───────────────────────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted">Amount</label>
                  {isConnected && !balanceFetching && (
                    <span className={clsx(
                      "text-xs font-semibold",
                      insufficientBalance ? "text-danger" : "text-muted"
                    )}>
                      Balance: {formatG$(balance)} G$
                    </span>
                  )}
                </div>
                <div className={clsx(
                  "flex items-center border-2 rounded-xl overflow-hidden transition-colors",
                  insufficientBalance ? "border-danger" : "border-ink"
                )}>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1" max="500" step="1" placeholder="10"
                    className="flex-1 px-4 py-3 text-xl font-black bg-transparent outline-none"
                  />
                  <div className="pr-4 text-xl font-black text-muted">G$</div>
                </div>
                {insufficientBalance ? (
                  <p className="text-xs text-danger font-semibold">
                    You only have {formatG$(balance)} G$ — reduce the amount.
                  </p>
                ) : (
                  <p className="text-xs text-muted">Min 1 G$ · Max 500 G$</p>
                )}
              </div>

              {/* ── Expiry ───────────────────────────────────────────────────── */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted">Expires in</label>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((d) => (
                    <button
                      key={d.seconds}
                      onClick={() => setDuration(d.seconds)}
                      className={clsx(
                        "px-4 py-2 rounded-lg border-2 border-ink text-sm font-bold transition-all",
                        duration === d.seconds ? "bg-lime shadow-brutal-sm" : "bg-cream hover:bg-border"
                      )}
                    >{d.label}</button>
                  ))}
                </div>
              </div>

              {/* ── Hint ─────────────────────────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted">
                    Clue — where to look
                  </label>
                  <span className={clsx("text-xs font-semibold", hint.length > hintMaxLen - 20 ? "text-danger" : "text-muted")}>
                    {hint.length}/{hintMaxLen}
                  </span>
                </div>
                <textarea
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="e.g. Under the bench by the fountain 🔍"
                  maxLength={hintMaxLen} rows={3}
                  className="w-full border-2 border-ink rounded-xl px-4 py-3 text-sm bg-transparent outline-none resize-none placeholder:text-muted"
                />
                <p className="text-xs text-muted">
                  GPS only gets hunters within {CLAIM_RADIUS_M}m — the clue points them at the exact spot.
                </p>
              </div>

              {/* ── Private drop toggle — hidden for campaign drops ───────── */}
              {!campaignId && <div className="border-2 border-ink rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsPrivate((p) => !p)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-cream hover:bg-border transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Lock size={15} strokeWidth={2.5} className={isPrivate ? "text-ink" : "text-muted"} />
                    <div className="text-left">
                      <p className={clsx("text-sm font-bold", isPrivate ? "text-ink" : "text-muted")}>
                        Private drop
                      </p>
                      <p className="text-xs text-muted">
                        Hidden from map — share the link to invite someone
                      </p>
                    </div>
                  </div>
                  <div className={clsx(
                    "w-10 h-6 rounded-full border-2 border-ink relative shrink-0 transition-colors",
                    isPrivate ? "bg-lime" : "bg-border"
                  )}>
                    <div className={clsx(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all",
                      isPrivate ? "left-4" : "left-0.5"
                    )} />
                  </div>
                </button>

                {isPrivate && (
                  <div className="px-4 pb-4 pt-3 border-t-2 border-ink bg-cream space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted block">
                      For (address) — optional
                    </label>
                    <input
                      type="text"
                      value={targetAddress}
                      onChange={(e) => setTargetAddress(e.target.value)}
                      placeholder="0x…  leave blank for anyone with the link"
                      className="w-full border-2 border-ink rounded-xl px-4 py-2.5 text-sm bg-white outline-none font-mono placeholder:text-muted placeholder:font-sans"
                    />
                    <p className="text-xs text-muted">
                      The app will warn others this drop wasn&apos;t meant for them.
                    </p>
                  </div>
                )}
              </div>}

              {/* ── Riddle lock (optional) ─────────────────────────────────── */}
              <div className="border-2 border-ink rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setHasRiddle((r) => !r)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-cream hover:bg-border transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Puzzle size={15} strokeWidth={2.5} className={hasRiddle ? "text-ink" : "text-muted"} />
                    <div className="text-left">
                      <p className={clsx("text-sm font-bold", hasRiddle ? "text-ink" : "text-muted")}>
                        Lock with a riddle
                      </p>
                      <p className="text-xs text-muted">
                        Hunters must answer correctly to claim
                      </p>
                    </div>
                  </div>
                  <div className={clsx(
                    "w-10 h-6 rounded-full border-2 border-ink relative shrink-0 transition-colors",
                    hasRiddle ? "bg-lime" : "bg-border"
                  )}>
                    <div className={clsx(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-ink transition-all",
                      hasRiddle ? "left-4" : "left-0.5"
                    )} />
                  </div>
                </button>

                {hasRiddle && (
                  <div className="px-4 pb-4 pt-3 border-t-2 border-ink bg-cream space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted">
                          Question
                        </label>
                        <span className={clsx(
                          "text-xs font-semibold",
                          riddleQuestion.length > RIDDLE_MAX_QUESTION - 20 ? "text-danger" : "text-muted"
                        )}>
                          {riddleQuestion.length}/{RIDDLE_MAX_QUESTION}
                        </span>
                      </div>
                      <textarea
                        value={riddleQuestion}
                        onChange={(e) => setRiddleQuestion(e.target.value)}
                        placeholder="e.g. What colour is the bench I'm hiding under?"
                        maxLength={RIDDLE_MAX_QUESTION}
                        rows={2}
                        className="w-full border-2 border-ink rounded-xl px-4 py-2.5 text-sm bg-white outline-none resize-none placeholder:text-muted"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-muted block">
                        Answer
                      </label>
                      <input
                        type="text"
                        value={riddleAnswer}
                        onChange={(e) => setRiddleAnswer(e.target.value)}
                        placeholder="red"
                        maxLength={RIDDLE_MAX_ANSWER}
                        className="w-full border-2 border-ink rounded-xl px-4 py-2.5 text-sm bg-white outline-none placeholder:text-muted"
                      />
                      <p className="text-xs text-muted">
                        Capitals, spaces and punctuation are ignored — &ldquo;The Red Bench!&rdquo; matches
                        &ldquo;red bench&rdquo;.
                      </p>
                      {answerLeaked && (
                        <p className="text-xs font-semibold text-danger bg-danger/10 border-2 border-danger rounded-lg px-3 py-2">
                          ⚠️ Your clue contains the answer — anyone can read it. The clue is public
                          and stored on-chain.
                        </p>
                      )}
                    </div>

                    <div className="bg-white border-2 border-ink rounded-xl px-3 py-2.5 flex gap-2.5">
                      <span className="text-sm shrink-0">🥇</span>
                      <p className="text-xs text-ink/70 leading-relaxed">
                        The first hunter to answer correctly gets{" "}
                        <span className="font-bold text-ink">10 minutes of exclusive access</span> to
                        claim it — no sniping.
                      </p>
                    </div>

                    {hasRiddle && !riddleReady && (
                      <p className="text-xs text-muted">
                        Add a question and an answer to continue.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Error ────────────────────────────────────────────────────── */}
              {(status === "error" || errMsg) && (
                <div className="bg-danger/10 border-2 border-danger rounded-xl px-4 py-3 text-sm text-danger font-semibold">
                  {errMsg || "Something went wrong."}
                </div>
              )}

              {/* ── CTA ──────────────────────────────────────────────────────── */}
              <div className="space-y-2 pt-1">
                {!isConnected ? (
                  <p className="text-center text-sm text-muted font-semibold">
                    Sign in to drop G$
                  </p>
                ) : (
                  <button
                    onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handleDrop}
                    disabled={status !== "error" && !canDrop}
                    className={clsx(
                      "btn-brutal w-full py-4 rounded-xl font-black text-base transition-all",
                      canDrop || status === "error"
                        ? "bg-lime text-ink cursor-pointer"
                        : "bg-border text-muted cursor-not-allowed"
                    )}
                    style={!(canDrop || status === "error") ? { boxShadow: "none", transform: "none" } : {}}
                  >
                    {btnLabel}
                  </button>
                )}
                <p className="text-center text-xs text-muted">
                  Hunters within 100m can claim this drop
                </p>
              </div>
            </>
          )}
        </div>
      </motion.div>

      {/* Location picker — slides over the create sheet */}
      <LocationPickerSheet
        open={pickerOpen}
        initialCenter={lat !== null && lng !== null ? { lat, lng } : userLocation}
        currentLocation={userLocation}
        onConfirm={handleLocationConfirm}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}
