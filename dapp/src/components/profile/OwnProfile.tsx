"use client";
import { useCallback, useMemo, useState } from "react";
import {
  Check, CircleArrowOutUpRight, Copy, Flame, Medal, Pencil, Users,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/BrandMark";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useProfile } from "@/hooks/useProfile";
import { useVerification } from "@/hooks/useVerification";
import { useLeaderboard } from "@/app/leaderboard/useLeaderboard";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import { inviteUrl } from "@/lib/referral";
import { SITE_URL } from "@/lib/site";
import { formatG$, shortAddr } from "@/lib/utils";
import { BadgeGrid } from "./BadgeGrid";
import { BadgeViewer } from "./BadgeViewer";
import { EditProfileModal } from "./EditProfileModal";
import { QuestCard } from "@/components/quests/QuestCard";
import { useHunterProfile, type WallBadge } from "./useHunterProfile";
import { useHunterStreak } from "./useHunterStreak";
import { track } from "@/lib/analytics";

const MEDALS = ["/first-medal.svg", "/second-medal.svg", "/third-medal.svg"];

/** 1834 → "1.8k", the same shape formatG$ gives money. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k.toFixed(k >= 10 ? 0 : 1).replace(/\.0$/, "")}k`;
}

/** "3,412" → "3000+": a round-number floor, so the count reads as a milestone. */
function roughCount(n: number): string {
  if (n < 10) return String(n);
  const mag = 10 ** Math.max(1, Math.floor(Math.log10(n)) - (n >= 1000 ? 0 : 1));
  return `${Math.floor(n / mag) * mag}+`;
}

/**
 * The signed-in person's own profile page body.
 *
 * Deliberately NOT the public hunter card: this one has the edit button, the
 * invite section and the rank medal, which only make sense for yourself. It's
 * rendered by /me and by /hunter/[address] when that address is your own, so
 * your own share link lands on the full page.
 */
export function OwnProfile({ address }: { address: string }) {
  const profile = useProfile(address);
  const { data, badges } = useHunterProfile(address, true);
  const streak = useHunterStreak(address);
  const { isVerified, isLoading: verifying } = useVerification();
  const board = useLeaderboard();

  const [editing, setEditing] = useState(false);
  const [badge, setBadge] = useState<WallBadge | null>(null);
  const [copied, setCopied] = useState<"address" | "invite" | "share" | null>(null);

  const flash = useCallback((what: "address" | "invite" | "share") => {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 1800);
  }, []);

  // Best standing across both boards. The board is keyed by identity root but
  // displays each person's most recently used wallet — the one we're signed in
  // with, in practice.
  const { rank, totalPeople } = useMemo(() => {
    const me = address.toLowerCase();
    const at = (rows: { address: string }[]) => {
      const i = rows.findIndex((r) => r.address.toLowerCase() === me);
      return i < 0 ? null : i + 1;
    };
    const h = at(board.hunters);
    const d = at(board.droppers);
    const best = h && d ? Math.min(h, d) : h ?? d;
    const people = new Set([...board.hunters, ...board.droppers].map((r) => r.address.toLowerCase()));
    return { rank: best, totalPeople: people.size };
  }, [board.hunters, board.droppers, address]);

  const invite = inviteUrl(SITE_URL, address);
  const inviteLabel = invite.replace(/^https?:\/\//, "");
  const profileUrl = `${SITE_URL}/hunter/${address.toLowerCase()}`;

  const copy = useCallback(async (text: string, what: "address" | "invite") => {
    try {
      await navigator.clipboard.writeText(text);
      flash(what);
      if (what === "invite") track("invite_link_copied");
    } catch { /* clipboard blocked — the text is on screen anyway */ }
  }, [flash]);

  const share = useCallback(async () => {
    const title = profile?.username ? `@${profile.username} on GoodDrops` : "My GoodDrops profile";
    try {
      if (navigator.share) {
        await navigator.share({ title, url: profileUrl });
        return;
      }
      await navigator.clipboard.writeText(profileUrl);
      flash("share");
    } catch { /* share sheet dismissed, or clipboard blocked */ }
  }, [profile?.username, profileUrl, flash]);

  const loading = data === null;
  const earned = badges?.filter((b) => b.earned).length ?? 0;
  const hasMedal = !!rank && rank <= 3;

  const shareButton = (extra: string) => (
    <button
      type="button"
      onClick={share}
      className={`flex items-center gap-2 h-9 px-5 rounded-full bg-nav-active text-white text-sm/none
        cursor-pointer motion-safe:transition-opacity hover:opacity-90 whitespace-nowrap ${extra}`}
    >
      {copied === "share"
        ? <Check className="w-[18px] h-[18px]" />
        : <CircleArrowOutUpRight className="w-[18px] h-[18px]" strokeWidth={1.75} />}
      {copied === "share" ? "Link copied" : "Share profile"}
    </button>
  );

  return (
    <div className="font-sans">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex flex-1 items-center justify-between lg:justify-start gap-4 lg:gap-6 min-w-0">
          <h1 className="text-[32px]/none lg:text-4xl/none text-heading">Profile</h1>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 h-9 px-4 rounded-full border border-nav-muted/50 bg-white
              text-sm/none text-heading cursor-pointer motion-safe:transition-colors hover:bg-surface
              whitespace-nowrap"
          >
            Edit profile
            <Pencil className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
        {shareButton("hidden lg:flex")}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.16fr] gap-6 lg:gap-12 items-start">
        {/* Left column: identity + invite, then this week's quests. */}
        <div className="flex flex-col gap-6 min-w-0">
        {/* ── Identity + invite ───────────────────────────────────────────── */}
        <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] overflow-hidden min-w-0">
          <div className="relative p-6">
            {hasMedal ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={MEDALS[rank! - 1]}
                alt={`Rank ${rank}`}
                width={140}
                height={140}
                // Ribbon hangs from the card's top edge, like the mock.
                className="absolute top-0 right-7 w-26 h-26 pointer-events-none select-none"
              />
            ) : rank ? (
              <div
                title={`Rank ${rank}`}
                className="absolute top-6 right-6 font-anta rounded-full bg-surface text-heading
                  w-12 h-12 flex items-center justify-center text-sm"
              >
                {rank}
              </div>
            ) : null}

            <div className={`flex items-center gap-4 min-w-0 ${hasMedal ? "pr-26" : rank ? "pr-14" : ""}`}>
              <span className="relative shrink-0 leading-none">
                <Avatar
                  address={address}
                  username={profile?.username}
                  preset={profile?.avatar}
                  size={60}
                  ringColor="transparent"
                />
                {!verifying && isVerified && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src="/badge-verified.svg"
                    alt="Verified"
                    title="GoodDollar verified"
                    width={20}
                    height={20}
                    className="absolute bottom-0 right-0 pointer-events-none"
                  />
                )}
              </span>
              <div className="flex flex-col gap-y-2 min-w-0">
                {profile === undefined ? (
                  <Skeleton className="h-5 w-32" />
                ) : (
                  <span className="text-xl/none text-heading truncate">
                    {profile?.username ?? shortAddr(address)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => copy(address, "address")}
                  title="Copy address"
                  className="text-sm/none text-nav-muted truncate text-left cursor-pointer
                    motion-safe:transition-colors hover:text-heading"
                >
                  {copied === "address" ? "Address copied" : address}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mt-6">
              <Chip
                icon={<Flame className="text-streak" strokeWidth={2} />}
                value={String(streak?.current ?? 0)}
                label="Streaks"
                loading={streak === undefined}
              />
              <Chip
                icon={<Medal className="text-[#448754]" strokeWidth={2} />}
                value={`${earned}/${badges?.length ?? 0}`}
                label="Core badges"
                loading={badges === null}
              />
              <Chip
                icon={<Users className="text-brand" strokeWidth={2} />}
                value={String(data?.referralCount ?? 0)}
                label="Referred"
                loading={loading}
              />
              <Chip value={compact(data?.created ?? 0)} label="Drops created" loading={loading} />
              <Chip value={data ? formatG$(BigInt(data.totalClaimedWei)) : "0"} label="G$ claimed" loading={loading} />
              <Chip value={data ? formatG$(BigInt(data.totalDroppedWei)) : "0"} label="G$ dropped" loading={loading} />
            </div>
          </div>

          <div className="border-t border-line" />

          <div className="p-6">
            <h2 className="text-xl/none text-heading">Invite friends</h2>
            <p className="text-sm/[140%] text-nav-muted mt-3">
              Every neighbor you bring makes more drops appear near everyone.
            </p>

            {/* Referral banner */}
            <div
              className="relative overflow-hidden rounded-2xl mt-5 min-h-[60px] lg:min-h-[76px] flex items-center
                px-4 py-3 pr-16 lg:px-5 lg:py-4 lg:pr-22"
              style={{ background: "linear-gradient(90deg, #FAE8E6 0%, #FCEFE8 50%, #FDF5E8 100%)" }}
            >
              <div className="flex items-center gap-3 lg:gap-4 min-w-0">
                {!!data?.referredSample?.length && (
                  <div className="flex shrink-0">
                    {data.referredSample.slice(0, 3).map((a, i) => (
                      <span
                        key={a}
                        className={`relative rounded-full ring-2 ring-white ${i > 0 ? "-ml-2.5" : ""}`}
                        style={{ zIndex: 3 - i }}
                      >
                        <ProfileAvatar address={a} size={32} ringColor="transparent" />
                      </span>
                    ))}
                  </div>
                )}
                <div className="text-sm/[140%] text-nav-muted min-w-0">
                  {loading ? (
                    <Skeleton className="h-4 w-40 bg-white/60" />
                  ) : (
                    <>
                      <span className="text-heading">{data.referralCount}</span>
                      {/* The total comes from the whole board, which lands later —
                          read fine without it rather than show a placeholder word. */}
                      {!board.loading && totalPeople > 0 ? ` of ${roughCount(totalPeople)}` : ""}
                      {" GoodDroppers joined through you"}
                    </>
                  )}
                </div>
              </div>
              <BagMark className="absolute -right-2 top-[9px] w-14 h-14 lg:top-[11px] lg:w-[72px] lg:h-[72px] pointer-events-none" />
            </div>

            {/* Invite link */}
            <div className="flex flex-col lg:flex-row gap-3 mt-6">
              <div
                className="w-full lg:flex-1 min-w-0 h-11 rounded-full border border-line px-5 flex items-center
                  text-sm/none text-nav-muted"
                title={invite}
              >
                <span className="truncate">{inviteLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => copy(invite, "invite")}
                className="h-11 px-6 rounded-full text-sm/none text-heading flex items-center justify-center gap-2
                  shrink-0 cursor-pointer border border-transparent motion-safe:transition-opacity hover:opacity-80
                  whitespace-nowrap"
                style={{
                  background:
                    "linear-gradient(#fff, #fff) padding-box, linear-gradient(90deg, #F5C79B, #EEADF5) border-box",
                }}
              >
                {copied === "invite"
                  ? <Check className="w-[18px] h-[18px] text-brand" />
                  : <Copy className="w-[18px] h-[18px]" strokeWidth={1.75} />}
                {copied === "invite" ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        </section>

        {/* ── Weekly quests ───────────────────────────────────────────────── */}
        <QuestCard address={address} />
        </div>

        {/* ── Badges ──────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 min-w-0">
          <h2 className="text-xl/none text-heading mb-5">Badges</h2>
          <BadgeGrid badges={badges} selectedId={badge?.id ?? null} onSelect={setBadge} />
        </section>
      </div>

      <div className="lg:hidden flex justify-center mt-6">{shareButton("")}</div>

      {editing && <EditProfileModal address={address} onClose={() => setEditing(false)} />}

      {badge && (
        <div
          onClick={() => setBadge(null)}
          className="modal-fade-in fixed inset-0 z-[1400] bg-[#0000000A] backdrop-blur-md
            flex items-center justify-center p-4"
        >
          <BadgeViewer badge={badge} onClose={() => setBadge(null)} />
        </div>
      )}
    </div>
  );
}

/** Outlined stat chip: optional coloured icon, bold value, muted label. */
function Chip({
  icon, value, label, loading,
}: { icon?: React.ReactNode; value: string; label: string; loading: boolean }) {
  return (
    <div
      className="flex items-center gap-2 lg:gap-2.5 rounded-full border border-line bg-white min-w-0
        px-3.5 py-2.5 text-sm/none lg:px-4 lg:py-3 lg:text-base/none [&_svg]:w-[18px] [&_svg]:h-[18px] lg:[&_svg]:w-5 lg:[&_svg]:h-5"
    >
      {icon && <span className="shrink-0 leading-none">{icon}</span>}
      {loading ? (
        <Skeleton className="h-4 w-8" />
      ) : (
        <span className="text-heading">{value}</span>
      )}
      <span className="text-nav-muted whitespace-nowrap">{label}</span>
    </div>
  );
}

/**
 * The G-drop mark, washed into the banner's warm tint so it sits in the
 * banner rather than on it.
 */
function BagMark({ className }: { className?: string }) {
  return <BrandMark className={className} g="#F2BFA9" drop="#EEA9C6" />;
}
