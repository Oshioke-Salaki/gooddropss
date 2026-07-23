"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useAccount, useWriteContract } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { Navigation, Copy, Share2, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchDropByDropId } from "@/lib/subgraph";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import {
  formatG$, gpsToDeg, getDropRarity, RARITY,
  haversineDistance, timeLeft, isFlashDrop,
  parseDropHint, openGoogleMapsWalking, shortAddr, formatUsdApprox,
} from "@/lib/utils";
import { SafetyNote } from "@/components/SafetyNote";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useVerification } from "@/hooks/useVerification";
import { useCountUp } from "@/hooks/useCountUp";
import { useRiddle } from "@/hooks/useRiddle";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { VerificationModal } from "@/components/VerificationModal";
import { HuntingMode } from "@/components/HuntingMode";
import { Celebration } from "@/components/Celebration";
import { ShareableClaimCard } from "@/components/ShareableClaimCard";
import { UserHandle } from "@/components/UserHandle";
import { DROP_STATUS, type Drop, type Campaign } from "@/types";

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
type ClaimStatus = "idle" | "claiming" | "done" | "error" | "gone";

export default function DropPageClient({ dropId }: { dropId: string }) {
  const [drop,       setDrop]       = useState<Drop | null | undefined>(undefined);
  const [userLoc,    setUserLoc]    = useState<{ lat: number; lng: number } | null>(null);
  const [status,     setStatus]     = useState<ClaimStatus>("idle");
  const [errMsg,     setErrMsg]     = useState("");
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
    setStatus("claiming");
    setErrMsg("");
    try {
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
      const err = e as { shortMessage?: string; message?: string };
      const msg = err.shortMessage ?? err.message ?? "Something went wrong — try again.";
      setErrMsg(msg);
      const lost = /already claimed|already been claimed|solved (this|the) riddle first|someone else|being claimed|no longer active|not active|reserved/i.test(msg);
      setStatus(lost ? "gone" : "error");
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
    <Shell {...shellVerifyProps}>
      <div style={{ textAlign: "center", paddingTop: 80 }}>
        <div style={{ fontSize: 52, marginBottom: 12 }} className="animate-bounce">📍</div>
        <p style={{ fontWeight: 700, color: "#888", fontSize: 16 }}>Loading drop…</p>
      </div>
    </Shell>
  );

  if (!drop) return (
    <Shell {...shellVerifyProps}>
      <div style={{ textAlign: "center", padding: "80px 20px" }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🗺️</div>
        <p style={{ fontWeight: 900, fontSize: 22, margin: "0 0 8px" }}>Drop not found</p>
        <p style={{ fontSize: 14, color: "#888", margin: "0 0 24px" }}>
          This link may be invalid or the drop was removed.
        </p>
        <Link href="/" style={brutLink}>Back to map →</Link>
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

  function claimLabel() {
    if (status === "claiming") return "Claiming…";
    if (terminal)              return "← Back to the map";
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
    if (!answerFilled)         return "🧩 Answer the riddle to claim";
    return `Claim ${formatG$(drop!.amount)} G$`;
  }

  return (
    <Shell isVerifying={isVerifying} setIsVerifying={setIsVerifying} fvLink={fvLink} verifyStatus={verifyStatus} onVerifyRefresh={refreshVerify}>
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
      {/* Sponsor banner */}
      {campaign && (
        <div style={{
          background: campaign.color, color: "#111",
          border: "2px solid #111", borderRadius: 14,
          boxShadow: "3px 3px 0 #111",
          padding: "12px 16px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          {campaign.logo && (
            <img src={campaign.logo} alt="" style={{ width: 36, height: 36, borderRadius: 8, border: "1.5px solid #111", objectFit: "cover", flexShrink: 0 }} />
          )}
          {!campaign.logo && (
            <div style={{ width: 36, height: 36, borderRadius: 8, border: "1.5px solid #111", background: "#111", color: campaign.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, flexShrink: 0 }}>
              {campaign.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 13 }}>Sponsored by {campaign.name}</p>
            {campaign.description && <p style={{ margin: "2px 0 0", fontSize: 11, opacity: 0.75 }}>{campaign.description}</p>}
          </div>
          {campaign.goodcollectivePool && (
            <a href={`https://goodcollective.xyz/pool/${campaign.goodcollectivePool}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", fontSize: 10, fontWeight: 900, background: "#111", color: campaign.color, padding: "3px 8px", borderRadius: 6, flexShrink: 0 }}>
              🤝 Pool ↗
            </a>
          )}
        </div>
      )}

      {/* Private banner */}
      {isPrivate && !campaign && (
        <div style={{
          background: "#111", color: "#BFFD00",
          border: "2px solid #111", borderRadius: 14,
          boxShadow: "3px 3px 0 #BFFD00",
          padding: "12px 16px", marginBottom: 16,
          display: "flex", alignItems: "flex-start", gap: 12,
        }}>
          <span style={{ fontSize: 24, flexShrink: 0, marginTop: 1 }}>📫</span>
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 14, lineHeight: 1.4 }}>
              {target
                ? isForMe
                  ? "This drop was hidden just for you"
                  : (<>Meant for <UserHandle address={target} /></>)
                : "Private drop — invitation only"}
            </p>
            {target && !isForMe && isConnected && (
              <p style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.75 }}>
                You can still attempt to claim it from the contract.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Chain banner */}
      {isChain && (
        <div style={{
          background: "#111", color: "#BFFD00",
          border: "2px solid #BFFD00", borderRadius: 14,
          padding: "10px 16px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>{isChainLast ? "🏆" : "🔗"}</span>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>
            {isChainLast ? "Final stop — claim to complete the hunt!" : "Hunt Chain drop — claim to reveal the next stop"}
          </p>
        </div>
      )}

      {/* Drop card */}
      <div style={card}>
        {/* Badges */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <span style={{ background: r.color, color: r.textColor, ...badge }}>
            {r.label}
          </span>
          {flash && <span style={{ background: "#FF6400", color: "#fff", ...badge }}>⚡ Flash</span>}
          {isChain && <span style={{ background: "#111", color: "#BFFD00", ...badge }}>{isChainLast ? "🏆 Final" : "🔗 Chain"}</span>}
          {isActive && <span style={{ background: "#BFFD0033", color: "#111", ...badge }}>⏰ {timeLeft(drop.expiry)}</span>}
          {isClaimed && <span style={{ background: "#eee", color: "#666", ...badge }}>Claimed ✓</span>}
          {isExpired && !isClaimed && <span style={{ background: "#FFE5E5", color: "#FF3B3B", ...badge }}>Expired</span>}
        </div>

        {/* Amount */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 54, fontWeight: 900, lineHeight: 1, color: "#111" }}>
            {formatG$(drop.amount)}
          </span>
          <span style={{ fontSize: 32, fontWeight: 900, color: "#BFFD00" }}> G$</span>
          {formatUsdApprox(drop.amount) && (
            <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#5a5a5a", marginTop: 4 }}>
              {formatUsdApprox(drop.amount)} USD · real, spendable G$
            </span>
          )}
        </div>

        {/* Clue */}
        {hint ? (
          <div style={{ borderLeft: "3px solid #BFFD00", paddingLeft: 14, marginBottom: 14 }}>
            <p style={{ margin: "0 0 5px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>
              🔍 Clue
            </p>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#111", lineHeight: 1.55 }}>
              {hint}
            </p>
          </div>
        ) : (
          <p style={{ margin: "0 0 14px", fontSize: 14, color: "#888", fontStyle: "italic" }}>
            No clue left — you&apos;re on your own 👀
          </p>
        )}

        <p style={{ margin: 0, fontSize: 12, color: "#999" }}>
          {isPrivate ? "Hidden by someone special 🤫" : <>Hidden by <UserHandle address={drop.dropper} /></>}
        </p>
      </div>

      {/* Claim / inactive section */}
      {status === "done" ? (
        <>
          {/* Chain middle stop — dark, sends to next drop */}
          {chainNextId ? (
            <div style={{ ...card, background: "#111", textAlign: "center" }}>
              <div style={{ fontSize: 52, marginBottom: 10 }}>🔗</div>
              <p style={{ fontWeight: 900, fontSize: 22, margin: "0 0 8px", color: "#BFFD00" }}>Next stop unlocked!</p>
              <p style={{ fontSize: 14, margin: "0 0 20px", color: "#aaa" }}>
                {formatG$(drop.amount)} G$ claimed. Keep going — the chain continues!
              </p>
              <a href={`/drop/${chainNextId}`} style={{ ...brutLink, display: "block", textAlign: "center", background: "#BFFD00", color: "#111", textDecoration: "none" }}>
                Go to next stop →
              </a>
              <Link href="/" style={{ display: "block", marginTop: 12, fontSize: 13, color: "#555", textDecoration: "none" }}>
                Back to map
              </Link>
            </div>
          ) : (
            /* Regular or chain-last success */
            <>
              <Celebration active colors={isChainLast ? ["#FFD700", "#BFFD00", "#fff"] : undefined} />
              <div style={{ ...card, background: "#BFFD00", textAlign: "center" }}>
                <div className="success-pop" style={{ fontSize: 60, marginBottom: 12 }}>{isChainLast ? "🏆" : "🎯"}</div>
                <p style={{ fontWeight: 900, fontSize: 24, margin: "0 0 8px" }}>
                  {isChainLast ? "Hunt Complete!" : "You found it!"}
                </p>
                <p style={{ margin: "0 0 18px" }}>
                  <span style={{ fontSize: 40, fontWeight: 900, color: "#111", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                    {successCountText}
                  </span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: "#111", marginLeft: 4 }}>G$</span>
                  <span style={{ display: "block", fontSize: 13, color: "#333", marginTop: 2 }}>is yours!</span>
                </p>

                {/* Shareable win card */}
                <div style={{ marginBottom: 12 }}>
                  <ShareableClaimCard
                    amount={drop.amount}
                    rarity={getDropRarity(drop.amount)}
                    place={hint || null}
                    handle={address ? shortAddr(address) : "a hunter"}
                    dropId={drop.id.toString()}
                  />
                </div>

                <Link href="/" style={{ ...brutLink, display: "block", textAlign: "center", marginBottom: 12 }}>
                  Hunt more drops →
                </Link>
                {/* UBI prompt only for verified users — unverified users cannot claim UBI */}
                {isVerified && (
                  <div style={{
                    background: "rgba(0,0,0,0.1)", borderRadius: 12,
                    padding: "12px 14px", marginTop: 4, cursor: "pointer",
                    border: "1.5px solid rgba(0,0,0,0.2)",
                  }}
                    onClick={() => window.dispatchEvent(new CustomEvent("gd:openWallet"))}
                  >
                    <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                      💰 Also claim your daily G$ UBI
                    </p>
                    <p style={{ margin: "3px 0 0", fontSize: 11, color: "#333" }}>
                      Tap to open wallet → claim GoodDollar UBI
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </>

      ) : isActive ? (
        <div style={card}>
          {/* Proximity meter */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              <span style={{ color: "#111" }}>📍 Distance</span>
              <span style={{ color: isClose ? "#22c55e" : "#888" }}>
                {!userLoc ? "Enable GPS"
                  : distance === null ? "…"
                  : isClose ? `${Math.round(distance)}m — in range!`
                  : `${Math.round(distance)}m away`}
              </span>
            </div>
            <div style={{ height: 8, background: "#eee", borderRadius: 4, overflow: "hidden", border: "1.5px solid #111" }}>
              <div style={{
                height: "100%", borderRadius: 4,
                background: isClose ? "#BFFD00" : "#ccc",
                width: `${proximityPct}%`,
                transition: "width 0.5s ease",
              }} />
            </div>
            <p style={{ fontSize: 11, color: "#888", margin: "6px 0 0", textAlign: "right" }}>
              Must be within {CLAIM_RADIUS_M}m
            </p>
          </div>

          {/* Block non-target users for targeted private drops */}
          {isConnected && target && !isForMe ? (
            <div style={{ ...warnBox, textAlign: "center", padding: "20px 16px" }}>
              <p style={{ margin: "0 0 4px", fontWeight: 900, fontSize: 15 }}>Not for you</p>
              <p style={{ margin: 0, fontSize: 13 }}>
                This drop was hidden for <UserHandle address={target} />
              </p>
            </div>
          ) : (
            <>
              {/* Hunt this drop — full-screen mode with compass + proximity ring */}
              {!isClose && (
                <button
                  onClick={() => isConnected ? setIsHunting(true) : login()}
                  style={{
                    ...secondaryBtn,
                    background: "#111", color: "#BFFD00",
                    border: "2px solid #111",
                    boxShadow: "3px 3px 0 #BFFD00",
                    fontWeight: 800,
                  }}
                >
                  🎯 {isConnected ? "Hunt this drop" : "Sign in to hunt"}
                </button>
              )}

              {/* Walk there — hidden when not signed in (leaks private coords) or already in range */}
              {isConnected && !isClose && (
                <button
                  onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
                  style={secondaryBtn}
                >
                  <Navigation size={15} strokeWidth={2.5} />
                  Walk there
                </button>
              )}

              {/* ── RIDDLE ── */}
              {hasRiddle && !isSelf && (
                <div style={{
                  background: "#111", border: "2px solid #111",
                  borderRadius: 14, padding: 16, marginBottom: 12,
                  boxShadow: "3px 3px 0 #BFFD00",
                }}>
                  <p style={{
                    margin: "0 0 10px", fontSize: 10, fontWeight: 800,
                    textTransform: "uppercase", letterSpacing: "0.1em", color: "#BFFD00",
                  }}>
                    🧩 Riddle-locked
                  </p>

                  {riddleLoading && !riddle ? (
                    <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Loading the riddle…</p>
                  ) : riddle ? (
                    <>
                      <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#fff", lineHeight: 1.5 }}>
                        {riddle.question}
                      </p>

                      {riddle.lockedByOther ? (
                        <div style={{
                          background: "rgba(255,59,59,0.12)", border: "1.5px solid #FF3B3B",
                          borderRadius: 10, padding: "10px 12px",
                        }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#FF3B3B" }}>
                            Someone solved it first
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                            They have a few minutes to claim. If they don&apos;t, it reopens — check back.
                          </p>
                        </div>
                      ) : riddle.lockedByMe ? (
                        <div style={{
                          background: "rgba(191,253,0,0.12)", border: "1.5px solid #BFFD00",
                          borderRadius: 10, padding: "10px 12px",
                        }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "#BFFD00" }}>
                            🥇 You solved it — it&apos;s yours to claim
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#888" }}>
                            Nobody else can take it for the next few minutes.
                          </p>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={answer}
                            onChange={(e) => { setAnswer(e.target.value); if (status === "error") setStatus("idle"); }}
                            placeholder="Your answer…"
                            maxLength={60}
                            autoComplete="off"
                            style={{
                              width: "100%", padding: "13px 14px",
                              background: "rgba(255,255,255,0.06)",
                              border: "2px solid #333", borderRadius: 12,
                              color: "#fff", fontSize: 15, fontWeight: 700,
                              fontFamily: "inherit", outline: "none", boxSizing: "border-box",
                            }}
                            onFocus={(e) => { e.currentTarget.style.borderColor = "#BFFD00"; }}
                            onBlur={(e)  => { e.currentTarget.style.borderColor = "#333"; }}
                          />
                          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#666", lineHeight: 1.5 }}>
                            Spelling counts, but capitals and punctuation don&apos;t.
                            First correct answer gets 10 minutes of exclusive access.
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    <p style={{ margin: 0, fontSize: 13, color: "#FF3B3B", fontWeight: 600 }}>
                      The dropper hasn&apos;t finished setting up this riddle yet — it can&apos;t be claimed until they do. Check back soon.
                    </p>
                  )}
                </div>
              )}

              {status === "error" && errMsg && (
                <div style={errorBox}>{errMsg}</div>
              )}

              {/* Claim CTA */}
              {!isConnected ? (
                <button onClick={login} style={primaryBtn("#111", "#BFFD00", true)}>
                  Sign in to claim
                </button>
              ) : (
                <button
                  onClick={
                    terminal ? () => { window.location.href = "/"; }
                    : status === "error" ? () => { setStatus("idle"); setErrMsg(""); }
                    : identityCheckFailed ? () => refreshIdentity()
                    : handleClaim
                  }
                  disabled={status !== "error" && !btnActive}
                  style={primaryBtn(
                    btnActive ? "#BFFD00" : "#eee",
                    btnActive ? "#111" : "#aaa",
                    btnActive,
                  )}
                >
                  {claimLabel()}
                </button>
              )}

              <div style={{ marginTop: 12 }}>
                <SafetyNote />
              </div>
            </>
          )}

          {/* Verification — never tell someone who already did the face scan that
              they aren't verified. Lapsed and never-verified are different things.
              Hidden while the check loads so verified hunters don't see it flash. */}
          {isConnected && !isVerified && !isBlacklisted && !identityLoading && (
            <div style={{
              marginTop: 12,
              background: isLapsed ? "#FFE5E5" : "#fff8e6",
              border: `2px solid ${isLapsed ? "#FF3B3B" : "#111"}`,
              borderRadius: 14,
              padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{isLapsed ? "🔄" : "🪪"}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                  {isLapsed ? "Re-verify to claim" : "Verify to claim"}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: isLapsed ? "#C81E1E" : "#888", lineHeight: 1.5 }}>
                  {isLapsed
                    ? (identity.isProbation
                        ? "You're face-verified — GoodDollar just needs a re-check. New verifications only stay active for 3 days; re-verify once and it lasts 6 months."
                        : "Your GoodDollar verification has expired. Re-verify to start claiming again.")
                    : "One-time GoodDollar face check confirms you're a real human. Takes a minute."}
                </p>
              </div>
              <button
                onClick={() => setIsVerifying(true)}
                style={{
                  background: "#111", color: "#BFFD00",
                  border: "none", borderRadius: 10,
                  padding: "8px 14px", fontWeight: 900, fontSize: 12,
                  cursor: "pointer", fontFamily: "inherit",
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                {isLapsed ? "Re-verify →" : "Verify →"}
              </button>
            </div>
          )}

          {/* Verified but running out — the 3-day rung gives almost no warning. */}
          {isConnected && isVerified && expiringSoon && (
            <div style={{
              marginTop: 12, background: "#FFF4E0",
              border: "2px solid #FFB020", borderRadius: 14,
              padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>⏳</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                  {identity.daysLeft === 0
                    ? "Verification expires today"
                    : `Verification expires in ${identity.daysLeft} day${identity.daysLeft === 1 ? "" : "s"}`}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "#8a6500", lineHeight: 1.5 }}>
                  {identity.isProbation
                    ? "Re-verify once now to lock in 6 months of claiming."
                    : "Re-verify to keep claiming without interruption."}
                </p>
              </div>
              <button
                onClick={() => setIsVerifying(true)}
                style={{
                  background: "#111", color: "#FFB020",
                  border: "none", borderRadius: 10,
                  padding: "8px 14px", fontWeight: 900, fontSize: 12,
                  cursor: "pointer", fontFamily: "inherit",
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                Re-verify →
              </button>
            </div>
          )}
        </div>

      ) : (
        <div style={{ ...card, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>{isClaimed ? "🎯" : "⌛"}</div>
          <p style={{ fontWeight: 800, fontSize: 18, margin: "0 0 6px" }}>
            {isClaimed ? "Already claimed" : "Drop has expired"}
          </p>
          <p style={{ fontSize: 14, color: "#888", margin: "0 0 24px" }}>
            {isClaimed ? "Someone beat you to it!" : "This drop is no longer active."}
          </p>
          <Link href="/" style={brutLink}>Find live drops →</Link>
        </div>
      )}

      {/* Share / invite section — hidden for private drops (sharing defeats the purpose) */}
      {isPrivate ? (
        isSelf && (
          <div style={{ ...card, textAlign: "center" }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>
              📫 Private invitation link
            </p>
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "#888" }}>
              Only share this with the person you hid the drop for
            </p>
            <div style={{
              display: "inline-block",
              background: "#fff", border: "2px solid #111",
              borderRadius: 12, padding: 14, marginBottom: 14,
            }}>
              <QRCodeSVG value={pageUrl} size={150} level="M" />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={copyLink} style={{
                display: "flex", alignItems: "center", gap: 7,
                background: copied ? "#BFFD00" : "#f5f4f0",
                border: "2px solid #111", borderRadius: 10,
                padding: "9px 16px", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
                transition: "background 0.2s",
              }}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied!" : "Copy invite link"}
              </button>
            </div>
          </div>
        )
      ) : (
        <div style={{ ...card, textAlign: "center" }}>
        <p style={{ margin: "0 0 14px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>
          Share this drop
        </p>
        <div style={{
          display: "inline-block",
          background: "#fff", border: "2px solid #111",
          borderRadius: 12, padding: 14, marginBottom: 14,
        }}>
          <QRCodeSVG value={pageUrl} size={150} level="M" />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={copyLink} style={{
            display: "flex", alignItems: "center", gap: 7,
            background: copied ? "#BFFD00" : "#f5f4f0",
            border: "2px solid #111", borderRadius: 10,
            padding: "9px 16px", fontSize: 13, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
            transition: "background 0.2s",
          }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy link"}
          </button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button
              onClick={() => navigator.share?.({ title: "GoodDrops — hidden G$", url: pageUrl })}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                background: "#111", color: "#BFFD00",
                border: "2px solid #111", borderRadius: 10,
                padding: "9px 16px", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <Share2 size={14} />
              Share
            </button>
          )}
        </div>
      </div>
      )}
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────────────

function ShellWalletButton() {
  const { login, logout, authenticated, ready } = useAuth();
  const { address } = useAccount();
  if (!ready) return null;
  const displayAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  return authenticated && address ? (
    <button onClick={logout} style={{
      background: "#f5f4f0", border: "2px solid #111",
      borderRadius: 10, padding: "6px 12px",
      fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
    }}>
      {displayAddr}
    </button>
  ) : (
    <button onClick={login} style={{
      background: "#111", color: "#BFFD00",
      border: "2px solid #111", borderRadius: 10,
      padding: "7px 16px", fontWeight: 800, fontSize: 13,
      cursor: "pointer", fontFamily: "inherit",
    }}>
      Sign In
    </button>
  );
}

interface ShellProps {
  children:        React.ReactNode;
  isVerifying:     boolean;
  setIsVerifying:  (v: boolean) => void;
  fvLink:          string | null;
  verifyStatus:    import("@/hooks/useVerification").VerificationStatus;
  onVerifyRefresh: () => void;
}

function Shell({ children, isVerifying, setIsVerifying, fvLink, verifyStatus, onVerifyRefresh }: ShellProps) {
  return (
    <div style={{ minHeight: "100dvh", background: "#f5f4f0", fontFamily: "'Space Grotesk', sans-serif" }}>
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "#f5f4f0", borderBottom: "2px solid #111",
        padding: "0 16px", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <Link href="/" style={{
          fontWeight: 900, fontSize: 18, color: "#111",
          textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>good</span>
          <span style={{ background: "#111", color: "#BFFD00", padding: "2px 8px", fontSize: 13 }}>
            drops.
          </span>
        </Link>
        <ShellWalletButton />
      </header>
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px 60px", display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </main>
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

// ── Style constants ───────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#fff",
  border: "2.5px solid #111",
  borderRadius: 20,
  boxShadow: "4px 4px 0 #111",
  padding: "20px",
};

const badge: React.CSSProperties = {
  borderRadius: 100,
  padding: "3px 11px",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

const brutLink: React.CSSProperties = {
  display: "inline-block",
  background: "#BFFD00", color: "#111",
  border: "2px solid #111", borderRadius: 12,
  boxShadow: "2px 2px 0 #111",
  padding: "12px 28px",
  fontWeight: 800, fontSize: 14,
  textDecoration: "none",
};

const secondaryBtn: React.CSSProperties = {
  width: "100%", padding: "12px",
  marginBottom: 12,
  background: "#f5f4f0", border: "2px solid #111",
  borderRadius: 12, fontWeight: 700, fontSize: 13,
  cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
};

function primaryBtn(bg: string, color: string, active: boolean): React.CSSProperties {
  return {
    width: "100%", padding: "17px",
    background: bg, color,
    border: "2.5px solid",
    borderColor: active ? "#111" : "#ddd",
    borderRadius: 14,
    boxShadow: active ? "3px 3px 0 #111" : "none",
    fontWeight: 900, fontSize: 16,
    cursor: active ? "pointer" : "not-allowed",
    fontFamily: "inherit",
    transition: "all 0.15s",
  };
}

const warnBox: React.CSSProperties = {
  background: "#FFF3E0", border: "1.5px solid #FF6400",
  borderRadius: 10, padding: "10px 14px",
  fontSize: 13, color: "#FF6400", fontWeight: 600,
  marginBottom: 12,
};

const errorBox: React.CSSProperties = {
  background: "#FFE5E5", border: "1.5px solid #FF3B3B",
  borderRadius: 10, padding: "10px 14px",
  fontSize: 13, color: "#FF3B3B", fontWeight: 600,
  marginBottom: 12,
};
