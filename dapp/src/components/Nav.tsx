"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useAuth } from "@/hooks/useAuth";
import { celo } from "viem/chains";
import { Map, CalendarDays, Trophy, Gift, Store, Equal, X, ShieldCheck, RefreshCw, Clock, Ban } from "lucide-react";
import { WalletModal } from "@/components/WalletModal";
import { Logo } from "@/components/Logo";
import { StreakBadge } from "@/components/StreakBadge";
import { useGoodDollarProfile } from "@/hooks/useGoodDollarProfile";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useVerification } from "@/hooks/useVerification";
import { useIdentityStatus } from "@/hooks/useIdentityStatus";
import { useProfile } from "@/hooks/useProfile";
import { VerificationModal } from "@/components/VerificationModal";
import { AvatarPicker } from "@/components/AvatarPicker";
import clsx from "clsx";

const links = [
  { href: "/", label: "Map", Icon: Map },
  { href: "/events", label: "Events", Icon: CalendarDays },
  { href: "/leaderboard", label: "Rankings", Icon: Trophy },
  { href: "/competition", label: "Competition", Icon: Gift },
  { href: "/merchant", label: "Spots", Icon: Store },
];

// Nav link styling, kept in one place so the whole bar restyles from here — the
// desktop row and the mobile rail share it, so the two can never drift apart.
// Sizes follow the design spec: 16px/400, 12px 24px padding, 8px icon gap.
const NAV_LINK_BASE =
  "flex items-center gap-2 rounded-full px-6 py-3 text-sm font-normal leading-none whitespace-nowrap transition-colors";
const NAV_LINK_IDLE = "text-nav-muted hover:bg-nav-active-bg/60";
const NAV_LINK_ACTIVE = "bg-nav-active-bg text-nav-active";

// Compact balance for the nav pill: 100000 → "100K", 1500000 → "1.5M".
function compactG(wei: bigint): string {
  const n = Number(wei) / 1e18;
  const trim = (v: number) => v.toFixed(v >= 10 ? 0 : 1).replace(/\.0$/, "");
  if (n >= 1e6) return `${trim(n / 1e6)}M`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return String(Math.round(n));
}

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
  // NB: must stay ABOVE the early returns below — hooks can't be called
  // conditionally. useProfile handles an undefined address safely.
  const profile = useProfile(address);
  const [showModal, setShowModal] = useState(false);

  // Open wallet modal when ClaimSheet success state dispatches gd:openWallet
  useEffect(() => {
    const onOpenWallet = () => setShowModal(true);
    window.addEventListener("gd:openWallet", onOpenWallet);
    return () => window.removeEventListener("gd:openWallet", onOpenWallet);
  }, []);

  if (!ready) return null;

  if (!authenticated) {
    // Sign in — brand pill, text only (the logo already sits beside it in the bar).
    return (
      <button
        onClick={login}
        className="flex items-center rounded-full bg-brand px-6 py-[11px] text-base font-normal leading-none text-white whitespace-nowrap cursor-pointer transition-opacity hover:opacity-90"
      >
        Sign in
      </button>
    );
  }

  // Authenticated but wallet not yet synced (embedded wallet being created, or
  // wagmi/Privy still negotiating after login). Show a neutral loading state —
  // never show an address that doesn't belong to this session.
  if (!address) {
    return (
      <div
        aria-live="polite"
        className="h-10 px-4 rounded-full bg-nav-controls text-sm/none text-nav-muted flex items-center animate-pulse"
      >
        Loading…
      </div>
    );
  }

  if (chainId !== celo.id) {
    return (
      <button
        onClick={() => switchChain({ chainId: celo.id })}
        className="h-10 px-4 rounded-full bg-danger text-white text-sm/none cursor-pointer
          motion-safe:transition-opacity hover:opacity-90 whitespace-nowrap"
      >
        Switch network
      </button>
    );
  }

  const shortAddress = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const username = profile?.username ?? null;
  // Only nudge once we've confirmed there's no name (never while loading).
  const pillLabel = username ? `@${username}` : shortAddress;

  return (
    <>
      {/* Avatar + balance pill — white, 4px padding, 8px gap (design spec).
          Opens the wallet modal, which is where verification / name / send live. */}
      <button
        onClick={() => setShowModal((v) => !v)}
        title={pillLabel}
        aria-label={`Wallet — ${pillLabel}`}
        className="flex items-center gap-2 rounded-full bg-nav-pill p-1 cursor-pointer min-w-0"
      >
        {/* Avatar with the GoodDollar verification badge pinned bottom-right.
            Artwork lives at public/badge-verified.svg and public/badge-unverified.svg.
            Hidden while the check is in flight so we never flash a false "unverified". */}
        <span className="relative shrink-0 leading-none">
          <ProfileAvatar address={address} size={28} ringColor="transparent" />
          {!isVerificationLoading &&
            (isVerified ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/badge-verified.svg"
                alt="Verified"
                title="GoodDollar verified"
                width={12}
                height={12}
                className="absolute -bottom-0.5 -right-0.5 pointer-events-none"
              />
            ) : (
              // Tapping the warning jumps straight into verification — the same
              // shortcut the old nav badge gave lapsed users.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/badge-unverified.svg"
                alt="Not verified"
                title="Verify with GoodDollar"
                width={12}
                height={12}
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenVerify();
                }}
                className="absolute -bottom-0.5 -right-0.5 cursor-pointer"
              />
            ))}
        </span>
        <span className="pr-2 text-base font-normal uppercase leading-none text-nav-active truncate">
          {compactG(balance)} G$
        </span>
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
export type VerifyBannerMode = "none" | "lapsed" | "expiring" | "blacklisted";

