"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Nav } from "@/components/Nav";
import { useProfiles, useMyProfile } from "@/hooks/useProfile";
import { useLeaderboard } from "./useLeaderboard";
import { LeaderboardToggle } from "./components/LeaderboardToggle";
import { TotalCard } from "./components/TotalCard";
import { StatChip } from "./components/StatChip";
import { LeaderboardSearch } from "./components/LeaderboardSearch";
import { Podium } from "./components/Podium";
import { RankRow, RankRowSkeleton } from "./components/RankRow";
import { MeBar } from "./components/MeBar";
import { fullG } from "./components/format";
import { TAB_COPY, type Tab } from "./components/types";

const TAB_KEY = "gd:leaderboardTab";
const PAGE = 25;

export default function LeaderboardPage() {
  const { address: me } = useAccount();
  const { needsName } = useMyProfile();
  const {
    droppers,
    hunters,
    droppedWei,
    claimedWei,
    totalDrops,
    totalClaims,
    loading,
  } = useLeaderboard();

  const [tab, setTab] = useState<Tab>("droppers");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE);

  // Remember the tab for the session, so bouncing to a profile and back doesn't
  // dump you on the other board. Read after mount — sessionStorage on the first
  // render would break hydration.
  useEffect(() => {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved === "droppers" || saved === "hunters") setTab(saved);
  }, []);
  useEffect(() => {
    sessionStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  const entries = tab === "droppers" ? droppers : hunters;
  const copy = TAB_COPY[tab];

  // One batched request for every ranked wallet's username — needed to render the
  // rows AND to search by name. Without it each row would fetch its own profile.
  const addresses = useMemo(() => entries.map((e) => e.address), [entries]);
  const profiles = useProfiles(addresses);

  // Rank is the position on the FULL board, so filtering never renumbers anyone.
  const ranked = useMemo(
    () => entries.map((entry, i) => ({ entry, rank: i + 1 })),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(({ entry }) => {
      const username =
        profiles[entry.address.toLowerCase()]?.username?.toLowerCase();
      return (
        entry.address.toLowerCase().includes(q) ||
        (username?.includes(q) ?? false)
      );
    });
  }, [ranked, query, profiles]);

  // A new tab or query means a new list — start it from the top again.
  useEffect(() => {
    setVisible(PAGE);
  }, [tab, query]);

  // The podium only makes sense whole, and only on the unfiltered board: while
  // searching, "1st / 2nd / 3rd" medals beside arbitrary matches would be a lie.
  const showPodium = !query.trim() && filtered.length >= 3;
  const podium = showPodium ? filtered.slice(0, 3) : [];
  const rest = showPodium ? filtered.slice(3) : filtered;
  const shown = rest.slice(0, visible);

  const myRow = useMemo(
    () =>
      me
        ? ranked.find(
            ({ entry }) => entry.address.toLowerCase() === me.toLowerCase(),
          )
        : undefined,
    [ranked, me],
  );

  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />

      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-32">
          {/* Controls */}
          <div className="flex flex-col-reverse lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
            <LeaderboardToggle tab={tab} onChange={setTab} />
            <TotalCard
              value={fullG(tab === "droppers" ? droppedWei : claimedWei)}
              label={copy.totalLabel}
              loading={loading}
            />
          </div>

          {/* Board */}
          <div className="bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] overflow-hidden">
            <div className="p-6 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
              <div className="flex items-center justify-center lg:justify-start gap-x-2 lg:gap-x-4 w-full lg:w-auto lg:overflow-x-auto no-scrollbar">
                <StatChip
                  value={entries.length}
                  label={copy.activeLabel}
                  shortLabel={copy.activeLabelShort}
                  loading={loading}
                />
                <StatChip
                  value={tab === "droppers" ? totalDrops : totalClaims}
                  label={copy.totalCountLabel}
                  shortLabel={copy.totalCountLabelShort}
                  loading={loading}
                />
              </div>
              <LeaderboardSearch
                value={query}
                onChange={setQuery}
                placeholder={copy.searchPlaceholder}
              />
            </div>

            {loading ? (
              <>
                <Podium entries={[]} unit={copy.unit} loading />
                {Array.from({ length: 6 }, (_, i) => (
                  <RankRowSkeleton key={i} />
                ))}
              </>
            ) : filtered.length === 0 ? (
              <div className="border-t border-line px-6 py-20 text-center">
                <p className="text-lg/none text-heading mb-3">
                  {query.trim() ? "No matches" : copy.emptyTitle}
                </p>
                <p className="text-sm/none text-nav-muted">
                  {query.trim()
                    ? `Nothing here matches "${query.trim()}".`
                    : copy.emptyBody}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop only: the three-across podium. Below lg it collapses
                    into ordinary rows whose rank chip is the medal itself, which
                    is why the top three are re-included in `shownMobile`. */}
                {showPodium && (
                  <div className="hidden lg:block">
                    <Podium
                      entries={podium.map((p) => p.entry)}
                      unit={copy.unit}
                      loading={false}
                    />
                  </div>
                )}

                <div
                  className={
                    showPodium
                      ? "lg:border-t-0 border-t border-line"
                      : "border-t border-line"
                  }
                >
                  {showPodium &&
                    podium.map(({ entry, rank }) => (
                      <RankRow
                        key={entry.address}
                        className="lg:hidden"
                        rank={rank}
                        entry={entry}
                        unit={copy.unit}
                        isMe={
                          !!me &&
                          entry.address.toLowerCase() === me.toLowerCase()
                        }
                      />
                    ))}
                  {shown.map(({ entry, rank }) => (
                    <RankRow
                      key={entry.address}
                      rank={rank}
                      entry={entry}
                      unit={copy.unit}
                      isMe={
                        !!me && entry.address.toLowerCase() === me.toLowerCase()
                      }
                    />
                  ))}
                </div>

                {rest.length > visible && (
                  <div className="p-6 flex justify-center">
                    <button
                      onClick={() => setVisible((v) => v + PAGE)}
                      className="rounded-full bg-surface hover:bg-nav-controls px-6 py-3 text-sm/none text-heading
                        cursor-pointer motion-safe:transition-colors"
                    >
                      Show {Math.min(PAGE, rest.length - visible)} more
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Your standing — only once the board is real and you're actually on it. */}
      {!loading && myRow && (
        <MeBar
          rank={myRow.rank}
          entry={myRow.entry}
          unit={copy.unit}
          needsName={needsName}
        />
      )}
    </div>
  );
}
