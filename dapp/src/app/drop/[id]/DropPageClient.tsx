"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useAccount, useWriteContract } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { useEventSummary, eventStartLabel } from "@/hooks/useEventSummary";
import {
  Navigation, Copy, Share2, Check, ArrowLeft, Search, Lock, Link2, Trophy, Zap, Clock,
  Hourglass, Puzzle, Crosshair, IdCard, RefreshCw, Loader2, Coins, MapPinOff, Handshake,
  Mail, MapPin, PartyPopper, CalendarDays,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchDropByDropId } from "@/lib/subgraph";
import { publicClient } from "@/lib/publicClient";
import { friendlyClaimError } from "@/lib/claimErrors";
import { ensureGasForClaim } from "@/lib/ensureGas";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import {
  formatG$, gpsToDeg, getDropRarity, RARITY,
  haversineDistance, timeLeft, isFlashDrop,
  parseDropHint, openGoogleMapsWalking, shortAddr, formatUsdApprox,
} from "@/lib/utils";
import { SafetyNote } from "@/components/SafetyNote";
import { useVerification } from "@/hooks/useVerification";
import { useCountUp } from "@/hooks/useCountUp";
import { useRiddle } from "@/hooks/useRiddle";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { VerificationModal } from "@/components/VerificationModal";
import { HuntingMode } from "@/components/HuntingMode";
import { Celebration } from "@/components/Celebration";
import { ShareableClaimCard } from "@/components/ShareableClaimCard";
import { UserHandle } from "@/components/UserHandle";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Nav } from "@/components/Nav";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { checkBadgesAfterClaim } from "@/components/BadgeCelebration";
import { fireChestReward } from "@/components/ChestReward";
import { DROP_STATUS, type Drop, type Campaign } from "@/types";
import { track, claimFailReason } from "@/lib/analytics";
import { shareOrCopy } from "@/lib/share";