interface VerifyBannerProps {
  mode: VerifyBannerMode | null; // null ⇒ nothing to say
  isProbation: boolean;
  daysLeft: number;
  isConnected: boolean;
  onGetVerified: () => void;
}

const day = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

const BANNER_COPY: Record<
  VerifyBannerMode,
  (p: { isProbation: boolean; daysLeft: number }) => {
    tone: "brand" | "warn" | "danger";
    text: string;
    cta: string | null;
  }
> = {
  none: () => ({
    tone: "brand",
    text: "Verification required to claim drops.",
    cta: "Get verified",
  }),
  lapsed: ({ isProbation }) => ({
    tone: "danger",
    // They DID verify. Say so — otherwise they assume we lost it and that the
    // app is broken. Note the short window RECURS (authCount cycles), so this is
    // never phrased as "your first verification".
    text: isProbation
      ? "You're face-verified — GoodDollar just needs a re-check. New verifications only stay active for 3 days; re-verify once and it lasts 6 months."
      : "Your GoodDollar verification has expired. Re-verify to keep claiming.",
    cta: "Re-verify",
  }),
  expiring: ({ isProbation, daysLeft }) => ({
    tone: "warn",
    text: isProbation
      ? `Your verification is only active for ${day(daysLeft)}. Re-verify now to lock in 6 months of claiming.`
      : `Your GoodDollar verification expires in ${day(daysLeft)}.`,
    cta: "Re-verify",
  }),
  blacklisted: () => ({
    tone: "danger",
    // Nothing the user can do in-app — don't dangle a "verify" button that
    // would only fail.
    text: "This wallet has been blocked by GoodDollar and can't claim drops. Contact GoodDollar support.",
    cta: null,
  }),
};

