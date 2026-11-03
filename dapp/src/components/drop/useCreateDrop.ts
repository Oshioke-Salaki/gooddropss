"use client";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useSignMessage, useReadContract } from "wagmi";
import { useSponsoredWrite } from "@/lib/useSponsoredWrite";
import { useSignedInAccount } from "@/hooks/useSignedInAccount";
import { parseUnits, maxUint256, decodeEventLog, isAddress, type Hex } from "viem";
import { confirmTx, StillPendingError } from "@/lib/txOutcome";
import { publicClient } from "@/lib/publicClient";
import {
  GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, G_TOKEN_ADDRESS, ERC20_ABI, CLAIM_RADIUS_M,
} from "@/lib/contracts";
import {
  degToGps, formatG$, haversineDistance,
  buildPrivateHint, buildPrivateHintNoTarget, buildCampaignHint, buildRiddleHint,
  X_HANDLES, X_HASHTAGS,
} from "@/lib/utils";
import { useLandmarks } from "@/hooks/useLandmarks";
import { useProfile } from "@/hooks/useProfile";
import { LANDMARK_CLUE_RADIUS_M } from "@/lib/landmarks";
import { inviteUrl } from "@/lib/referral";
import { SITE_URL } from "@/lib/site";
import { scatterPoints } from "@/lib/scatter";
import { friendlyClaimError } from "@/lib/claimErrors";
import {
  RIDDLE_MAX_ANSWER, RIDDLE_MAX_QUESTION,
  normalizeAnswer, riddleTokenMessage, newRiddleToken,
} from "@/lib/riddles";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { track } from "@/lib/analytics";
import { buildEventHint } from "@/lib/events";

export const DURATIONS = [
  { label: "1h",  seconds: 3_600 },
  { label: "6h",  seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
  { label: "7d",  seconds: 604_800 },
  { label: "30d", seconds: 2_592_000 },
];

/** Plain words for a failed drop, never the wallet's raw text. */
function dropErrorMessage(e: unknown): string {
  const fe = friendlyClaimError(e);
  if (fe.kind === "gas") return "We couldn't cover the small cost of hiding this just now. Give it a minute, then try again. Nothing was spent.";
  if (fe.kind === "network") return fe.message;
  return "That drop didn't go through, and none of your G$ was spent. Please try again.";
}

// Multi-drop: scatter up to this many identical drops around one spot. Capped
// because the batch is one transaction and the gas grows with it.
export const MAX_MULTI = 20;

export type DropStatus =
  | "idle" | "approving" | "dropping" | "riddle" | "riddleFailed" | "multi" | "done" | "error";

// A riddle can only be attached AFTER createDrop is mined (dropId doesn't exist
// before that). If the signature is rejected or the POST fails, the drop is
// already on-chain and marked [R] — live, escrowed, and unclaimable until the
// riddle lands. Retrying must therefore re-attach the riddle to THAT drop, never
// re-run createDrop (which would hide a second drop and spend the G$ twice).
//
// Parked on disk so closing the sheet, or the whole app, doesn't strand the drop.
const PENDING_KEY = "gd:pending-riddle";

/** A riddle drop that's on-chain but whose riddle isn't bound to its dropId yet. */
interface PendingRiddle { dropId: string; token: string }

function loadPending(): PendingRiddle | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingRiddle) : null;
  } catch { return null; }
}
function savePending(p: PendingRiddle) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* private mode */ }
}

export interface UseCreateDropOpts {
  campaignId?: string;
  /** Tag drops for an event ([E:id], see lib/events). Never private. */
  eventId?: string;
  /** Unix seconds the event ends. Event drops then last exactly the event (plus
   *  a short grace), instead of a duration counted from when they were placed. */
  eventEndsAt?: number;
  /** Where the form starts (e.g. the event venue). The person can still move it. */
  defaultLocation?: { lat: number; lng: number; placeName: string | null } | null;
  /** Coordinates where drops have been claimed — local demand while picking a spot. */
  claimPoints?: { lat: number; lng: number }[];
  onClose: () => void;
}

