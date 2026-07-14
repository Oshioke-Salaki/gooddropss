"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { celo } from "viem/chains";
import { Map, Package, Trophy } from "lucide-react";
import { WalletModal } from "@/components/WalletModal";
import { StreakBadge } from "@/components/StreakBadge";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { useVerification } from "@/hooks/useVerification";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { VerificationModal } from "@/components/VerificationModal";
import { formatG$ } from "@/lib/utils";
import clsx from "clsx";

const links = [
  { href: "/", label: "Map" },
  { href: "/my-drops", label: "My Drops" },
  { href: "/leaderboard", label: "Rankings" },
  { href: "/merchant", label: "Spots 🏪" },
  { href: "/sponsor", label: "Sponsor ⭐" },
];

// ── Wallet button ─────────────────────────────────────────────────────────────

interface WalletButtonProps {
  isVerified: boolean;
  isVerificationLoading: boolean;
  onOpenVerify: () => void;
}

function WalletButton({
  isVerified,
  isVerificationLoading,
  onOpenVerify,
}: WalletButtonProps) {
  const { login, logout, ready, authenticated } = useAuth();
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  // wagmi is the single source of truth now, so logout is a clean disconnect.
  const handleDisconnect = logout;

  const { balance } = useGoodDollarProfile();
  const [isNarrow, setIsNarrow] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsNarrow(mq.matches);
    const h = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Open wallet modal when ClaimSheet success state dispatches gd:openWallet
  useEffect(() => {
    const onOpenWallet = () => setShowModal(true);
    window.addEventListener("gd:openWallet", onOpenWallet);
    return () => window.removeEventListener("gd:openWallet", onOpenWallet);
  }, []);

  if (!ready) return null;

  if (!authenticated) {
    return (
      <button
        onClick={login}
        style={{
          background: "#111111",
          color: "#bffd00",
          border: "2px solid #111111",
          boxShadow: "2px 2px 0 #bffd00",
          fontWeight: 800,
          fontSize: "13px",
          padding: "7px 16px",
          borderRadius: "10px",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        Sign In
      </button>
    );
  }

  // Authenticated but wallet not yet synced (embedded wallet being created, or
  // wagmi/Privy still negotiating after login). Show a neutral loading state —
  // never show an address that doesn't belong to this session.
  if (!address) {
    return (
      <div
        style={{
          background: "#f5f4f0",
          border: "2px solid #111111",
          borderRadius: "10px",
          padding: "7px 16px",
          fontSize: "13px",
          fontWeight: 700,
          color: "#888",
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      >
        Loading…
      </div>
    );
  }

  if (chainId !== celo.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: celo.id })}
        style={{
          background: "#ff3b3b",
          color: "#fff",
          border: "2px solid #111111",
          fontWeight: 700,
          fontSize: "13px",
          padding: "7px 16px",
          borderRadius: "10px",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Switch network
      </button>
    );
  }

  const shortAddress = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const gdBadge = isVerificationLoading ? (
    <span
      title="Checking verification…"
      style={{
        background: "#e5e5e5",
        color: "#888",
        border: "1.5px solid #bbb",
        borderRadius: "5px",
        fontSize: "10px",
        fontWeight: 900,
        padding: "1px 5px",
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        flexShrink: 0,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    >
      ···
    </span>
  ) : isVerified ? (
    <span
      title="Verified"
      style={{
        background: "#bffd00",
        color: "#111111",
        border: "1.5px solid #111111",
        borderRadius: "5px",
        fontSize: "10px",
        fontWeight: 900,
        padding: "1px 5px",
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      ✓
    </span>
  ) : (
    <span
      role="button"
      tabIndex={0}
      title="Not verified — click to verify"
      onClick={(e) => {
        e.stopPropagation();
        onOpenVerify();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          onOpenVerify();
        }
      }}
      style={{
        background: "#FF3B3B",
        color: "#fff",
        border: "1.5px solid #111111",
        borderRadius: "5px",
        fontSize: "10px",
        fontWeight: 900,
        padding: "1px 5px",
        letterSpacing: "0.02em",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        flexShrink: 0,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      !
    </span>
  );

  return (
    <>
      <button
        onClick={() => setShowModal((v) => !v)}
        style={{
          background: "#f5f4f0",
          color: "#111111",
          border: "2px solid #111111",
          boxShadow: "2px 2px 0 #111111",
          fontWeight: 700,
          fontSize: "13px",
          padding: "5px 12px",
          borderRadius: "10px",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex",
          alignItems: "center",
          gap: "7px",
          maxWidth: isNarrow ? "160px" : "240px",
        }}
      >
        {gdBadge}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shortAddress}
        </span>
        {!isNarrow && (
          <span
            style={{
              marginLeft: "2px",
              padding: "2px 7px",
              background: "#111111",
              color: "#bffd00",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 800,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {formatG$(balance)} G$
          </span>
        )}
      </button>

      {showModal && (
        <WalletModal
          address={address as `0x${string}`}
          isVerified={isVerified}
          onDisconnect={handleDisconnect}
          onClose={() => setShowModal(false)}
          onOpenVerify={onOpenVerify}
        />
      )}
    </>
  );
}

// ── Verify banner ──────────────────────────────────────────────────────────────

// Three genuinely different situations, three different messages. Collapsing
// them into one "verification required" is what made a user who HAD verified
// think the app was broken.
export type VerifyBannerMode = "none" | "lapsed" | "expiring";

interface VerifyBannerProps {
  mode: VerifyBannerMode | null;   // null ⇒ nothing to say
  isProbation: boolean;
  daysLeft: number;
  isConnected: boolean;
  onGetVerified: () => void;
}

const BANNER_COPY: Record<
  VerifyBannerMode,
  (p: { isProbation: boolean; daysLeft: number }) => { accent: string; text: string; cta: string }
> = {
  none: () => ({
    accent: "#bffd00",
    text: "⚡ Verification required to claim drops.",
    cta: "Get Verified →",
  }),
  lapsed: ({ isProbation }) => ({
    accent: "#FF3B3B",
    text: isProbation
      // The 3-day probation rung. They DID verify — say so, or they'll assume
      // we lost it and that the whole thing is broken.
      ? "🔄 You're face-verified, but GoodDollar needs one more check — first-time verifications only last 3 days. Re-verify once and you're set for 6 months."
      : "🔄 Your GoodDollar verification has expired. Re-verify to keep claiming.",
    cta: "Re-verify →",
  }),
  expiring: ({ isProbation, daysLeft }) => ({
    accent: "#FFB020",
    text: isProbation
      ? `⏳ Almost there — re-verify within ${daysLeft} day${daysLeft === 1 ? "" : "s"} to lock in 6 months of claiming.`
      : `⏳ Your GoodDollar verification expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
    cta: "Re-verify →",
  }),
};

export function VerifyBanner({
  mode,
  isProbation,
  daysLeft,
  isConnected,
  onGetVerified,
}: VerifyBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // A lapsed wallet cannot claim at all, so that one is not dismissible —
  // dismissing it would leave the user stuck with no explanation.
  const visible = mounted && isConnected && mode !== null && !(dismissed && mode !== "lapsed");
  const copy = mode ? BANNER_COPY[mode]({ isProbation, daysLeft }) : null;

  // Publish the banner's height. It wraps to two lines on a phone, so anything
  // below it (the "N drops live" pill) has to be told how tall it actually is
  // rather than assuming one line.
  const bannerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.setProperty("--gd-banner-h", "0px");
    const el = bannerRef.current;
    if (!visible || !el) { clear(); return clear; }

    const publish = () => root.style.setProperty("--gd-banner-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => { ro.disconnect(); clear(); };
  }, [visible]);

  if (!visible || !copy) return null;

  return (
    <div
      ref={bannerRef}
      style={{
        position: "fixed",
        top: "56px",
        left: 0,
        right: 0,
        zIndex: 997,
        background: "#111111",
        borderBottom: `2px solid ${copy.accent}`,
        padding: "8px 34px 8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        fontSize: "13px",
        fontFamily: "inherit",
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "#fff", fontWeight: 600, textAlign: "center", lineHeight: 1.45 }}>
        {copy.text}
      </span>
      <button
        onClick={onGetVerified}
        style={{
          background: copy.accent,
          color: "#111111",
          border: `1.5px solid ${copy.accent}`,
          borderRadius: "6px",
          padding: "3px 10px",
          fontWeight: 800,
          fontSize: "12px",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        {copy.cta}
      </button>
      <button
        onClick={() => setDismissed(true)}
        // A lapsed wallet genuinely cannot claim. Letting it be dismissed would
        // hide the only explanation the user is ever given.
        hidden={mode === "lapsed"}
        style={{
          position: "absolute",
          right: "12px",
          background: "transparent",
          border: "none",
          color: "#888",
          cursor: "pointer",
          fontSize: "16px",
          lineHeight: 1,
          fontFamily: "inherit",
          display: mode === "lapsed" ? "none" : "block",
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

export function Nav() {
  const path = usePathname();
  const { isConnected } = useAccount();
  const { status, isVerified, fvLink, isVerifying, setIsVerifying, refresh } =
    useVerification();
  const isVerificationLoading = status === "loading";

  // The precise on-chain picture: never-verified vs. verified-but-lapsed vs.
  // verified-and-about-to-lapse. useVerification only knows "can claim / can't".
  const {
    status: idStatus,
    isLapsed,
    expiringSoon,
    neverVerified,
    isLoading: idLoading,
    refresh: refreshIdentity,
  } = useIdentityStatus();

  const bannerMode: VerifyBannerMode | null =
    idLoading      ? null
    : isLapsed     ? "lapsed"
    : expiringSoon ? "expiring"
    : neverVerified ? "none"
    : null;

  // Broadcast verification so every useGoodDollarProfile instance refetches immediately
  const prevVerified = useRef(false);
  useEffect(() => {
    if (isVerified && !prevVerified.current) {
      window.dispatchEvent(new CustomEvent("gd:verified"));
      refreshIdentity();
    }
    prevVerified.current = isVerified;
  }, [isVerified, refreshIdentity]);

  // Listen for events dispatched by ClaimSheet / DropPageClient to open modals.
  // gd:openVerify — opens the GoodDollar face-verification flow.
  // gd:openWallet — opens the wallet modal (for UBI claim prompt after a drop claim).
  useEffect(() => {
    const onOpenVerify = () => setIsVerifying(true);
    window.addEventListener("gd:openVerify", onOpenVerify);
    return () => window.removeEventListener("gd:openVerify", onOpenVerify);
  }, [setIsVerifying]);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-[1100] bg-cream border-b-2 border-ink h-14">
        <div className="lg:px-[100px] mx-auto px-4 h-full flex items-center justify-between gap-3">
          {/* Logo */}
          <Link
            href="/"
            className="shrink-0 flex items-center gap-1.5 font-black text-lg tracking-tight"
          >
            <span>good</span>
            <span className="bg-ink text-lime px-1.5 py-0.5 text-sm">
              drops.
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden sm:flex items-center gap-0.5 flex-1 justify-center overflow-hidden min-w-0 shrink">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={clsx(
                  "px-2.5 py-1.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap",
                  path === l.href
                    ? "bg-lime text-ink"
                    : "text-muted hover:text-ink hover:bg-border",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* Streak + Wallet — max-w prevents a wide wallet badge from squeezing nav links out */}
          <div className="shrink-0 flex items-center gap-2 max-w-[280px]">
            <StreakBadge />
            <WalletButton
              isVerified={isVerified}
              isVerificationLoading={isVerificationLoading}
              onOpenVerify={() => setIsVerifying(true)}
            />
          </div>
        </div>
      </nav>

      <VerifyBanner
        mode={bannerMode}
        isProbation={idStatus.isProbation}
        daysLeft={idStatus.daysLeft}
        isConnected={isConnected}
        onGetVerified={() => setIsVerifying(true)}
      />

      <VerificationModal
        isOpen={isVerifying}
        onClose={() => setIsVerifying(false)}
        fvLink={fvLink}
        status={status}
        onRefresh={refresh}
      />
    </>
  );
}

// ── Bottom nav (mobile) ───────────────────────────────────────────────────────

export function BottomNav() {
  const path = usePathname();

  const items = [
    { href: "/", label: "Map", Icon: Map },
    { href: "/my-drops", label: "My Drops", Icon: Package },
    { href: "/leaderboard", label: "Rankings", Icon: Trophy },
  ];

  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 bg-cream border-t-2 border-ink"
      style={{ zIndex: 1000 }}
    >
      <div className="grid grid-cols-3 h-16">
        {items.map(({ href, label, Icon }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors",
                active ? "text-ink bg-lime" : "text-muted",
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