const BANNER_ICON: Record<VerifyBannerMode, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  none: ShieldCheck,
  lapsed: RefreshCw,
  expiring: Clock,
  blacklisted: Ban,
};
const TONE_ICON = {
  brand: "bg-brand-soft text-brand",
  warn: "bg-streak-bg text-streak",
  danger: "bg-danger/10 text-danger",
} as const;

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
  const visible =
    mounted &&
    isConnected &&
    mode !== null &&
    !(dismissed && mode !== "lapsed");
  const copy = mode ? BANNER_COPY[mode]({ isProbation, daysLeft }) : null;

  // Publish the banner's height. It wraps to two lines on a phone, so anything
  // below it (the "N drops live" pill) has to be told how tall it actually is
  // rather than assuming one line.
  const bannerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => root.style.setProperty("--gd-banner-h", "0px");
    const el = bannerRef.current;
    if (!visible || !el) {
      clear();
      return clear;
    }

    const publish = () =>
      root.style.setProperty("--gd-banner-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      clear();
    };
  }, [visible]);

  if (!visible || !copy) return null;
  const Icon = BANNER_ICON[mode!];

  return (
    // Sits flush under the bar (`top-nav`), full width, and publishes its own
    // height above so the map overlays can clear it.
    <div
      ref={bannerRef}
      role="status"
      className="fixed left-0 right-0 top-nav z-[997] bg-white border-b border-line font-sans
        px-4 py-2.5 pr-12 flex items-center justify-center gap-3 flex-wrap"
    >
      <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${TONE_ICON[copy.tone]}`}>
        <Icon className="w-4 h-4" strokeWidth={2} />
      </span>
      <span className="text-sm/[140%] text-heading text-center max-w-[640px]">{copy.text}</span>
      {/* Blacklisted has no CTA — there is nothing the user can do here, and a
          button that only fails is worse than no button. */}
      {copy.cta && (
        <button
          type="button"
          onClick={onGetVerified}
          className={`h-8 px-4 rounded-full text-sm/none text-white cursor-pointer whitespace-nowrap
            motion-safe:transition-opacity hover:opacity-90 ${copy.tone === "brand" ? "bg-brand" : "bg-nav-active"}`}
        >
          {copy.cta}
        </button>
      )}
      {/* A lapsed wallet genuinely cannot claim. Letting it be dismissed would
          hide the only explanation the user is ever given. */}
      {mode !== "lapsed" && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-surface text-heading
            flex items-center justify-center cursor-pointer motion-safe:transition-colors hover:bg-nav-controls"
        >
          <X className="w-4 h-4" />
        </button>
      )}
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

  // Mobile links rail (below lg). It hangs under the bar and covers the map's
  // search band, so the map page listens for `gd:navmenu` to hide that band
  // rather than let a sliver of it peek out beneath the rail.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("gd:navmenu", { detail: { open: menuOpen } }));
  }, [menuOpen]);
  // Navigating is an implicit dismissal.
  useEffect(() => { setMenuOpen(false); }, [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // The precise on-chain picture: never-verified vs. verified-but-lapsed vs.
  // verified-and-about-to-lapse. useVerification only knows "can claim / can't".
  const {
    status: idStatus,
    isLapsed,
    isBlacklisted,
    expiringSoon,
    neverVerified,
    isLoading: idLoading,
    refresh: refreshIdentity,
  } = useIdentityStatus();

  const bannerMode: VerifyBannerMode | null = idLoading
    ? null
    : isBlacklisted
      ? "blacklisted"
      : isLapsed
        ? "lapsed"
        : expiringSoon
          ? "expiring"
          : neverVerified
            ? "none"
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
      {/* Top bar — 2026 refresh. Colours/height come from the `--color-nav-*` and
          `--spacing-nav` tokens in globals.css; edit there to restyle. */}
      <nav className="fixed top-0 left-0 right-0 z-[1100] bg-nav font-sans">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:px-[60px]">
          {/* Logo */}
          <Link href="/" aria-label="GoodDrops home" className="shrink-0">
            <Logo size="md" />
          </Link>

          {/* Desktop nav links */}
          <div className="hidden lg:flex items-center gap-1 flex-1 justify-center overflow-hidden min-w-0 shrink">
            {links.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={(path === href || (href !== "/" && path.startsWith(`${href}/`))) ? "page" : undefined}
                className={clsx(
                  NAV_LINK_BASE,
                  (path === href || (href !== "/" && path.startsWith(`${href}/`))) ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
                )}
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                {label}
              </Link>
            ))}
          </div>

          {/* User controls, then the menu button. Both stay 40px tall so the bar's
              height is exactly --spacing-nav at every breakpoint. */}
          <div className="flex items-center gap-2 min-w-0">
            {isConnected ? (
              /* Signed in — streak + wallet button in the grey pill
                 (spec: 2px 16px, rounded-full, 14px gap). The wallet button opens
                 the wallet modal. */
              <div className="min-w-0 flex items-center gap-[14px] rounded-full bg-nav-controls pl-4 pr-0.5 py-0.5 max-w-[280px]">
                <StreakBadge />
                <WalletButton
                  isVerified={isVerified}
                  isVerificationLoading={isVerificationLoading}
                  onOpenVerify={() => setIsVerifying(true)}
                />
              </div>
            ) : (
              /* Signed out — the brand Sign in pill stands alone, no grey container
                 and no streak. */
              <div className="shrink-0">
                <WalletButton
                  isVerified={isVerified}
                  isVerificationLoading={isVerificationLoading}
                  onOpenVerify={() => setIsVerifying(true)}
                />
              </div>
            )}

            {/* Menu toggle — 40×40, below lg only (the links sit in the bar above that) */}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="nav-mobile-links"
              className="lg:hidden shrink-0 w-10 h-10 rounded-full bg-nav-controls text-nav-active flex items-center justify-center cursor-pointer motion-safe:transition-colors hover:bg-[#E0E0E0]"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Equal className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile links rail — hangs below the bar rather than growing it, so
            --spacing-nav stays true and `pt-nav` pages don't jump. Scrolls
            horizontally once the links outrun the screen. */}
        {menuOpen && (
          <div
            id="nav-mobile-links"
            className="lg:hidden absolute top-full left-0 right-0 bg-nav border-t border-line shadow-[0px_4px_12px_0px_#0000000A]"
          >
            {/* No gap — each link's own px-6 padding does the spacing, so the
                active pill sits flush against its neighbours. */}
            <div className="no-scrollbar flex items-center overflow-x-auto px-4 py-4">
              {links.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={(path === href || (href !== "/" && path.startsWith(`${href}/`))) ? "page" : undefined}
                  className={clsx(
                    NAV_LINK_BASE,
                    "shrink-0",
                    (path === href || (href !== "/" && path.startsWith(`${href}/`))) ? NAV_LINK_ACTIVE : NAV_LINK_IDLE,
                  )}
                >
                  <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        )}
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

      {/* Global avatar picker — opened via the `gd:editAvatar` event from anywhere */}
      <AvatarPicker />
    </>
  );
}