/**
 * Everything behind the Drop G$ form: validation, the identity gate, approval,
 * createDrop / createManyDrops, private-drop storage, and the riddle bind-and-
 * resume dance. Kept out of the view so the drawer is only layout, and so this
 * can be reasoned about (and tested) on its own.
 */
// Event drops stay claimable this long after the event ends, for stragglers.
const EVENT_GRACE_S = 3_600;

export function useCreateDrop({ campaignId, eventId, eventEndsAt, defaultLocation = null, claimPoints = [], onClose }: UseCreateDropOpts) {
  const { address, isConnected } = useSignedInAccount();
  const { writeContractAsync } = useSponsoredWrite();
  const { signMessageAsync } = useSignMessage();
  const { balance, isFetching: balanceFetching } = useGoodDollarProfile();
  // Dropping is identity-gated exactly like claiming: only verified humans can
  // hide G$. Keeps the "unique humans" metric honest and blocks Sybil drop farms.
  const {
    isVerified, isLapsed, isLoading: identityLoading, checkFailed: identityCheckFailed,
  } = useIdentityStatus();
  const { landmarks } = useLandmarks();
  // Drops must be attributable to a named human — no anonymous drops on the map.
  const profile = useProfile(address);
  const hasUsername = !!profile?.username;

  // Live drop limits from the contract, so the UI can't drift if they're ever
  // changed on-chain. Fall back to the known 1–500 G$ while the reads resolve.
  const { data: maxDropWei } = useReadContract({
    address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "maxDropAmount",
  });
  const { data: minDropWei } = useReadContract({
    address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "minDropAmount",
  });
  const maxDrop = (maxDropWei as bigint | undefined) ?? parseUnits("500", 18);
  const minDrop = (minDropWei as bigint | undefined) ?? parseUnits("1", 18);
  const maxG = Number(maxDrop / 10n ** 18n);
  const minG = Number(minDrop / 10n ** 18n) || 1;

  // ── Location ────────────────────────────────────────────────────────────────
  const [lat, setLat] = useState<number | null>(defaultLocation?.lat ?? null);
  const [lng, setLng] = useState<number | null>(defaultLocation?.lng ?? null);
  const [placeName, setPlaceName] = useState<string | null>(defaultLocation?.placeName ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Form ────────────────────────────────────────────────────────────────────
  const [amount, setAmount] = useState("10");
  const [quantity, setQuantity] = useState(1);
  const [multiProgress, setMultiProgress] = useState<{ done: number; failed: number; total: number } | null>(null);
  const [duration, setDuration] = useState(86_400);
  const [hint, setHint] = useState("");
  const [status, setStatus] = useState<DropStatus>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [targetAddress, setTargetAddress] = useState("");
  const [createdDropId, setCreatedDropId] = useState<bigint | null>(null);
  const [privateToken, setPrivateToken] = useState<string | null>(null);
  const [hasRiddle, setHasRiddle] = useState(false);
  const [riddleQuestion, setRiddleQuestion] = useState("");
  const [riddleAnswer, setRiddleAnswer] = useState("");
  const [pending, setPending] = useState<PendingRiddle | null>(null);
  // True only when recovering a drop stranded by an EARLIER session. The form's
  // amount/location state is long gone by then, so the normal success screen must
  // not be reused — it would confidently show the default "10 G$".
  const [resuming, setResuming] = useState(false);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const amountNum = parseFloat(amount);
  // parseUnits runs during RENDER, so anything it rejects would crash the whole
  // drawer rather than showing a validation message. ".5", "1.", "1.2.3" and an
  // over-long fraction all reach here from a half-typed field, so normalise first
  // and still catch — a bad amount must degrade to 0n, never throw.
  const amountWei = useMemo(() => {
    if (isNaN(amountNum) || amountNum <= 0) return 0n;
    const [whole = "", frac = ""] = amount.split(".");
    const safe = `${whole || "0"}.${frac.slice(0, 18) || "0"}`;
    try { return parseUnits(safe, 18); } catch { return 0n; }
  }, [amount, amountNum]);
  // Multi-drop = scatter N identical drops around one spot. Not offered for
  // campaign/private/riddle drops (those are inherently 1:1).
  const multiActive = quantity > 1 && !campaignId;
  const qty = Math.min(MAX_MULTI, Math.max(1, Math.floor(quantity) || 1));
  const totalWei = amountWei * BigInt(qty);
  const insufficientBalance = isConnected && !balanceFetching && totalWei > 0n && totalWei > balance;
  const overMax = amountWei > 0n && amountWei > maxDrop;
  const underMin = amountWei > 0n && amountWei < minDrop;
  // Private prefix overhead: "[P:0x…]" = 46 chars. Riddle prefix "[R]" = 3.
  // Event tag "[E:<id>]" takes its own length, so the on-chain 200 always holds.
  const eventTagLen = eventId ? buildEventHint("", eventId).length : 0;
  const hintMaxLen = (isPrivate ? 154 : 200) - (hasRiddle ? 3 : 0) - eventTagLen;

  // A riddle only counts if it's actually usable: an answer that normalises to
  // nothing (e.g. "???") could never be matched, and the server rejects it.
  const riddleReady =
    riddleQuestion.trim().length > 0 &&
    riddleQuestion.trim().length <= RIDDLE_MAX_QUESTION &&
    riddleAnswer.length <= RIDDLE_MAX_ANSWER &&
    normalizeAnswer(riddleAnswer).length > 0;
  const riddleOn = hasRiddle && riddleReady;

  // The clue is public and on-chain. Writing "under the RED bench" and then asking
  // "what colour is the bench?" hands the answer away. Warn, don't block: a clue
  // may legitimately contain the word by coincidence.
  const answerNorm = normalizeAnswer(riddleAnswer);
  const answerLeaked = hasRiddle && answerNorm.length > 2 && normalizeAnswer(hint).includes(answerNorm);

  const busy = status === "approving" || status === "dropping" || status === "riddle" || status === "multi";
  // A typo here would make a private drop unclaimable by the person it's for.
  const targetInvalid = isPrivate && !campaignId && targetAddress.trim() !== "" && !isAddress(targetAddress.trim());

  const canDrop =
    isConnected && lat !== null && lng !== null &&
    !isNaN(amountNum) && amountNum > 0 && hint.length <= hintMaxLen &&
    (!hasRiddle || riddleReady) && !targetInvalid &&
    !busy && !insufficientBalance && !overMax && !underMin;

  const btnLabel =
    status === "approving" ? "One moment…" :
    status === "dropping"  ? "Hiding…" :
    status === "riddle"    ? "Locking riddle…" :
    status === "multi"     ? `Scattering ${qty} drops…` :
    status === "error"     ? "Try again" :
    multiActive            ? `Drop ${qty} × ${amount || "?"} G$` :
    `Drop ${amount || "?"} G$`;

  // Landmarks near the chosen spot — one-tap clue shortcuts so a dropper can
  // anchor their hint to a place hunters actually recognise.
  const nearbyLandmarks = useMemo(() => {
    if (lat === null || lng === null) return [];
    return landmarks
      .filter((l) => l.status === "active" && Number.isFinite(l.lat) && Number.isFinite(l.lng))
      .map((l) => ({ l, d: haversineDistance(lat, lng, l.lat, l.lng) }))
      .filter(({ d }) => d <= LANDMARK_CLUE_RADIUS_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .map(({ l }) => l);
  }, [landmarks, lat, lng]);

  // Local demand: how many drops have been claimed near this spot.
  const nearbyDemand = useMemo(() => {
    if (lat === null || lng === null) return 0;
    return claimPoints.filter((p) => haversineDistance(lat, lng, p.lat, p.lng) <= 1500).length;
  }, [claimPoints, lat, lng]);

  // ── Effects ─────────────────────────────────────────────────────────────────

  // A drop stranded by an earlier failure is live on-chain, escrowed and
  // unclaimable. Surface it the moment the drawer opens rather than silently
  // leaving the G$ locked. The drawer is mounted only while open, so mount IS open.
  useEffect(() => {
    const p = loadPending();
    // An old-format record (pre token-bind flow) has no token and can't be bound —
    // discard it rather than showing a resume prompt that can never succeed.
    if (p && !p.token) { clearPending(); setPending(null); return; }
    // Always reflect storage — setting null clears any stale in-memory pending so a
    // finished riddle drop can't leave the next drop's button silently blocked.
    setPending(p);
    if (p) { setResuming(true); setStatus("riddleFailed"); setErrMsg(""); }
  }, []);

  // Multi-drop and private/riddle are mutually exclusive — a scattered batch can't
  // be one private link or share one riddle.
  useEffect(() => {
    if (quantity > 1 && !campaignId) { setIsPrivate(false); setHasRiddle(false); }
  }, [quantity, campaignId]);

  // Event drops are public by definition — hunters at the event find them on the map.
  useEffect(() => { if (eventId) setIsPrivate(false); }, [eventId, isPrivate]);

  const reset = useCallback(() => {
    sent.current = null;
    setStatus("idle"); setErrMsg(""); setHint(""); setAmount("10");
    setQuantity(1); setMultiProgress(null); setDuration(86_400);
    setLat(defaultLocation?.lat ?? null); setLng(defaultLocation?.lng ?? null); setPlaceName(defaultLocation?.placeName ?? null);
    setIsPrivate(false); setTargetAddress("");
    setCreatedDropId(null); setPrivateToken(null);
    setHasRiddle(false); setRiddleQuestion(""); setRiddleAnswer("");
    setPending(null); setResuming(false);
  }, [defaultLocation?.lat, defaultLocation?.lng, defaultLocation?.placeName]);

  // One drop at a time (see handleDrop). Declared here so closing can respect it.
  const inFlight = useRef(false);
  // A drop that was sent but whose ending we haven't seen yet. While this is
  // set, "Try again" finishes THIS drop rather than hiding (and paying for) a
  // second one.
  const sent = useRef<{ hash: Hex; kind: "single" | "multi"; token: string | null; riddleToken: string | null } | null>(null);
  // Never close mid-drop: the flow would keep running out of sight, and the
  // person couldn't tell whether their G$ moved.
  const handleClose = useCallback(() => { if (inFlight.current) return; reset(); onClose(); }, [reset, onClose]);

  const handleLocationConfirm = useCallback((pickedLat: number, pickedLng: number, name: string | null) => {
    setLat(pickedLat); setLng(pickedLng); setPlaceName(name); setPickerOpen(false);
  }, []);

  // ── Riddle bind ─────────────────────────────────────────────────────────────
  // A plain, signature-free network call (the ownership signature was taken
  // up-front, before the drop). Auto-retries transient failures; on a hard
  // failure it parks in "riddleFailed" so the resume UI can finish it later.
  // Returns false so the caller never shows success for an unbound riddle.
  const bindRiddle = useCallback(async (p: PendingRiddle): Promise<boolean> => {
    setStatus("riddle");
    setErrMsg("");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/riddles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: p.token, dropId: p.dropId }),
        });
        // ok (bound) or already-bound both mean success (retry-safe).
        if (res.ok) {
          clearPending();
          setPending(null); // clear STATE too, or the next drop is silently blocked
          setCreatedDropId(BigInt(p.dropId));
          return true;
        }
        // 404 (token expired) / 403 (owner mismatch) aren't transient — stop.
        if (res.status === 404 || res.status === 403) {
          const body = await res.json().catch(() => ({}));
          setErrMsg(body.error ?? "Could not finish the riddle.");
          setStatus("riddleFailed");
          return false;
        }
      } catch { /* network blip — fall through to retry */ }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
    setErrMsg("Couldn't finish setting up the riddle — tap to retry.");
    setStatus("riddleFailed");
    return false;
  }, []);

  // The contract checks expiry against the BLOCK timestamp, which drifts from the
  // device clock by mining latency and device skew. Pad the lower bound so that
  // drift can't drop us under now+minDuration (the "1h" option sits exactly on
  // that floor), and cap the upper bound below now+maxDuration so neither the pad
  // nor a fast device clock pushes "30d" over the ceiling. A naive fixed "+120"
  // made every 30d drop revert with InvalidExpiry.
  const expiryFor = useCallback((seconds: number) => {
    const SKEW = 300;
    const nowSec = Math.floor(Date.now() / 1000);
    const maxDuration = Math.max(...DURATIONS.map((d) => d.seconds));
    return Math.min(nowSec + seconds + SKEW, nowSec + maxDuration - SKEW);
  }, []);

  /**
   * The expiry to put on chain, or null after reporting why there isn't one.
   * Event drops expire when the event does (plus EVENT_GRACE_S), so drops placed
   * days ahead can't run out before it starts. The contract caps a drop at 30
   * days and floors it at 1 hour; outside that window we say when to come back.
   */
  const dropExpiry = useCallback((): number | null => {
    if (!eventEndsAt) return expiryFor(duration);
    const SKEW = 300;
    const nowSec = Math.floor(Date.now() / 1000);
    const minDuration = Math.min(...DURATIONS.map((d) => d.seconds));
    const maxDuration = Math.max(...DURATIONS.map((d) => d.seconds));
    const target = eventEndsAt + EVENT_GRACE_S;
    if (target > nowSec + maxDuration - SKEW) {
      const from = new Date((target - maxDuration + SKEW + 60) * 1000);
      setErrMsg(`Drops can last up to 30 days, so add them from ${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`);
      return null;
    }
    return Math.max(target, nowSec + minDuration + SKEW);
  }, [eventEndsAt, duration, expiryFor]);
  /** Seconds the last drop will live, for the success screen. */
  const [placedForS, setPlacedForS] = useState<number | null>(null);

  /** Shared pre-flight for both drop paths. Returns false if it reported a problem. */
  const guard = useCallback((): boolean => {
    if (!address || lat === null || lng === null) return false;
    // Anonymous drops erode trust — require a username first.
    if (!hasUsername) {
      setErrMsg("Set a username before dropping.");
      window.dispatchEvent(new CustomEvent("gd:setName"));
      return false;
    }
    // Identity gate. Never block on a check that merely hasn't resolved or that
    // failed — let the CTA show "checking…" rather than a false refusal.
    if (!identityLoading && !identityCheckFailed && !isVerified) {
      setErrMsg(isLapsed ? "Re-verify your GoodDollar identity to drop." : "Verify your GoodDollar identity to drop.");
      window.dispatchEvent(new CustomEvent("gd:openVerify"));
      return false;
    }
    return true;
  }, [address, lat, lng, hasUsername, identityLoading, identityCheckFailed, isVerified, isLapsed]);

  // ── Multi-drop: one approval + ONE createManyDrops (atomic, single signature) ──
  const handleMultiDrop = useCallback(async () => {
    if (!address || lat === null || lng === null) return;
    if (amountWei <= 0n)     { setErrMsg("Enter a valid amount."); return; }
    if (amountWei > maxDrop) { setErrMsg(`Maximum single drop is ${formatG$(maxDrop)} G$.`); return; }
    if (amountWei < minDrop) { setErrMsg(`Minimum drop is ${formatG$(minDrop)} G$.`); return; }
    if (totalWei > balance)  { setErrMsg(`Not enough G$ — ${qty} × ${formatG$(amountWei)} needs ${formatG$(totalWei)} G$.`); return; }
    if (hint.length > hintMaxLen) { setErrMsg(`Clue is too long (max ${hintMaxLen} chars).`); return; }

    const expiry = dropExpiry();
    if (expiry === null) return;
    setPlacedForS(expiry - Math.floor(Date.now() / 1000));
    const points = scatterPoints(lat, lng, qty, CLAIM_RADIUS_M);
    const lats = points.map((p) => degToGps(p.lat));
    const lngs = points.map((p) => degToGps(p.lng));

    setErrMsg("");
    setMultiProgress({ done: 0, failed: 0, total: qty });
    setStatus("approving"); // busy from the first tap, before any network wait
    try {
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
        args: [address, GOOD_DROPS_ADDRESS],
      });
      if (allowance < totalWei) {
        setStatus("approving");
        const approveTx = await writeContractAsync({
          address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [GOOD_DROPS_ADDRESS, maxUint256],
        });
        await confirmTx(approveTx);
      }

      setStatus("multi");
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createManyDrops",
        args: [lats, lngs, amountWei as bigint, expiry, eventId ? buildEventHint(hint, eventId) : hint],
      });
      sent.current = { hash: tx, kind: "multi", token: null, riddleToken: null };
    } catch (e: unknown) {
      const fe = friendlyClaimError(e);
      if (fe.kind === "rejected") { setStatus("idle"); setErrMsg(""); setMultiProgress(null); return; }
      setErrMsg(dropErrorMessage(e));
      setStatus("error");
      return;
    }
    await finishSent();
  // finishSent is declared below and stable for this purpose (it reads refs/state setters).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, lat, lng, amountWei, maxDrop, minDrop, totalWei, balance, qty, hint, hintMaxLen,
      dropExpiry, writeContractAsync, eventId]);

  // ── Single drop ─────────────────────────────────────────────────────────────
  const runDrop = useCallback(async () => {
    // A drop already sent whose ending we didn't see: check on it, don't resend.
    if (sent.current) { await finishSent(); return; }
    if (!guard()) return;
    if (multiActive) { await handleMultiDrop(); return; }
    // Never create a second drop while one is stranded — that escrows twice.
    if (pending) return;
    if (isNaN(amountNum) || amountNum <= 0) { setErrMsg("Enter a valid amount."); return; }
    if (hint.length > hintMaxLen) { setErrMsg(`Clue is too long (max ${hintMaxLen} chars).`); return; }
    if (targetInvalid) { setErrMsg("That recipient address doesn't look right. Check it, or leave it empty."); return; }

    const amountBig = amountWei;
    if (amountBig <= 0n) { setErrMsg("Enter a valid amount."); return; }
    if (amountBig > maxDrop) { setErrMsg(`Maximum drop is ${formatG$(maxDrop)} G$ — lower the amount.`); return; }
    if (amountBig < minDrop) { setErrMsg(`Minimum drop is ${formatG$(minDrop)} G$.`); return; }
    if (amountBig > balance) {
      setErrMsg(`Insufficient balance — you have ${formatG$(balance)} G$, need ${formatG$(amountBig)} G$.`);
      return;
    }

    const expiry = dropExpiry();
    if (expiry === null) return;
    setPlacedForS(expiry - Math.floor(Date.now() / 1000));

    // Private drops store real coordinates server-side and pass (0,0) on-chain, so
    // GPS is never readable from the blockchain or its events.
    let onChainLat = lat as number;
    let onChainLng = lng as number;
    let token: string | null = null;

    if (isPrivate && !campaignId) {
      setErrMsg("");
      setStatus("approving");
      try {
        const res = await fetch("/api/private-drops", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        token = data.token as string;
      } catch {
        setErrMsg("Couldn't save your private spot. Check your connection and try again. Nothing was spent.");
        setStatus("error");
        return;
      }
      onChainLat = 0;
      onChainLng = 0;
    }

    const baseHint = eventId
      ? buildEventHint(hint, eventId)
      : campaignId
      ? buildCampaignHint(hint, campaignId)
      : isPrivate
        ? (targetAddress.trim() ? buildPrivateHint(hint, targetAddress.trim()) : buildPrivateHintNoTarget(hint))
        : hint;
    // [R] goes outermost so the riddle lock is visible on-chain regardless of
    // whatever private/campaign encoding sits underneath it.
    const storedHint = riddleOn ? buildRiddleHint(baseHint) : baseHint;

    // Riddle: STORE it server-side FIRST, signed BEFORE any drop exists. A
    // rejected prompt then costs nothing, instead of stranding an on-chain [R]
    // drop with no riddle. The dropId isn't known yet — bound after createDrop.
    let riddleToken: string | null = null;
    if (riddleOn) {
      riddleToken = newRiddleToken();
      setStatus("riddle");
      try {
        const sig = await signMessageAsync({ message: riddleTokenMessage(riddleToken) });
        const res = await fetch("/api/riddles", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: riddleToken, question: riddleQuestion.trim(),
            answer: riddleAnswer, signature: sig,
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErrMsg(typeof b.error === "string" && b.error.length < 120 && !/signature|0x/i.test(b.error)
            ? b.error : "Couldn't save the riddle. Try again. Nothing was spent.");
          setStatus("error");
          return;
        }
      } catch (e: unknown) {
        const fe = friendlyClaimError(e);
        if (fe.kind === "rejected") { setStatus("idle"); setErrMsg(""); return; } // nothing was created
        setErrMsg("Couldn't set up the riddle. Try again. Nothing was spent.");
        setStatus("error");
        return;
      }
    }

    setErrMsg("");
    setStatus("approving"); // busy from the first tap, before any network wait
    try {
      const allowance = await publicClient.readContract({
        address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "allowance",
        args: [address as `0x${string}`, GOOD_DROPS_ADDRESS],
      });
      if (allowance < amountBig) {
        setStatus("approving");
        const approveTx = await writeContractAsync({
          address: G_TOKEN_ADDRESS, abi: ERC20_ABI, functionName: "approve",
          args: [GOOD_DROPS_ADDRESS, maxUint256],
        });
        await confirmTx(approveTx);
      }
      setStatus("dropping");
      const dropTx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "createDrop",
        args: [degToGps(onChainLat), degToGps(onChainLng), amountBig as bigint, expiry, storedHint],
      });
      sent.current = { hash: dropTx, kind: "single", token, riddleToken: riddleOn ? riddleToken : null };
    } catch (e: unknown) {
      const fe = friendlyClaimError(e);
      if (fe.kind === "rejected") { setStatus("idle"); setErrMsg(""); return; }
      setErrMsg(dropErrorMessage(e));
      setStatus("error");
      return;
    }
    await finishSent();
  // finishSent is declared below; it only reads refs and stable setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guard, multiActive, handleMultiDrop, pending, amountNum, amountWei, hint, hintMaxLen,
      maxDrop, minDrop, balance, dropExpiry, lat, lng, isPrivate, campaignId, eventId,
      targetAddress, targetInvalid, riddleOn, riddleQuestion, riddleAnswer, address,
      signMessageAsync, writeContractAsync, bindRiddle]);

  // Wait for a sent drop to land, then do what follows it (private link,
  // riddle). Every ending gets a clear screen; nothing here ever re-sends.
  async function finishSent() {
    const s0 = sent.current;
    if (!s0) return;
    setErrMsg("");
    setStatus(s0.kind === "multi" ? "multi" : "dropping");
    let receipt;
    try {
      receipt = await confirmTx(s0.hash);
    } catch (e) {
      if (e instanceof StillPendingError) {
        setErrMsg("Your drop is still being hidden. Give it a moment, then tap Try again to check on it.");
      } else {
        sent.current = null; // it did nothing, so a fresh try is safe
        setErrMsg("That drop didn't go through, and none of your G$ was spent. Please try again.");
        if (s0.kind === "multi") setMultiProgress(null);
      }
      setStatus("error");
      return;
    }
    sent.current = null;

    if (s0.kind === "multi") {
      setMultiProgress((m) => (m ? { ...m, done: m.total } : m));
      window.dispatchEvent(new CustomEvent("gd:drop-created"));
      track("drop_created", { kind: "multi", count: qty });
      setStatus("done");
      return;
    }

    let newDropId: bigint | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: GOOD_DROPS_ABI, data: log.data, topics: log.topics, eventName: "DropCreated",
        });
        if (decoded.args.dropId !== undefined) { newDropId = decoded.args.dropId as bigint; break; }
      } catch { /* not this log */ }
    }

    if (s0.token && newDropId !== null) {
      // The share link only works once the server knows this drop's id, so
      // don't let one flaky request break it.
      const body = JSON.stringify({ token: s0.token, dropId: newDropId.toString() });
      for (let i = 0; i < 4; i++) {
        const ok = await fetch("/api/private-drops", { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
          .then((r) => r.ok).catch(() => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
      setPrivateToken(s0.token);
      // Persist locally so the share link survives closing the drawer.
      try { localStorage.setItem(`gd:privdrop:${newDropId}`, s0.token); } catch { /* private mode */ }
    }

    setCreatedDropId(newDropId);

    if (s0.riddleToken && newDropId !== null) {
      const p: PendingRiddle = { dropId: newDropId.toString(), token: s0.riddleToken };
      savePending(p);
      setPending(p);
      const ok = await bindRiddle(p);
      if (!ok) return; // bindRiddle parked it in "riddleFailed" (resume UI)
    }

    window.dispatchEvent(new CustomEvent("gd:drop-created"));
    track("drop_created", { kind: "single" });
    setStatus("done");
  }

  // One drop at a time. A ref, not state, so a fast double tap can't slip a
  // second run in before React re-renders the button as busy: the first awaits
  // (private-spot save, allowance read) run while status is still "idle".
  const handleDrop = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await runDrop(); } finally { inFlight.current = false; }
  }, [runDrop]);

  // ── Share ───────────────────────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    // Prefer a named landmark — locals recognise "near Colab Campus" far better
    // than a raw geocode.
    const nearest = nearbyLandmarks[0];
    const loc = nearest ? `near ${nearest.name}` : placeName ? `near ${placeName}` : "at a secret spot";
    const text = multiProgress
      ? `I just scattered ${multiProgress.done || qty} G$ drops ${nearest || placeName ? loc : "at one spot"}.\n\nFirst come, first served — hunt them down on GoodDrops!\n\n${X_HANDLES}\n${X_HASHTAGS}`
      : `I just hid ${amount} G$ ${loc}.\n\nCan you find it? Hunt it down on GoodDrops.\n\n${X_HANDLES}\n${X_HASHTAGS}`;
    // The link carries the dropper's referral code → every drop tweet recruits.
    const url = address ? inviteUrl(SITE_URL, address) : SITE_URL;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank", "noopener,noreferrer",
    );
  }, [nearbyLandmarks, placeName, multiProgress, qty, amount, address]);

  /** Finish a riddle drop stranded by an earlier failure. */
  const resumePending = useCallback(async () => {
    if (!pending) return;
    const ok = await bindRiddle(pending);
    if (ok) setStatus("done");
  }, [pending, bindRiddle]);

  /** Abandon a stranded riddle. The drop stays on-chain but can never be claimed. */
  const discardPending = useCallback(() => {
    clearPending(); setPending(null); setResuming(false); setStatus("idle"); setErrMsg("");
  }, []);

  const shareUrl = createdDropId !== null
    ? `${typeof window !== "undefined" ? window.location.origin : SITE_URL}/drop/${createdDropId}${privateToken ? `?k=${privateToken}` : ""}`
    : null;

  return {
    // identity / wallet
    address, isConnected, balance, balanceFetching, hasUsername,
    isVerified, isLapsed, identityLoading, identityCheckFailed,
    // limits
    maxDrop, minDrop, maxG, minG,
    // location
    lat, lng, placeName, pickerOpen, setPickerOpen, handleLocationConfirm,
    nearbyLandmarks, nearbyDemand, landmarks,
    // form
    amount, setAmount, quantity, setQuantity, duration, setDuration, placedForS,
    eventExpiresAt: eventEndsAt ? eventEndsAt + EVENT_GRACE_S : null,
    hint, setHint, isPrivate, setIsPrivate, targetAddress, setTargetAddress, targetInvalid,
    hasRiddle, setHasRiddle, riddleQuestion, setRiddleQuestion,
    riddleAnswer, setRiddleAnswer,
    // derived
    amountWei, qty, totalWei, multiActive, multiProgress,
    insufficientBalance, overMax, underMin, hintMaxLen,
    riddleReady, riddleOn, answerLeaked, busy, canDrop, btnLabel,
    // status
    status, errMsg, createdDropId, privateToken, shareUrl, pending, resuming,
    // actions
    handleDrop, handleShare, handleClose, reset, resumePending, discardPending,
  };
}