// ── Fetch campaign for sponsored drops ────────────────────────────────────────
function useCampaign(campaignId: string | null) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  useEffect(() => {
    if (!campaignId) { setCampaign(null); return; }
    fetch(`/api/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((d) => { if (d.campaign) setCampaign(d.campaign); })
      .catch(() => {});
  }, [campaignId]);
  return campaign;
}

// "gone" = a claim that can't be retried (someone else solved/claimed it).
type ClaimStatus = "idle" | "gassing" | "claiming" | "done" | "error" | "gone";

// ── Shared class recipes ──────────────────────────────────────────────────────
const CARD = "bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6";
const PRIMARY =
  "w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 " +
  "cursor-pointer motion-safe:transition-colors hover:bg-brand/90 focus-visible:ring-2 ring-brand/40 outline-none " +
  "disabled:bg-[#A4A4A4] disabled:cursor-not-allowed disabled:hover:bg-[#A4A4A4]";
const SECONDARY =
  "h-12 px-5 rounded-full border border-line bg-white text-sm/none text-heading flex items-center justify-center gap-2 " +
  "cursor-pointer motion-safe:transition-colors hover:bg-surface focus-visible:ring-2 ring-brand/40 outline-none";
const DARK =
  "h-12 px-5 rounded-full bg-nav-active text-white text-sm/none flex items-center justify-center gap-2 " +
  "cursor-pointer motion-safe:transition-opacity hover:opacity-90 focus-visible:ring-2 ring-brand/40 outline-none";
const PILL_LINK =
  "inline-flex items-center gap-2 h-12 px-6 rounded-full bg-brand text-white text-sm/none " +
  "motion-safe:transition-colors hover:bg-brand/90 focus-visible:ring-2 ring-brand/40 outline-none";

export default function DropPageClient({ dropId }: { dropId: string }) {
  const [drop,       setDrop]       = useState<Drop | null | undefined>(undefined);
  const [userLoc,    setUserLoc]    = useState<{ lat: number; lng: number } | null>(null);
  const [status,     setStatus]     = useState<ClaimStatus>("idle");
  const [errMsg,     setErrMsg]     = useState("");
  // An event drop before its event starts: a calm "not yet", not an error.
  const [eventLocked, setEventLocked] = useState(false);
  const [copied,     setCopied]     = useState(false);
  const [isHunting,  setIsHunting]  = useState(false);
  // Real coords for private drops — fetched via token from URL query param
  const [privateCoords, setPrivateCoords] = useState<{ lat: number; lng: number } | null>(null);
  const privateFetched = useRef(false);
  const privateToken = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("k") ?? undefined)
    : undefined;

  const { login, authenticated } = useAuth();
  const { address }              = useAccount();
  const isConnected              = authenticated && !!address;
  // Same three-state identity check as ClaimSheet. A bare getWhitelistedRoot()
  // can't tell "never verified" from "verified but lapsed", and this is the page
  // behind every QR code and share link — the first thing a migrating user sees.
  const {
    status: identity, isVerified, isLapsed, isBlacklisted, expiringSoon,
    isLoading: identityLoading, checkFailed: identityCheckFailed,
    refresh: refreshIdentity,
  } = useIdentityStatus();
  const verificationOk           = isVerified;
  const { writeContractAsync }   = useWriteContract();

  // Animated count-up for the claimed amount on the success screen.
  const successAmount    = drop ? Number(drop.amount) / 1e18 : 0;
  const successCount     = useCountUp(successAmount, status === "done");
  const successCountText = successAmount >= 1 ? Math.round(successCount).toLocaleString() : successCount.toFixed(2);
  const {
    status: verifyStatus, fvLink, isVerifying,
    setIsVerifying, refresh: refreshVerify,
  } = useVerification();

  // Parse hint + fetch campaign BEFORE early returns so hooks are always called
  // in the same order (React rules of hooks).
  const parsedHint = drop ? parseDropHint(drop.hint) : null;
  const eventInfo = useEventSummary(parsedHint?.eventId);
  const campaign   = useCampaign(parsedHint?.campaignId ?? null);

  // This page is the share-link / QR destination, so it has its own claim path
  // and must gate on the riddle exactly like the map's ClaimSheet does.
  const [answer, setAnswer] = useState("");
  const { riddle, loading: riddleLoading } = useRiddle(
    dropId,
    parsedHint?.hasRiddle ?? false,
    address,
  );

  // Shared Shell props for verification modal
  const shellVerifyProps = {
    isVerifying,
    setIsVerifying,
    fvLink,
    verifyStatus,
    onVerifyRefresh: refreshVerify,
  } as const;

  // ── Fetch drop ─────────────────────────────────────────────────────────────
  // Tries subgraph first; falls back to direct contract read so freshly-created
  // private drops (not yet indexed) are visible immediately after creation.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const fromGraph = await fetchDropByDropId(dropId);
      if (fromGraph) { if (!cancelled) setDrop(fromGraph); return; }
      try {
        const id = BigInt(dropId);
        const r  = await publicClient.readContract({
          address: GOOD_DROPS_ADDRESS,
          abi:     GOOD_DROPS_ABI,
          functionName: "getDrop",
          args: [id],
        });
        // Unknown ids come back as an all-zero struct, not a revert.
        if (/^0x0{40}$/i.test(r.dropper)) { if (!cancelled) setDrop(null); return; }
        if (!cancelled) setDrop({
          id,
          dropper:   r.dropper,
          amount:    BigInt(r.amount),
          claimer:   r.claimer,
          expiry:    Number(r.expiry),
          claimedAt: Number(r.claimedAt),
          createdAt: 0,
          status:    Number(r.status),
          lat:       Number(r.lat),
          lng:       Number(r.lng),
          hint:      r.hint,
        });
      } catch { if (!cancelled) setDrop(null); }
    }
    load();
    return () => { cancelled = true; };
  }, [dropId]);

  // ── Private drop: fetch real coords using token from URL ──────────────────
  useEffect(() => {
    if (!drop || privateFetched.current) return;
    const parsed = parseDropHint(drop.hint);
    if (!parsed.isPrivate) return;
    const token = new URLSearchParams(window.location.search).get("k");
    if (!token) return;
    privateFetched.current = true;
    fetch(`/api/private-drops?token=${encodeURIComponent(token)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.lat !== undefined) setPrivateCoords({ lat: d.lat, lng: d.lng }); })
      .catch(() => {});
  }, [drop]);

  // ── GPS watcher ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    const wid = navigator.geolocation.watchPosition(
      (p) => setUserLoc({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 }
    );
    return () => navigator.geolocation.clearWatch(wid);
  }, []);

  // ── Claim ──────────────────────────────────────────────────────────────────
  const handleClaim = useCallback(async () => {
    if (!drop || !address) return;
    track("claim_started", { surface: "page" });
    setStatus("claiming");
    setErrMsg("");
    setEventLocked(false);
    try {
      await ensureGasForClaim(address as `0x${string}`, () => setStatus("gassing"));
      setStatus("claiming");

      const needsAnswer = parseDropHint(drop.hint).hasRiddle && !riddle?.lockedByMe;
      const proofRes = await fetch("/api/claim-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropId:  drop.id.toString(),
          claimer: address,
          userLat: userLoc?.lat,
          userLng: userLoc?.lng,
          ...(privateToken ? { privateToken } : {}),
          ...(needsAnswer ? { answer } : {}),
        }),
      });

      if (!proofRes.ok) {
        const body = await proofRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not verify location — try again.");
      }

      const { deadline, sig } = await proofRes.json();
      const tx = await writeContractAsync({
        address:      GOOD_DROPS_ADDRESS,
        abi:          GOOD_DROPS_ABI,
        functionName: "claimWithProof",
        args:         [drop.id, BigInt(deadline), sig as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("done");
      track("claim_succeeded", { rarity: getDropRarity(drop.amount), surface: "page" });
      checkBadgesAfterClaim(address); // fire-and-forget badge award + celebration
      fireChestReward(formatG$(drop.amount), getDropRarity(drop.amount));
      // Track hunting streak (fire-and-forget)
      if (address) {
        fetch("/api/engagement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        })
          .then(() => window.dispatchEvent(new CustomEvent("gd:streak-updated")))
          .catch(() => {});
      }
    } catch (e: unknown) {
      track("claim_failed", { reason: claimFailReason(e), surface: "page" });
      const fe = friendlyClaimError(e);
      if (fe.kind === "rejected") { setStatus("idle"); setErrMsg(""); return; }
      setEventLocked(fe.kind === "event");
      let gone = fe.terminal;
      let msg  = fe.message;
      if (!gone && drop) {
        try {
          const oc = await publicClient.readContract({
            address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [drop.id],
          }) as { status: number; expiry: number };
          const nowS = Math.floor(Date.now() / 1000);
          if (oc.status === DROP_STATUS.Claimed)        { gone = true; msg = "Someone beat you to it — this drop has already been claimed."; }
          else if (oc.status === DROP_STATUS.Reclaimed) { gone = true; msg = "The dropper took this one back — it's no longer available."; }
          else if (Number(oc.expiry) <= nowS)           { gone = true; msg = "This drop has expired and can no longer be claimed."; }
        } catch { /* fall back to mapped message */ }
      }
      setErrMsg(msg);
      setStatus(gone ? "gone" : "error");
    }
    // userLoc and privateToken were missing here: GPS resolves asynchronously, so
    // a callback frozen before the first fix would post userLat: undefined and the
    // claim would fail with "Invalid request" for no visible reason.
  }, [drop, address, writeContractAsync, userLoc, privateToken, answer, riddle?.lockedByMe]);

  // ── Share helpers ──────────────────────────────────────────────────────────
  const pageUrl = typeof window !== "undefined"
    ? window.location.href
    : `https://gooddrops.xyz/drop/${dropId}`;

  function copyLink() {
    navigator.clipboard?.writeText(pageUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Loading / not found ────────────────────────────────────────────────────
  if (drop === undefined) return (
    <Shell {...shellVerifyProps} dropId={dropId}>
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 lg:gap-12 items-start">
        <div className={CARD}>
          <div className="flex gap-2 mb-6">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
          <Skeleton className="h-14 w-48 mb-3" />
          <Skeleton className="h-4 w-32 mb-8" />
          <Skeleton className="h-16 w-full rounded-2xl mb-6" />
          <Skeleton className="h-8 w-40" />
        </div>
        <div className={CARD}>
          <Skeleton className="h-4 w-full mb-3" />
          <Skeleton className="h-2 w-full mb-8" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    </Shell>
  );

  if (!drop) return (
    <Shell {...shellVerifyProps} dropId={dropId}>
      <div className={`${CARD} mx-auto w-full max-w-[440px] flex flex-col items-center text-center gap-y-4`}>
        <span className="w-14 h-14 rounded-full bg-surface flex items-center justify-center text-heading">
          <MapPinOff className="w-6 h-6" strokeWidth={1.75} />
        </span>
        <p className="text-xl/none text-heading">Drop not found</p>
        <p className="text-sm/[140%] text-nav-muted">
          This link may be invalid or the drop was removed.
        </p>
        <Link href="/" className={`${PILL_LINK} mt-2`}>
          <ArrowLeft className="w-4 h-4" /> Back to map
        </Link>
      </div>
    </Shell>
  );

  // ── Derived state ──────────────────────────────────────────────────────────
  // parsedHint and campaign are computed above (before early returns) to satisfy hooks rules.
  const { isPrivate, target, hint, chainNextId, isChainLast } = parsedHint!;
  const isChain = chainNextId !== null || isChainLast;
  // Private drops store (0,0) on-chain; real coords come from the server via token.
  const dropLat = isPrivate && privateCoords ? privateCoords.lat : gpsToDeg(drop.lat);
  const dropLng = isPrivate && privateCoords ? privateCoords.lng : gpsToDeg(drop.lng);
  const now       = Math.floor(Date.now() / 1000);
  const isExpired = drop.expiry < now;
  const isActive  = drop.status === DROP_STATUS.Active && !isExpired;
  const isClaimed = drop.status === DROP_STATUS.Claimed;
  const isSelf    = !!address && address.toLowerCase() === drop.dropper.toLowerCase();
  const isForMe   = !target || (!!address && address.toLowerCase() === target.toLowerCase());

  const distance     = userLoc ? haversineDistance(userLoc.lat, userLoc.lng, dropLat, dropLng) : null;
  const isClose      = distance !== null && distance <= CLAIM_RADIUS_M;
  const proximityPct = distance !== null ? Math.max(0, Math.min(100, (1 - distance / 500) * 100)) : 0;

  // Riddle gating — mirrors ClaimSheet exactly. If we already hold the lock the
  // riddle is behind us, so a retry mustn't demand the answer again.
  const hasRiddle     = parsedHint?.hasRiddle ?? false;
  const needsAnswer   = hasRiddle && !riddle?.lockedByMe;
  const answerFilled  = !needsAnswer || answer.trim().length > 0;
  const riddleBlocked = !!riddle?.lockedByOther;
  // Someone else has it (won the riddle window, or already claimed) — retrying
  // can't help, so the button sends them back to the map.
  const terminal = status === "gone" || riddleBlocked || isClaimed;

  const canClaim =
    isConnected && verificationOk && isActive && !isSelf && isClose &&
    answerFilled && !riddleBlocked && status === "idle";

  // "Active" button: can claim, retry an error, re-run a failed verification read,
  // or navigate back to the map when the drop is gone.
  const btnActive = canClaim || status === "error" || identityCheckFailed || terminal;

  const rarity = getDropRarity(drop.amount);
  const r      = RARITY[rarity];
  const flash  = isFlashDrop(drop);
  const busy   = status === "gassing" || status === "claiming";
  const usd    = formatUsdApprox(drop.amount);

  function claimLabel() {
    if (status === "gassing")  return "Topping up gas…";
    if (status === "claiming") return "Claiming…";
    if (terminal)              return "Back to the map";
    if (status === "error")    return "Try again";
    if (!isConnected)          return "Sign in to claim";
    // Don't show verify/re-verify until the on-chain check resolves — the slow
    // read was flashing a false "Verification required" for verified hunters.
    if (identityLoading)       return "Checking verification…";
    if (identityCheckFailed)   return "Couldn't check — tap to retry";
    if (isBlacklisted)         return "Not eligible to claim";
    if (isLapsed)              return "Re-verify to claim";
    if (!verificationOk)       return "Verification required";
    if (isSelf)                return "This is your own drop";
    if (!userLoc)              return "Enable GPS to claim";
    if (!isClose)              return `Get closer — ${Math.round(distance ?? 0)}m away`;
    if (!answerFilled)         return "Answer the riddle to claim";
    return `Claim ${formatG$(drop!.amount)} G$`;
  }

  // ── Pieces ─────────────────────────────────────────────────────────────────

  const banners = (
    <>
      {/* Sponsor banner — keeps the campaign's own colour as the tint. */}
      {campaign && (
        <div
          className="rounded-2xl p-4 flex items-center gap-3 min-w-0"
          style={{ background: campaign.color, color: "#121607" }}
        >
          {campaign.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={campaign.logo} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 bg-white" />
          ) : (
            <span className="w-10 h-10 rounded-full bg-white/70 flex items-center justify-center text-base/none text-heading shrink-0">
              {campaign.name.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm/none text-heading truncate">Sponsored by {campaign.name}</p>
            {campaign.description && (
              <p className="text-xs/[140%] text-heading/70 mt-1.5 line-clamp-2">{campaign.description}</p>
            )}
          </div>
          {campaign.goodcollectivePool && (
            <a
              href={`https://goodcollective.xyz/pool/${campaign.goodcollectivePool}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 h-9 px-3.5 rounded-full bg-nav-active text-white text-xs/none flex items-center gap-1.5
                motion-safe:transition-opacity hover:opacity-90"
            >
              <Handshake className="w-3.5 h-3.5" /> Pool
            </a>
          )}
        </div>
      )}

      {/* Private banner */}
      {isPrivate && !campaign && (
        <div className="rounded-2xl bg-brand-soft p-4 flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-brand shrink-0">
            <Mail className="w-5 h-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 pt-2">
            <p className="text-sm/[140%] text-heading">
              {target
                ? isForMe
                  ? "This drop was hidden just for you"
                  : (<>Meant for <UserHandle address={target} /></>)
                : "Private drop — invitation only"}
            </p>
            {target && !isForMe && isConnected && (
              <p className="text-xs/[140%] text-nav-muted mt-1">
                You can still attempt to claim it from the contract.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Chain banner */}
      {isChain && (
        <div className="rounded-2xl bg-nav-active text-white p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            {isChainLast ? <Trophy className="w-5 h-5" strokeWidth={1.75} /> : <Link2 className="w-5 h-5" strokeWidth={1.75} />}
          </span>
          <p className="text-sm/[140%]">
            {isChainLast ? "Final stop — claim to complete the hunt." : "Hunt Chain drop — claim to reveal the next stop."}
          </p>
        </div>
      )}
    </>
  );

  const hero = (
    <section className={CARD}>
      {/* Tags */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Tag>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
          {r.label}
        </Tag>
        {flash && <Tag tone="streak"><Zap className="w-3.5 h-3.5" /> Flash</Tag>}
        {isChain && (
          <Tag tone="dark">
            {isChainLast ? <Trophy className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
            {isChainLast ? "Final" : "Chain"}
          </Tag>
        )}
        {parsedHint?.eventId && (
          <Link href={`/events/${parsedHint.eventId}`} className="max-w-full">
            <Tag tone="brand">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[220px]">{eventInfo ? `Part of ${eventInfo.title}` : "Event drop"}</span>
            </Tag>
          </Link>
        )}
        {isActive && <Tag><Clock className="w-3.5 h-3.5" /> {timeLeft(drop.expiry)}</Tag>}
        {isClaimed && <Tag><Check className="w-3.5 h-3.5" /> Claimed</Tag>}
        {isExpired && !isClaimed && <Tag tone="danger">Expired</Tag>}
      </div>

      {/* Amount */}
      <div className="flex items-baseline gap-x-2 flex-wrap">
        <span className="font-anta text-[56px]/none lg:text-[72px]/none text-heading tracking-tight">
          {formatG$(drop.amount)}
        </span>
        <span className="text-2xl/none text-nav-muted">G$</span>
      </div>
      <p className="text-sm/none text-nav-muted mt-3">
        {usd ? `${usd} USD · real, spendable G$` : "Real, spendable G$"}
      </p>

      <div className="border-t border-line -mx-6 my-6" />

      {/* Clue */}
      <div className="flex items-start gap-3">
        <span className="w-11.5 h-11.5 rounded-full bg-surface flex items-center justify-center text-heading shrink-0">
          <Search className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 pt-1">
          <p className="text-sm/none text-nav-muted">Clue</p>
          {hint ? (
            <p className="text-lg/[130%] text-heading mt-2 break-words">{hint}</p>
          ) : (
            <p className="text-base/[140%] text-nav-muted mt-2">No clue left — you&apos;re on your own.</p>
          )}
        </div>
      </div>

      {/* Hidden by */}
      <div className="mt-6 flex items-center gap-3 min-w-0">
        {isPrivate ? (
          <>
            <span className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-heading shrink-0">
              <Lock className="w-4 h-4" strokeWidth={2} />
            </span>
            <span className="text-sm/none text-nav-muted">Hidden by someone special</span>
          </>
        ) : (
          <>
            <ProfileAvatar address={drop.dropper} size={32} ringColor="transparent" className="shrink-0" />
            <span className="text-sm/none text-nav-muted truncate">
              Hidden by <UserHandle address={drop.dropper} className="text-heading" />
            </span>
          </>
        )}
      </div>
    </section>
  );

  const action = status === "done" ? (
    chainNextId ? (
      /* Chain middle stop — dark, sends to next drop */
      <section className="bg-nav-active text-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col items-center text-center">
        <span className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
          <Link2 className="w-7 h-7" strokeWidth={1.75} />
        </span>
        <p className="text-xl/none mt-5">Next stop unlocked</p>
        <p className="text-sm/[140%] text-white/70 mt-3">
          {formatG$(drop.amount)} G$ claimed. Keep going — the chain continues.
        </p>
        <a href={`/drop/${chainNextId}`} className={`${PRIMARY} mt-6`}>
          Go to next stop
        </a>
        <Link href="/" className="mt-4 text-sm/none text-white/70 hover:text-white motion-safe:transition-colors">
          Back to map
        </Link>
      </section>
    ) : (
      /* Regular or chain-last success */
      <>
        <Celebration active colors={isChainLast ? ["#2727E2", "#FF9825", "#E9E9FC"] : undefined} />
        <section className={`${CARD} flex flex-col items-center text-center`}>
          <span className="success-pop w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
            {isChainLast ? <Trophy className="w-7 h-7" strokeWidth={1.75} /> : <PartyPopper className="w-7 h-7" strokeWidth={1.75} />}
          </span>
          <p className="text-xl/none text-heading mt-5">
            {isChainLast ? "Hunt complete" : "You found it"}
          </p>
          <p className="mt-4 flex items-baseline gap-x-2">
            <span className="font-anta text-5xl/none text-heading tabular-nums">{successCountText}</span>
            <span className="text-xl/none text-nav-muted">G$</span>
          </p>
          <p className="text-sm/none text-nav-muted mt-3">is yours</p>

          {/* Shareable win card */}
          <div className="w-full mt-6">
            <ShareableClaimCard
              amount={drop.amount}
              rarity={getDropRarity(drop.amount)}
              place={hint || null}
              handle={address ? shortAddr(address) : "a hunter"}
              dropId={drop.id.toString()}
            />
          </div>

          <Link href="/" className={`${PRIMARY} mt-6`}>
            Hunt more drops
          </Link>

          {/* UBI prompt only for verified users — unverified users cannot claim UBI */}
          {isVerified && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("gd:openWallet"))}
              className="mt-3 w-full rounded-2xl bg-surface p-4 flex items-center gap-3 text-left cursor-pointer
                motion-safe:transition-colors hover:bg-nav-controls"
            >
              <span className="w-11.5 h-11.5 rounded-full bg-white flex items-center justify-center text-heading shrink-0">
                <Coins className="w-5 h-5" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm/none text-heading">Also claim your daily G$ UBI</span>
                <span className="block text-xs/none text-nav-muted mt-2">Opens your wallet</span>
              </span>
            </button>
          )}
        </section>
      </>
    )
  ) : isActive ? (
    <section className={CARD}>
      {/* Proximity meter */}
      <div className="flex items-center justify-between gap-3 text-sm/none">
        <span className="flex items-center gap-2 text-heading">
          <MapPin className="w-4 h-4" strokeWidth={2} /> Distance
        </span>
        <span className={isClose ? "text-brand" : "text-nav-muted"}>
          {!userLoc ? "Enable GPS"
            : distance === null ? "…"
            : isClose ? `${Math.round(distance)}m — in range`
            : `${Math.round(distance)}m away`}
        </span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-surface overflow-hidden" aria-hidden>
        <div
          className={`h-full rounded-full motion-safe:transition-[width] duration-500 ${isClose ? "bg-brand" : "bg-nav-controls"}`}
          style={{ width: `${proximityPct}%` }}
        />
      </div>
      <p className="text-xs/none text-nav-muted mt-2 text-right">Must be within {CLAIM_RADIUS_M}m</p>

      <div className="mt-6 flex flex-col gap-3">
        {/* Block non-target users for targeted private drops */}
        {isConnected && target && !isForMe ? (
          <div className="rounded-2xl bg-surface p-5 text-center">
            <p className="text-base/none text-heading">Not for you</p>
            <p className="text-sm/[140%] text-nav-muted mt-2">
              This drop was hidden for <UserHandle address={target} />
            </p>
          </div>
        ) : (
          <>
            {/* Hunt this drop — full-screen mode with compass + proximity ring */}
            {!isClose && (
              <button
                type="button"
                onClick={() => isConnected ? setIsHunting(true) : login()}
                className={`${DARK} w-full`}
              >
                <Crosshair className="w-4 h-4" strokeWidth={2} />
                {isConnected ? "Hunt this drop" : "Sign in to hunt"}
              </button>
            )}

            {/* Walk there — hidden when not signed in (leaks private coords) or already in range */}
            {isConnected && !isClose && (
              <button
                type="button"
                onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
                className={`${SECONDARY} w-full`}
              >
                <Navigation className="w-4 h-4" strokeWidth={2} />
                Walk there
              </button>
            )}

            {/* ── RIDDLE ── */}
            {hasRiddle && !isSelf && (
              <div className="rounded-2xl border border-line p-4">
                <p className="flex items-center gap-2 text-sm/none text-nav-muted">
                  <Puzzle className="w-4 h-4" strokeWidth={2} /> Riddle-locked
                </p>

                {riddleLoading && !riddle ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : riddle ? (
                  <>
                    <p className="text-base/[140%] text-heading mt-3">{riddle.question}</p>

                    {riddle.lockedByOther ? (
                      <div className="mt-4 rounded-2xl bg-[#FFF0F0] p-4">
                        <p className="text-sm/none text-danger">Someone solved it first</p>
                        <p className="text-xs/[140%] text-nav-muted mt-2">
                          They have a few minutes to claim. If they don&apos;t, it reopens — check back.
                        </p>
                      </div>
                    ) : riddle.lockedByMe ? (
                      <div className="mt-4 rounded-2xl bg-brand-soft p-4">
                        <p className="flex items-center gap-2 text-sm/none text-brand">
                          <Check className="w-4 h-4" strokeWidth={2} /> You solved it — it&apos;s yours to claim
                        </p>
                        <p className="text-xs/[140%] text-nav-muted mt-2">
                          Nobody else can take it for the next few minutes.
                        </p>
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={answer}
                          onChange={(e) => { setAnswer(e.target.value); if (status === "error") setStatus("idle"); }}
                          placeholder="Your answer"
                          maxLength={60}
                          autoComplete="off"
                          aria-label="Riddle answer"
                          className="mt-4 w-full h-14 rounded-full bg-surface px-5 text-base/none text-heading
                            placeholder:text-nav-muted border border-transparent outline-none
                            motion-safe:transition-colors focus:border-brand"
                        />
                        <p className="text-xs/[140%] text-nav-muted mt-3 px-1">
                          Spelling counts, but capitals and punctuation don&apos;t.
                          First correct answer gets 10 minutes of exclusive access.
                        </p>
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-sm/[140%] text-danger mt-3">
                    The dropper hasn&apos;t finished setting up this riddle yet — it can&apos;t be claimed until they do. Check back soon.
                  </p>
                )}
              </div>
            )}

            {eventLocked && errMsg ? (
              <div role="status" className="rounded-2xl bg-brand-soft p-4 flex items-center gap-3">
                <span className="w-10 h-10 shrink-0 rounded-full bg-white text-brand flex items-center justify-center">
                  <Lock className="w-4 h-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm/none text-heading">{eventInfo ? `Unlocks ${eventStartLabel(eventInfo.startsAt)}` : "Not unlocked yet"}</p>
                  <p className="text-sm/[140%] text-nav-muted mt-1.5">{errMsg}</p>
                </div>
                {parsedHint?.eventId && (
                  <Link href={`/events/${parsedHint.eventId}`} className="shrink-0 h-9 px-3.5 rounded-full bg-white text-sm/none text-brand flex items-center">Event</Link>
                )}
              </div>
            ) : status === "error" && errMsg ? (
              <div role="alert" className="rounded-2xl bg-[#FFF0F0] p-4 text-sm/[140%] text-danger">
                {errMsg}
              </div>
            ) : null}

            {/* Claim CTA */}
            {!isConnected ? (
              <button type="button" onClick={login} className={PRIMARY}>
                Sign in to claim
              </button>
            ) : (
              <button
                type="button"
                onClick={
                  terminal ? () => { window.location.href = "/"; }
                  : status === "error" ? () => { setStatus("idle"); setErrMsg(""); }
                  : identityCheckFailed ? () => refreshIdentity()
                  : handleClaim
                }
                disabled={status !== "error" && !btnActive}
                aria-busy={busy}
                className={PRIMARY}
              >
                {busy && <Loader2 className="w-5 h-5 animate-spin" />}
                {terminal && !busy && <ArrowLeft className="w-4 h-4" />}
                {claimLabel()}
              </button>
            )}

            <SafetyNote />
          </>
        )}

        {/* Verification — never tell someone who already did the face scan that
            they aren't verified. Lapsed and never-verified are different things.
            Hidden while the check loads so verified hunters don't see it flash. */}
        {isConnected && !isVerified && !isBlacklisted && !identityLoading && (
          <NudgeRow
            icon={isLapsed ? <RefreshCw className="w-5 h-5" strokeWidth={1.75} /> : <IdCard className="w-5 h-5" strokeWidth={1.75} />}
            tone={isLapsed ? "danger" : "neutral"}
            title={isLapsed ? "Re-verify to claim" : "Verify to claim"}
            body={isLapsed
              ? (identity.isProbation
                  ? "You're face-verified — GoodDollar just needs a re-check. New verifications only stay active for 3 days; re-verify once and it lasts 6 months."
                  : "Your GoodDollar verification has expired. Re-verify to start claiming again.")
              : "One-time GoodDollar face check confirms you're a real human. Takes a minute."}
            cta={isLapsed ? "Re-verify" : "Verify"}
            onClick={() => setIsVerifying(true)}
          />
        )}

        {/* Verified but running out — the 3-day rung gives almost no warning. */}
        {isConnected && isVerified && expiringSoon && (
          <NudgeRow
            icon={<Hourglass className="w-5 h-5" strokeWidth={1.75} />}
            tone="streak"
            title={identity.daysLeft === 0
              ? "Verification expires today"
              : `Verification expires in ${identity.daysLeft} day${identity.daysLeft === 1 ? "" : "s"}`}
            body={identity.isProbation
              ? "Re-verify once now to lock in 6 months of claiming."
              : "Re-verify to keep claiming without interruption."}
            cta="Re-verify"
            onClick={() => setIsVerifying(true)}
          />
        )}
      </div>
    </section>
  ) : (
    <section className={`${CARD} flex flex-col items-center text-center`}>
      <span className="w-16 h-16 rounded-full bg-surface flex items-center justify-center text-heading">
        {isClaimed ? <Check className="w-7 h-7" strokeWidth={1.75} /> : <Hourglass className="w-7 h-7" strokeWidth={1.75} />}
      </span>
      <p className="text-xl/none text-heading mt-5">
        {isClaimed ? "Already claimed" : "Drop has expired"}
      </p>
      <p className="text-sm/[140%] text-nav-muted mt-3">
        {isClaimed ? "Someone beat you to it." : "This drop is no longer active."}
      </p>
      <Link href="/" className={`${PILL_LINK} mt-6`}>
        Find live drops
      </Link>
    </section>
  );

  // Share — hidden for private drops (sharing defeats the purpose), except the
  // dropper's own invitation link.
  const share = isPrivate ? (
    isSelf ? (
      <section className={`${CARD} flex flex-col items-center text-center`}>
        <h2 className="text-xl/none text-heading">Private invitation link</h2>
        <p className="text-sm/[140%] text-nav-muted mt-3">
          Only share this with the person you hid the drop for.
        </p>
        <div className="mt-6 rounded-2xl border border-line p-3 bg-white">
          <QRCodeSVG value={pageUrl} size={150} level="M" />
        </div>
        <button type="button" onClick={copyLink} className={`${SECONDARY} mt-6`}>
          {copied ? <Check className="w-4 h-4 text-brand" strokeWidth={2} /> : <Copy className="w-4 h-4" strokeWidth={2} />}
          {copied ? "Copied" : "Copy invite link"}
        </button>
      </section>
    ) : null
  ) : (
    <section className={`${CARD} flex flex-col items-center text-center`}>
      <h2 className="text-xl/none text-heading">Share this drop</h2>
      <p className="text-sm/[140%] text-nav-muted mt-3">
        Scan the code or send the link — anyone nearby can hunt it.
      </p>
      <div className="mt-6 rounded-2xl border border-line p-3 bg-white">
        <QRCodeSVG value={pageUrl} size={150} level="M" />
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={copyLink} className={SECONDARY}>
          {copied ? <Check className="w-4 h-4 text-brand" strokeWidth={2} /> : <Copy className="w-4 h-4" strokeWidth={2} />}
          {copied ? "Copied" : "Copy link"}
        </button>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            type="button"
            onClick={async () => {
              if ((await shareOrCopy({ title: "GoodDrops — hidden G$", url: pageUrl })) === "copied") {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className={DARK}
          >
            <Share2 className="w-4 h-4" strokeWidth={2} />
            Share
          </button>
        )}
      </div>
    </section>
  );

  const hasBanner = !!campaign || (isPrivate && !campaign) || isChain;

  return (
    <Shell {...shellVerifyProps} dropId={dropId}>
      {isHunting && drop && isActive && (
        <HuntingMode
          drop={drop}
          userLocation={userLoc}
          dropCoords={isPrivate && privateCoords ? privateCoords : undefined}
          privateToken={privateToken}
          onClose={() => setIsHunting(false)}
          onSuccess={() => { setIsHunting(false); setStatus("done"); }}
        />
      )}

      {hasBanner && <div className="flex flex-col gap-3 mb-6">{banners}</div>}

      {/* Phone: hero, action, share. Desktop: hero + share stacked on the left,
          the action card alone on the right so the CTA is always in view. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 lg:gap-12 items-start">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">{hero}</div>
        <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-[calc(var(--spacing-nav)+24px)]">
          {action}
        </div>
        {share && <div className="min-w-0 lg:col-start-1 lg:row-start-2">{share}</div>}
      </div>
    </Shell>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────────

/** Status tag in the hero: outlined by default, tinted for flash/chain/expired. */
function Tag({
  children, tone = "neutral",
}: { children: React.ReactNode; tone?: "neutral" | "streak" | "dark" | "danger" | "brand" }) {
  const look = {
    neutral: "border border-line bg-white text-heading",
    brand:   "bg-brand-soft text-brand",
    streak:  "bg-streak-bg text-streak",
    dark:    "bg-nav-active text-white",
    danger:  "bg-[#FFF0F0] text-danger",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-xs/none ${look}`}>
      {children}
    </span>
  );
}

/** Icon-circle + two lines + pill action, for the verification nudges. */
function NudgeRow({
  icon, tone, title, body, cta, onClick,
}: {
  icon: React.ReactNode;
  tone: "neutral" | "danger" | "streak";
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  const bg = { neutral: "bg-surface", danger: "bg-[#FFF0F0]", streak: "bg-streak-bg" }[tone];
  const fg = { neutral: "text-heading", danger: "text-danger", streak: "text-streak" }[tone];
  return (
    <div className={`rounded-2xl ${bg} p-4 flex flex-col sm:flex-row sm:items-center gap-3`}>
      <span className={`w-11.5 h-11.5 rounded-full bg-white flex items-center justify-center shrink-0 ${fg}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm/none text-heading">{title}</p>
        <p className="text-xs/[140%] text-nav-muted mt-2">{body}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 h-10 px-4 rounded-full bg-nav-active text-white text-sm/none cursor-pointer
          motion-safe:transition-opacity hover:opacity-90 whitespace-nowrap"
      >
        {cta}
      </button>
    </div>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────────────

interface ShellProps {
  children:        React.ReactNode;
  dropId:          string;
  isVerifying:     boolean;
  setIsVerifying:  (v: boolean) => void;
  fvLink:          string | null;
  verifyStatus:    import("@/hooks/useVerification").VerificationStatus;
  onVerifyRefresh: () => void;
}

/**
 * Page chrome: the shared Nav (sign-in, wallet, verification banner) plus the
 * page header and the verification modal this page can open on its own.
 */
function Shell({ children, dropId, isVerifying, setIsVerifying, fvLink, verifyStatus, onVerifyRefresh }: ShellProps) {
  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <main className="px-4 lg:px-15 pt-10 pb-20">
          <div className="flex items-center justify-between gap-4 mb-6">
            <h1 className="text-[32px]/none lg:text-4xl/none text-heading truncate">
              Drop <span className="text-nav-muted">#{dropId}</span>
            </h1>
            <Link
              href="/"
              className="shrink-0 flex items-center gap-2 h-9 px-4 rounded-full border border-nav-muted/50 bg-white
                text-sm/none text-heading motion-safe:transition-colors hover:bg-surface whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
              Map
            </Link>
          </div>
          {children}
        </main>
      </div>
      <VerificationModal
        isOpen={isVerifying}
        onClose={() => setIsVerifying(false)}
        fvLink={fvLink}
        status={verifyStatus}
        onRefresh={onVerifyRefresh}
      />
    </div>
  );
}
