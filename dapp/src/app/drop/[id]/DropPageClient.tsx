"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAccount, useWriteContract } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { Navigation, Copy, Share2, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchDropByDropId } from "@/lib/subgraph";
import { publicClient } from "@/lib/publicClient";
import { GOOD_DROPS_ADDRESS, GOOD_DROPS_ABI, CLAIM_RADIUS_M } from "@/lib/contracts";
import {
  formatG$, gpsToDeg, getDropRarity, RARITY,
  haversineDistance, timeLeft, isFlashDrop,
  parseDropHint, openGoogleMapsWalking,
} from "@/lib/utils";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useVerification } from "@/hooks/useVerification";
import { useGracePeriod, GRACE_CLAIM_LIMIT } from "@/hooks/useGracePeriod";
import { VerificationModal } from "@/components/VerificationModal";
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

type ClaimStatus = "idle" | "claiming" | "done" | "error";

export default function DropPageClient({ dropId }: { dropId: string }) {
  const [drop,    setDrop]    = useState<Drop | null | undefined>(undefined);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [status,  setStatus]  = useState<ClaimStatus>("idle");
  const [errMsg,  setErrMsg]  = useState("");
  const [copied,  setCopied]  = useState(false);

  const { login, authenticated } = usePrivy();
  const { address }              = useAccount();
  const isConnected              = authenticated && !!address;
  const { isVerified }           = useGoodDollarProfile();
  const { inGrace, left, used }  = useGracePeriod();
  const verificationOk           = isVerified || inGrace;
  const { writeContractAsync }   = useWriteContract();
  const {
    status: verifyStatus, fvLink, isVerifying,
    setIsVerifying, refresh: refreshVerify,
  } = useVerification();

  // Parse hint + fetch campaign BEFORE early returns so hooks are always called
  // in the same order (React rules of hooks).
  const parsedHint = drop ? parseDropHint(drop.hint) : null;
  const campaign   = useCampaign(parsedHint?.campaignId ?? null);

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
    if (!drop) return;
    setStatus("claiming");
    setErrMsg("");
    try {
      const tx = await writeContractAsync({
        address:      GOOD_DROPS_ADDRESS,
        abi:          GOOD_DROPS_ABI,
        functionName: "claim",
        args:         [drop.id],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("done");
      // Track hunting streak (fire-and-forget)
      if (address) {
        fetch("/api/engagement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address }),
        }).catch(() => {});
      }
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setErrMsg(err.shortMessage ?? err.message ?? "Something went wrong — try again.");
      setStatus("error");
    }
  }, [drop, address, writeContractAsync]);

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
  const dropLat   = gpsToDeg(drop.lat);
  const dropLng   = gpsToDeg(drop.lng);
  const now       = Math.floor(Date.now() / 1000);
  const isExpired = drop.expiry < now;
  const isActive  = drop.status === DROP_STATUS.Active && !isExpired;
  const isClaimed = drop.status === DROP_STATUS.Claimed;
  const isSelf    = !!address && address.toLowerCase() === drop.dropper.toLowerCase();
  const isForMe   = !target || (!!address && address.toLowerCase() === target.toLowerCase());

  const distance     = userLoc ? haversineDistance(userLoc.lat, userLoc.lng, dropLat, dropLng) : null;
  const isClose      = distance !== null && distance <= CLAIM_RADIUS_M;
  const proximityPct = distance !== null ? Math.max(0, Math.min(100, (1 - distance / 500) * 100)) : 0;

  const canClaim = isConnected && verificationOk && isActive && !isSelf && isClose && status === "idle";

  const rarity = getDropRarity(drop.amount);
  const r      = RARITY[rarity];
  const flash  = isFlashDrop(drop);

  function claimLabel() {
    if (status === "claiming") return "Claiming…";
    if (status === "error")    return "Try again";
    if (!isConnected)          return "Sign in to claim";
    if (!verificationOk)       return "Verification required";
    if (isSelf)                return "This is your own drop";
    if (!userLoc)              return "Enable GPS to claim";
    if (!isClose)              return `Get closer — ${Math.round(distance ?? 0)}m away`;
    return `Claim ${formatG$(drop!.amount)} G$`;
  }

  return (
    <Shell isVerifying={isVerifying} setIsVerifying={setIsVerifying} fvLink={fvLink} verifyStatus={verifyStatus} onVerifyRefresh={refreshVerify}>
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
          Hidden by <UserHandle address={drop.dropper} />
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
            <div style={{ ...card, background: "#BFFD00", textAlign: "center" }}>
              <div style={{ fontSize: 60, marginBottom: 12 }}>{isChainLast ? "🏆" : "🎯"}</div>
              <p style={{ fontWeight: 900, fontSize: 24, margin: "0 0 8px" }}>
                {isChainLast ? "Hunt Complete!" : "You found it!"}
              </p>
              <p style={{ fontSize: 15, margin: "0 0 20px", color: "#111" }}>
                {formatG$(drop.amount)} G$ is yours!
              </p>
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

          {/* Walk there */}
          <button
            onClick={() => openGoogleMapsWalking(dropLat, dropLng)}
            style={secondaryBtn}
          >
            <Navigation size={15} strokeWidth={2.5} />
            Walk there
          </button>

          {/* Warnings */}
          {isConnected && target && !isForMe && (
            <div style={warnBox}>
              ⚠️ This drop was meant for <UserHandle address={target} />
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
              onClick={status === "error" ? () => { setStatus("idle"); setErrMsg(""); } : handleClaim}
              disabled={status !== "error" && !canClaim}
              style={primaryBtn(
                (canClaim || status === "error") ? "#BFFD00" : "#eee",
                (canClaim || status === "error") ? "#111" : "#aaa",
                (canClaim || status === "error"),
              )}
            >
              {claimLabel()}
            </button>
          )}

          {/* Grace period counter — free claims remaining */}
          {isConnected && !isVerified && inGrace && (
            <div style={{
              marginTop: 12, background: "#f0fff4",
              border: "2px solid #111", borderRadius: 14,
              padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🎯</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                  {left} free claim{left !== 1 ? "s" : ""} remaining
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "#888" }}>
                  Verify anytime to unlock unlimited hunting
                </p>
              </div>
              <button
                onClick={() => setIsVerifying(true)}
                style={{
                  background: "transparent", color: "#111",
                  border: "2px solid #111", borderRadius: 10,
                  padding: "6px 12px", fontWeight: 800, fontSize: 12,
                  cursor: "pointer", fontFamily: "inherit",
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                Verify
              </button>
            </div>
          )}

          {/* Grace exhausted — verification now required */}
          {isConnected && !isVerified && !inGrace && (
            <div style={{
              marginTop: 12, background: "#fff8e6",
              border: "2px solid #111", borderRadius: 14,
              padding: "12px 16px", display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>🪪</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 13, color: "#111" }}>
                  Verification required
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "#888" }}>
                  You&apos;ve used all {GRACE_CLAIM_LIMIT} free claims — verify to keep hunting
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
                Verify →
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

      {/* QR / share section */}
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
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────────────────────────

function ShellWalletButton() {
  const { login, logout, authenticated, ready } = usePrivy();
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
      Connect
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
