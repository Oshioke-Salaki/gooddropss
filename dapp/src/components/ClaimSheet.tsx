"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAccount, useWriteContract } from "wagmi";
import {
  ArrowLeft, Check, Clock, Coins, Compass, Flag, Flame, Gift, Hourglass, IdCard, Link2, Loader2,
  MapPin, Navigation, Puzzle, RefreshCw, Search, Star, Tag, Target, Trophy, Zap,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import {
  haversineDistance,
  formatG$,
  timeLeft,
  gpsToDeg,
  getDropRarity,
  RARITY,
  isFlashDrop,
  openGoogleMapsWalking,
  parseDropHint,
  shortAddr,
  formatUsdApprox,
} from "@/lib/utils";
import { friendlyClaimError } from "@/lib/claimErrors";
import { ensureGasForClaim } from "@/lib/ensureGas";
import { Sheet } from "@/components/ui/Sheet";
import { TaskUnlock } from "@/components/TaskUnlock";
import { DropComments } from "@/components/DropComments";
import { ReportDropSheet } from "@/components/ReportDropSheet";
import { fireChestReward } from "@/components/ChestReward";
import { UserHandle } from "@/components/UserHandle";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Celebration } from "@/components/Celebration";
import { ShareableClaimCard } from "@/components/ShareableClaimCard";
import { SafetyNote } from "@/components/SafetyNote";
import { DROP_STATUS, type Drop, type LatLng, type Campaign } from "@/types";
import { useCountUp } from "@/hooks/useCountUp";
import { useRiddle } from "@/hooks/useRiddle";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { useProfile } from "@/hooks/useProfile";

function useCampaign(campaignId: string | null) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [claims, setClaims]     = useState(0);
  useEffect(() => {
    if (!campaignId) { setCampaign(null); return; }
    fetch(`/api/campaigns/${campaignId}`)
      .then((r) => r.json())
      .then((d) => { if (d.campaign) { setCampaign(d.campaign); setClaims(d.claims ?? 0); } })
      .catch(() => {});
  }, [campaignId]);
  return { campaign, claims };
}

// "gone" = the claim failed for a reason retrying can't fix (someone else solved
// the riddle / already claimed it) — the button becomes "back to the map".
type Status = "idle" | "gassing" | "claiming" | "done" | "error" | "gone";

interface Props {
  drop: Drop | null;
  userLocation: LatLng | null;
  onClose: () => void;
  onSuccess: () => void;
  onHunt?: (drop: Drop) => void;
}

/** Small pill tag used in the header rows (rarity, flash, chain, riddle, time). */
function Chip({
  icon, children, tone = "neutral", pulse,
}: { icon?: React.ReactNode; children: React.ReactNode; tone?: "neutral" | "brand" | "streak" | "danger"; pulse?: boolean }) {
  const tones = {
    neutral: "bg-surface text-heading",
    brand:   "bg-brand-soft text-brand",
    streak:  "bg-streak-bg text-streak",
    danger:  "bg-[#FFF1F1] text-danger",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs/none whitespace-nowrap ${tones[tone]} ${pulse ? "pin-flash" : ""}`}>
      {icon}
      {children}
    </span>
  );
}

/** A quiet notice card: icon circle + title + body (+ optional action). */
function Notice({
  icon, title, body, action, tone = "neutral",
}: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode; tone?: "neutral" | "brand" | "streak" | "danger" }) {
  const bg = { neutral: "bg-surface", brand: "bg-brand-soft", streak: "bg-streak-bg", danger: "bg-[#FFF1F1]" }[tone];
  const iconTone = { neutral: "bg-white text-heading", brand: "bg-white text-brand", streak: "bg-white text-streak", danger: "bg-white text-danger" }[tone];
  return (
    <div className={`rounded-2xl p-4 flex items-center gap-3 ${bg}`}>
      <span className={`w-11.5 h-11.5 shrink-0 rounded-full flex items-center justify-center ${iconTone}`}>{icon}</span>
      <div className="min-w-0 flex-1 flex flex-col gap-y-1">
        <p className="text-base/none text-heading">{title}</p>
        <p className="text-sm/[140%] text-nav-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * The post-claim card. Exported so it can be previewed without a transaction.
 */
export function ClaimSuccessCard({
  drop, parsed, address, myUsername, needsName, countUpText, isVerified, onSuccess,
}: {
  drop: Drop;
  parsed: ReturnType<typeof parseDropHint>;
  address: string | undefined;
  myUsername: string | null;
  needsName: boolean;
  countUpText: string;
  isVerified: boolean;
  onSuccess: () => void;
}) {
  // Chain middle: the win is the next stop, not a share card.
  if (parsed.chainNextId) {
    return (
      <div className="rounded-3xl border border-line p-6 text-center flex flex-col items-center">
        <span className="success-pop w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
          <Link2 className="w-8 h-8" strokeWidth={1.75} />
        </span>
        <p className="mt-5 text-xl/none text-heading">Next stop unlocked</p>
        <p className="mt-3 text-sm/[140%] text-nav-muted">
          {formatG$(drop.amount)} G$ claimed. Keep going, the chain continues.
        </p>
        <a
          href={`/drop/${parsed.chainNextId}`}
          className="mt-6 w-full h-14 rounded-full bg-brand text-white text-base/none flex items-center justify-center
            motion-safe:transition-colors hover:bg-brand/90"
        >
          Go to next stop
        </a>
        <button
          type="button"
          onClick={onSuccess}
          className="mt-3 h-11 px-5 rounded-full text-sm/none text-nav-muted cursor-pointer
            motion-safe:transition-colors hover:bg-surface hover:text-heading"
        >
          Back to map
        </button>
      </div>
    );
  }

  const isChainWin = parsed.isChainLast;
  return (
    <>
      <Celebration active colors={isChainWin ? ["#FFD700", "#2727E2", "#FF9825", "#121607"] : undefined} />
      <div className="rounded-3xl border border-line p-6 text-center flex flex-col items-center">
        <span className="success-pop w-16 h-16 rounded-full bg-brand-soft text-brand flex items-center justify-center">
          {isChainWin ? <Trophy className="w-8 h-8" strokeWidth={1.75} /> : <Check className="w-8 h-8" strokeWidth={2} />}
        </span>
        <p className="mt-5 text-xl/none text-heading">{isChainWin ? "Hunt complete" : "You found it"}</p>
        <p className="mt-4 font-anta text-[44px]/none text-heading tabular-nums">
          {countUpText} <span className="text-2xl text-brand">G$</span>
        </p>
        <p className="mt-3 text-sm/[140%] text-nav-muted">
          {isChainWin ? "You conquered the entire chain." : "Transferred to your wallet."}
        </p>

        {/* Shareable win card + one-tap share */}
        <div className="mt-6 w-full">
          <ShareableClaimCard
            amount={drop.amount}
            rarity={getDropRarity(drop.amount)}
            place={parsed.hint || null}
            handle={myUsername ? `@${myUsername}` : address ? shortAddr(address) : "a hunter"}
            dropId={drop.id.toString()}
          />
        </div>

        {/* Post-win nudge — peak moment to claim a name, since the share card
            and leaderboard are about to show it. */}
        {needsName && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("gd:setName"))}
            className="mt-4 w-full rounded-2xl bg-brand-soft p-4 flex items-center gap-3 text-left cursor-pointer
              motion-safe:transition-opacity hover:opacity-90"
          >
            <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-white text-brand flex items-center justify-center">
              <Tag className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 flex flex-col gap-y-1">
              <span className="text-base/[130%] text-heading">Claim your hunter name</span>
              <span className="text-sm/[140%] text-nav-muted">
                You shared as {address ? shortAddr(address) : "a hunter"}. Set a name so people know it&apos;s you.
              </span>
            </span>
          </button>
        )}

        {/* UBI prompt — verified only */}
        {isVerified && (
          <button
            type="button"
            onClick={() => { onSuccess(); setTimeout(() => window.dispatchEvent(new CustomEvent("gd:openWallet")), 300); }}
            className="mt-3 w-full rounded-2xl bg-surface p-4 flex items-center gap-3 text-left cursor-pointer
              motion-safe:transition-colors hover:bg-nav-controls"
          >
            <span className="w-11.5 h-11.5 shrink-0 rounded-full bg-white text-heading flex items-center justify-center">
              <Coins className="w-5 h-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 flex flex-col gap-y-1">
              <span className="text-base/[130%] text-heading">Claim your daily G$ UBI</span>
              <span className="text-sm/[140%] text-nav-muted">Opens your wallet to claim today&apos;s GoodDollar.</span>
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onSuccess}
          className="mt-3 h-11 px-5 rounded-full text-sm/none text-nav-muted cursor-pointer
            motion-safe:transition-colors hover:bg-surface hover:text-heading"
        >
          Done, back to map
        </button>
      </div>
    </>
  );
}

export function ClaimSheet({ drop, userLocation, onClose, onSuccess, onHunt }: Props) {
  const { address } = useAccount();
  const profile     = useProfile(address);
  const myUsername  = profile?.username ?? null;
  const [reporting, setReporting] = useState(false);
  const [nearby, setNearby] = useState(0);
  // Nudge to set a name after a win — only once we've confirmed there isn't one.
  const needsName   = !!address && profile !== undefined && !profile?.username;
  const { authenticated } = useAuth();
  // Privy is authoritative — wagmi can report a stale connector/address after logout.
  const isConnected = authenticated && !!address;
  const { writeContractAsync } = useWriteContract();

  // Not useGoodDollarProfile().isVerified — that's a bare getWhitelistedRoot()
  // check, which can't tell "never verified" from "verified but lapsed".
  const {
    status: identity, isVerified, isLapsed, isBlacklisted, expiringSoon,
    isLoading: identityLoading, checkFailed: identityCheckFailed,
    refresh: refreshIdentity,
  } = useIdentityStatus();

  const verificationOk = isVerified;
  const [status, setStatus] = useState<Status>("idle");
  const [errMsg, setErrMsg] = useState("");

  // Animated count-up for the claimed amount on the success screen.
  const amountNum   = drop ? Number(drop.amount) / 1e18 : 0;
  const countUp     = useCountUp(amountNum, status === "done");
  const countUpText = amountNum >= 1 ? Math.round(countUp).toLocaleString() : countUp.toFixed(2);

  const parsed = drop ? parseDropHint(drop.hint) : null;
  const { campaign, claims } = useCampaign(parsed?.campaignId ?? null);

  const [answer, setAnswer] = useState("");
  const { riddle, loading: riddleLoading } = useRiddle(
    drop ? drop.id.toString() : null,
    parsed?.hasRiddle ?? false,
    address,
  );

  useEffect(() => {
    setStatus("idle");
    setErrMsg("");
    setAnswer("");
    setNearby(0);
  }, [drop?.id]);

  // Aggregate "hunters nearby" urgency — count only, never who or where.
  useEffect(() => {
    if (!drop || drop.status !== DROP_STATUS.Active) return;
    const lat = gpsToDeg(drop.lat), lng = gpsToDeg(drop.lng);
    if (lat === 0 && lng === 0) return; // private drop — coords hidden
    let alive = true;
    fetch(`/api/hunters-nearby?lat=${lat}&lng=${lng}${address ? `&exclude=${address.toLowerCase()}` : ""}`)
      .then((r) => r.json())
      .then((d) => { if (alive && typeof d.count === "number") setNearby(d.count); })
      .catch(() => {});
    return () => { alive = false; };
  }, [drop?.id, drop?.status, drop?.lat, drop?.lng, address]);

  const dropLat = drop ? gpsToDeg(drop.lat) : 0;
  const dropLng = drop ? gpsToDeg(drop.lng) : 0;

  const distance =
    drop && userLocation != null
      ? haversineDistance(userLocation.lat, userLocation.lng, dropLat, dropLng)
      : null;

  const isExpired  = drop ? drop.expiry < Math.floor(Date.now() / 1000) : false;
  const isActive   = drop ? drop.status === DROP_STATUS.Active && !isExpired : false;
  const isSelfDrop = drop ? address?.toLowerCase() === drop.dropper.toLowerCase() : false;
  const isClose    = distance !== null && distance <= CLAIM_RADIUS_M;

  // A riddle drop needs an answer typed in — unless we already won the lock, in
  // which case the riddle is behind us and a retry shouldn't demand it again.
  const needsAnswer  = !!parsed?.hasRiddle && !riddle?.lockedByMe;
  const answerFilled = !needsAnswer || answer.trim().length > 0;
  const riddleBlocked = !!riddle?.lockedByOther;
  // Someone else has this drop (won the riddle window, or already claimed it):
  // retrying can't help, so the button should send them back to the map.
  const alreadyClaimed = drop ? drop.status === DROP_STATUS.Claimed : false;
  const takenByOther   = riddleBlocked || alreadyClaimed;
  const terminal       = status === "gone" || takenByOther;

  const canClaim =
    isConnected && verificationOk && isActive && !isSelfDrop && isClose &&
    answerFilled && !riddleBlocked && status === "idle";

  // Merchant task drops: the hunter must do the task and be scanned/approved
  // before the claim will sign. When they're otherwise ready (verified, in range),
  // swap the claim button for the task-unlock panel until it's approved.
  const isTaskDrop = !!parsed?.taskMerchantId;
  const [taskUnlocked, setTaskUnlocked] = useState(false);
  useEffect(() => { setTaskUnlocked(false); }, [drop?.id]);
  const showTaskUnlock =
    isTaskDrop && !taskUnlocked &&
    isConnected && verificationOk && isActive && !isSelfDrop && isClose && !riddleBlocked && status === "idle";

  // The claim button is "active" (tappable, styled) when it can claim, when it's
  // offering a retry after an error, or when the verification read failed and the
  // tap should re-run that read.
  const btnActive = canClaim || status === "error" || identityCheckFailed || terminal;
  const busy = status === "claiming" || status === "gassing";

  const proximityPct =
    distance !== null ? Math.max(0, Math.min(100, (1 - distance / 500) * 100)) : 0;

  async function handleClaim() {
    if (!canClaim || !drop || !address) return;
    setStatus("claiming");
    setErrMsg("");
    try {
      // Ensure gas BEFORE requesting the proof, so a low wallet never fails the
      // claim mid-tx and the proof stays fresh while any top-up lands.
      await ensureGasForClaim(address as `0x${string}`, () => setStatus("gassing"));
      setStatus("claiming");

      const proofRes = await fetch("/api/claim-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dropId:  drop.id.toString(),
          claimer: address,
          userLat: userLocation?.lat,
          userLng: userLocation?.lng,
          ...(needsAnswer ? { answer } : {}),
        }),
      });

      if (!proofRes.ok) {
        const body = await proofRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not verify location — try again.");
      }

      const { deadline, sig } = await proofRes.json();
      const tx = await writeContractAsync({
        address: GOOD_DROPS_ADDRESS,
        abi: GOOD_DROPS_ABI,
        functionName: "claimWithProof",
        args: [drop.id, BigInt(deadline), sig as `0x${string}`],
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("done");
      if (drop) fireChestReward(formatG$(drop.amount), getDropRarity(drop.amount));
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
      const fe = friendlyClaimError(e);
      // User just dismissed the wallet prompt — no error UI, let them retry.
      if (fe.kind === "rejected") { setStatus("idle"); setErrMsg(""); return; }

      // Truth-check on-chain: many raw errors (RPC blips, gas) don't say whether
      // the drop is actually gone. Ask the contract so we show the RIGHT thing —
      // "already claimed" only when it really is.
      let gone = fe.terminal;
      let msg  = fe.message;
      if (!gone) {
        try {
          const oc = await publicClient.readContract({
            address: GOOD_DROPS_ADDRESS, abi: GOOD_DROPS_ABI, functionName: "getDrop", args: [drop.id],
          }) as { status: number; expiry: number };
          const nowS = Math.floor(Date.now() / 1000);
          if (oc.status === DROP_STATUS.Claimed)   { gone = true; msg = "Someone beat you to it — this drop has already been claimed."; }
          else if (oc.status === DROP_STATUS.Reclaimed) { gone = true; msg = "The dropper took this one back — it's no longer available."; }
          else if (Number(oc.expiry) <= nowS)      { gone = true; msg = "This drop has expired and can no longer be claimed."; }
        } catch { /* couldn't re-check — fall back to the mapped message */ }
      }

      setErrMsg(msg);
      setStatus(gone ? "gone" : "error");
    }
  }

  function claimLabel(): React.ReactNode {
    if (status === "gassing")  return <><Loader2 className="w-5 h-5 animate-spin" /> Topping up gas…</>;
    if (status === "claiming") return <><Loader2 className="w-5 h-5 animate-spin" /> Claiming…</>;
    if (terminal)              return <><ArrowLeft className="w-5 h-5" strokeWidth={2} /> Back to the map</>;
    if (status === "error")    return "Try again";
    if (!isConnected)          return "Sign in to claim";
    // Don't accuse a (possibly verified) user of needing to verify until the
    // on-chain check has actually resolved — otherwise the slow read shows a false
    // "Verification required" / "Re-verify" on the button for verified hunters.
    if (identityLoading)       return <><Loader2 className="w-5 h-5 animate-spin" /> Checking verification…</>;
    if (identityCheckFailed)   return "Couldn't check. Tap to retry";
    // Blacklisted by GoodDollar — verifying again won't help, so don't offer it.
    if (isBlacklisted)         return "Not eligible to claim";
    if (isLapsed)              return "Re-verify to claim";
    if (!verificationOk)       return "Verification required";
    if (isSelfDrop)            return "Can't claim your own drop";
    if (!userLocation)         return "Enable GPS to claim";
    if (!isClose)              return `${Math.round(distance ?? 0)}m away. Get closer`;
    if (!answerFilled)         return "Answer the riddle to claim";
    return `Claim ${formatG$(drop!.amount)} G$`;
  }

  const verifyButton = (label: string) => (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("gd:openVerify"))}
      className="shrink-0 h-10 px-4 rounded-full bg-nav-active text-white text-sm/none cursor-pointer
        motion-safe:transition-opacity hover:opacity-90 whitespace-nowrap"
    >
      {label}
    </button>
  );

  return (
    <>
      {drop && parsed && (() => {
        const rarity  = getDropRarity(drop.amount);
        const r       = RARITY[rarity];
        const flash   = isFlashDrop(drop);
        const isChain = parsed.chainNextId !== null || parsed.isChainLast;
        const usd     = formatUsdApprox(drop.amount);

        return (
          <Sheet
            title={flash ? "Flash drop" : `${r.label} drop`}
            onClose={onClose}
            width={440}
            dismissible={!busy}
          >
            <div className="pt-6 flex flex-col gap-4">
              {/* ── Tags ──────────────────────────────────────────────────── */}
              <div className="flex flex-wrap gap-2">
                <Chip
                  icon={<span className="w-2 h-2 rounded-full" style={{ background: r.color }} aria-hidden />}
                  pulse={flash}
                  tone={flash ? "streak" : "neutral"}
                >
                  {flash ? <><Zap className="w-3.5 h-3.5" strokeWidth={2} /> Flash</> : r.label}
                </Chip>
                {isChain && (
                  <Chip tone="brand" icon={<Link2 className="w-3.5 h-3.5" strokeWidth={2} />}>
                    {parsed.isChainLast ? "Final stop" : "Chain drop"}
                  </Chip>
                )}
                {campaign && (
                  <Chip icon={<Star className="w-3.5 h-3.5" strokeWidth={2} />}>{campaign.name}</Chip>
                )}
                {parsed.hasRiddle && (
                  <Chip tone="brand" icon={<Puzzle className="w-3.5 h-3.5" strokeWidth={2} />}>Riddle</Chip>
                )}
                {isTaskDrop && (
                  <Chip icon={<Gift className="w-3.5 h-3.5" strokeWidth={2} />}>Merchant reward</Chip>
                )}
              </div>

              {/* ── Amount, the star ───────────────────────────────────────── */}
              <div className="flex flex-col gap-y-2">
                <p className="font-anta text-[48px]/none text-heading">
                  {formatG$(drop.amount)} <span className="text-2xl text-brand">G$</span>
                </p>
                {usd && <p className="text-sm/none text-nav-muted">{usd} USD · real, spendable G$</p>}
              </div>

              {/* ── Meta row ───────────────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-line pl-1 pr-3 py-1 text-xs/none text-nav-muted min-w-0">
                  <ProfileAvatar address={drop.dropper} size={24} ringColor="transparent" />
                  <span className="truncate">by <UserHandle address={drop.dropper} className="text-heading" /></span>
                </span>
                {isActive ? (
                  <Chip tone={flash ? "streak" : "neutral"} icon={<Clock className="w-3.5 h-3.5" strokeWidth={2} />}>
                    {timeLeft(drop.expiry)}
                  </Chip>
                ) : (
                  <Chip tone={drop.status === DROP_STATUS.Claimed ? "brand" : "danger"}>
                    {drop.status === DROP_STATUS.Claimed ? "Claimed" : "Expired"}
                  </Chip>
                )}
                {isActive && nearby > 0 && (
                  <Chip tone="streak" icon={<Flame className="w-3.5 h-3.5" strokeWidth={2} />}>
                    {nearby === 1 ? "a hunter nearby" : `${nearby} hunters nearby`}
                  </Chip>
                )}
              </div>

              {/* ── Campaign ───────────────────────────────────────────────── */}
              {campaign && (
                <div className="rounded-2xl border border-line p-4 flex items-center gap-3">
                  <div
                    className="w-11.5 h-11.5 shrink-0 rounded-full overflow-hidden flex items-center justify-center text-base text-heading"
                    style={{ background: campaign.color }}
                  >
                    {campaign.logo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={campaign.logo} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      : campaign.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-y-1">
                    <p className="text-xs/none text-nav-muted">Sponsored drop</p>
                    <p className="text-base/none text-heading truncate">{campaign.name}</p>
                    {campaign.description && (
                      <p className="text-sm/[140%] text-nav-muted line-clamp-2">{campaign.description}</p>
                    )}
                    {campaign.goodcollectivePool && (
                      <a
                        href={`https://goodcollective.xyz/pool/${campaign.goodcollectivePool}`}
                        target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="self-start mt-1 inline-flex items-center gap-1 rounded-full bg-brand-soft text-brand px-3 py-1.5 text-xs/none"
                      >
                        GoodCollective pool
                      </a>
                    )}
                  </div>
                  {claims > 0 && (
                    <div className="shrink-0 text-center flex flex-col gap-y-1">
                      <p className="font-anta text-xl/none text-heading">{claims}</p>
                      <p className="text-xs/none text-nav-muted">claimed</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Clue ───────────────────────────────────────────────────── */}
              {parsed.hint && (
                <div className="rounded-2xl bg-surface p-4">
                  <p className="flex items-center gap-1.5 text-xs/none text-nav-muted">
                    <Search className="w-3.5 h-3.5" strokeWidth={2} /> Clue
                  </p>
                  <p className="mt-2.5 text-base/[150%] text-heading">{parsed.hint}</p>
                </div>
              )}

              {/* ── Success ────────────────────────────────────────────────── */}
              {status === "done" && (
                <ClaimSuccessCard
                  drop={drop}
                  parsed={parsed}
                  address={address}
                  myUsername={myUsername}
                  needsName={needsName}
                  countUpText={countUpText}
                  isVerified={isVerified}
                  onSuccess={onSuccess}
                />
              )}

              {/* ── Active state ───────────────────────────────────────────── */}
              {status !== "done" && isActive && (
                <>
                  {/* Proximity — hidden for own drops */}
                  {!isSelfDrop && isClose ? (
                    <Notice
                      tone="brand"
                      icon={<MapPin className="w-5 h-5" strokeWidth={1.75} />}
                      title="You're in range"
                      body={`${Math.round(distance!)}m away, close enough to claim.`}
                    />
                  ) : !isSelfDrop ? (
                    <div className="rounded-2xl border border-line p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm/none text-nav-muted">Distance</span>
                        <span className="font-anta text-2xl/none text-heading">
                          {distance !== null ? `${Math.round(distance)}m` : "—"}
                        </span>
                      </div>
                      <div className="mt-3 h-2 rounded-full bg-surface overflow-hidden">
                        <motion.div
                          animate={{ width: `${proximityPct}%` }}
                          transition={{ duration: 0.5 }}
                          className={`h-full rounded-full ${proximityPct > 65 ? "bg-brand" : "bg-nav-muted/40"}`}
                        />
                      </div>
                      <p className="mt-3 text-xs/none text-nav-muted text-center">
                        Must be within {CLAIM_RADIUS_M}m to claim
                      </p>
                    </div>
                  ) : null}

                  {/* Merchant-reward heads-up — set expectations before the
                      hunter arrives, so the on-arrival task isn't a surprise.
                      Once in range, the TaskUnlock panel takes over. */}
                  {isTaskDrop && !isSelfDrop && !isClose && !taskUnlocked && (
                    <Notice
                      icon={<Gift className="w-5 h-5" strokeWidth={1.75} />}
                      title="Merchant reward"
                      body="When you arrive, do a quick task and get the merchant to approve it. Then this unlocks."
                    />
                  )}

                  {/* Walk there / Hunt */}
                  {!isSelfDrop && !isClose && (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
                        className="w-full sm:flex-1 h-12 rounded-full border border-line bg-white text-base/none text-heading
                          flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface"
                      >
                        <Navigation className="w-[18px] h-[18px]" strokeWidth={2} />
                        Walk there
                      </button>
                      {onHunt && (
                        <button
                          type="button"
                          onClick={() => { onClose(); onHunt(drop); }}
                          className="w-full sm:flex-1 h-12 rounded-full bg-nav-active text-white text-base/none
                            flex items-center justify-center gap-2 cursor-pointer motion-safe:transition-opacity hover:opacity-90"
                        >
                          <Compass className="w-[18px] h-[18px]" strokeWidth={2} />
                          Hunt this drop
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── Riddle ── */}
                  {parsed.hasRiddle && !isSelfDrop && (
                    <div className="rounded-2xl border border-line p-4">
                      <p className="flex items-center gap-1.5 text-xs/none text-brand">
                        <Puzzle className="w-3.5 h-3.5" strokeWidth={2} /> Riddle-locked
                      </p>

                      {riddleLoading && !riddle ? (
                        <p className="mt-3 flex items-center gap-2 text-sm/none text-nav-muted">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading the riddle…
                        </p>
                      ) : riddle ? (
                        <>
                          <p className="mt-3 text-base/[150%] text-heading">{riddle.question}</p>

                          {riddle.lockedByOther ? (
                            <div className="mt-4 rounded-2xl bg-[#FFF1F1] px-4 py-3 flex flex-col gap-y-1">
                              <p className="text-sm/none text-danger">Someone solved it first</p>
                              <p className="text-xs/[140%] text-nav-muted">
                                They have a few minutes to claim. If they don&apos;t, it reopens. Check back.
                              </p>
                            </div>
                          ) : riddle.lockedByMe ? (
                            <div className="mt-4 rounded-2xl bg-brand-soft px-4 py-3 flex flex-col gap-y-1">
                              <p className="text-sm/none text-brand">You solved it. It&apos;s yours to claim</p>
                              <p className="text-xs/[140%] text-nav-muted">
                                Nobody else can take it for the next few minutes.
                              </p>
                            </div>
                          ) : (
                            <>
                              <label className="block mt-4">
                                <span className="sr-only">Your answer</span>
                                <input
                                  type="text"
                                  value={answer}
                                  onChange={(e) => { setAnswer(e.target.value); if (status === "error") setStatus("idle"); }}
                                  placeholder="Your answer…"
                                  maxLength={60}
                                  autoComplete="off"
                                  disabled={busy}
                                  className="w-full h-12 rounded-full bg-surface px-5 text-base/none text-heading placeholder:text-nav-muted
                                    border border-transparent outline-none motion-safe:transition-colors focus:border-brand disabled:opacity-60"
                                />
                              </label>
                              <p className="mt-3 text-xs/[150%] text-nav-muted">
                                Spelling counts, but capitals and punctuation don&apos;t.
                                First correct answer gets 10 minutes of exclusive access.
                              </p>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="mt-3 text-sm/[140%] text-danger">
                          The dropper hasn&apos;t finished setting up this riddle yet. It can&apos;t be claimed until they do. Check back soon.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Error */}
                  {(status === "error" || status === "gone") && errMsg && (
                    <p role="alert" className="rounded-2xl bg-[#FFF1F1] px-4 py-3 text-sm/[140%] text-danger">
                      {errMsg}
                    </p>
                  )}

                  {/* ── Claim button (task drops swap in the unlock panel) ── */}
                  {showTaskUnlock ? (
                    <TaskUnlock
                      drop={drop}
                      userLocation={userLocation}
                      address={address as string}
                      onApproved={() => setTaskUnlocked(true)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={
                        terminal ? onClose
                        : status === "error" ? () => setStatus("idle")
                        : identityCheckFailed ? () => refreshIdentity()
                        : handleClaim
                      }
                      disabled={busy || (status !== "error" && !btnActive)}
                      aria-live="polite"
                      className={`w-full h-14 rounded-full text-base/none flex items-center justify-center gap-2 cursor-pointer
                        motion-safe:transition-colors disabled:cursor-not-allowed
                        ${terminal
                          ? "bg-nav-active text-white hover:opacity-90"
                          : "bg-brand text-white hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:hover:bg-[#A4A4A4]"}`}
                      style={canClaim ? { boxShadow: "0 8px 24px rgba(39,39,226,0.3)" } : undefined}
                    >
                      {claimLabel()}
                    </button>
                  )}

                  <SafetyNote />

                  {/* Verification — three states, three messages. A user who
                      already did the face scan must never be told to "verify".
                      Hidden while the check is still loading so verified hunters
                      don't see a false verify card during the on-chain read. */}
                  {isConnected && !isVerified && !isBlacklisted && !identityLoading && (
                    <Notice
                      tone={isLapsed ? "danger" : "neutral"}
                      icon={isLapsed ? <RefreshCw className="w-5 h-5" strokeWidth={1.75} /> : <IdCard className="w-5 h-5" strokeWidth={1.75} />}
                      title={isLapsed ? "Re-verify to claim" : "Verify to claim"}
                      body={
                        isLapsed
                          ? (identity.isProbation
                              ? "You're face-verified. GoodDollar just needs a re-check: new verifications stay active for 3 days; re-verify once and it lasts 6 months."
                              : "Your GoodDollar verification has expired. Re-verify to start claiming again.")
                          : "One-time GoodDollar face check confirms you're a real human. Takes a minute."
                      }
                      action={verifyButton(isLapsed ? "Re-verify" : "Verify")}
                    />
                  )}

                  {/* Verified, but the clock is running out — on the 3-day rung
                      this is the last chance to keep the account alive. */}
                  {isConnected && isVerified && expiringSoon && (
                    <Notice
                      tone="streak"
                      icon={<Hourglass className="w-5 h-5" strokeWidth={1.75} />}
                      title={
                        identity.daysLeft === 0
                          ? "Verification expires today"
                          : `Verification expires in ${identity.daysLeft} day${identity.daysLeft === 1 ? "" : "s"}`
                      }
                      body={
                        identity.isProbation
                          ? "Re-verify once now to lock in 6 months of claiming."
                          : "Re-verify to keep claiming without interruption."
                      }
                      action={verifyButton("Re-verify")}
                    />
                  )}
                </>
              )}

              {/* Flash urgency notice */}
              {isActive && flash && status !== "done" && (
                <Notice
                  tone="streak"
                  icon={<Zap className="w-5 h-5" strokeWidth={1.75} />}
                  title={`Flash drop, ${timeLeft(drop.expiry)} left`}
                  body="Expires very soon. Hurry."
                />
              )}

              {/* Inactive state */}
              {!isActive && status !== "done" && (
                <div className="rounded-2xl border border-line p-6 text-center flex flex-col items-center gap-y-3">
                  <span className="w-14 h-14 rounded-full bg-surface text-heading flex items-center justify-center">
                    {drop.status === DROP_STATUS.Claimed
                      ? <Target className="w-6 h-6" strokeWidth={1.75} />
                      : <Hourglass className="w-6 h-6" strokeWidth={1.75} />}
                  </span>
                  <p className="text-base/none text-heading">
                    {drop.status === DROP_STATUS.Claimed ? "Already claimed" : "Drop has expired"}
                  </p>
                  <p className="text-sm/[140%] text-nav-muted">
                    {drop.status === DROP_STATUS.Claimed ? "Someone beat you to it." : "This drop is no longer active."}
                  </p>
                </div>
              )}

              {/* Comments */}
              <DropComments dropId={String(drop.id)} dropper={drop.dropper} />

              {/* Report — hunters flag scam / not-there / offensive drops.
                  Hidden on your own drop (nothing to report about yourself). */}
              {!isSelfDrop && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setReporting(true)}
                    className="h-10 px-4 rounded-full inline-flex items-center gap-2 text-sm/none text-nav-muted cursor-pointer
                      motion-safe:transition-colors hover:bg-surface hover:text-heading"
                  >
                    <Flag className="w-4 h-4" strokeWidth={2} /> Report this drop
                  </button>
                </div>
              )}
            </div>
          </Sheet>
        );
      })()}

      <ReportDropSheet
        dropId={drop && reporting ? drop.id.toString() : null}
        onClose={() => setReporting(false)}
      />
    </>
  );
}
