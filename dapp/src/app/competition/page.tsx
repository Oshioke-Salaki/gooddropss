"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Nav } from "@/components/Nav";
import { inviteUrl } from "@/lib/referral";
import { useAuth } from "@/hooks/useAuth";
import { Trophy, UserPlus } from "lucide-react";
import { PointsBoard } from "./PointsBoard";
import { ReferralBoard } from "./ReferralBoard";
import { PhasePill, type Phase } from "./shared";
import { OffSeasonCard, OffSeasonSkeleton, useSeasonStatus } from "./OffSeason";

type Tab = "points" | "referrals";
const TAB_KEY = "gd:comp:tab";

const TABS: { id: Tab; label: string; Icon: typeof Trophy }[] = [
  { id: "points", label: "Points", Icon: Trophy },
  { id: "referrals", label: "Referrals", Icon: UserPlus },
];

// Two competitions run side by side, each with its own pot, rules and leaderboard.
// Only the selected board is mounted, so the other one never fetches or renders —
// switching tabs costs one request, not two.
export default function CompetitionPage() {
  const { address } = useAccount();
  const { login } = useAuth();
  const [tab, setTab] = useState<Tab>("points");
  // The mounted board reports its phase up so the header pill can show it.
  const [phase, setPhase] = useState<Phase | null>(null);
  // Between seasons the boards are hidden behind a short "nothing running"
  // card. The full UI is one click away ("last season's standings") and returns
  // on its own when the next window opens — nothing is removed.
  const season = useSeasonStatus();
  const [showPast, setShowPast] = useState(false);
  const boardsVisible = season?.live || showPast;

  // Remember the last tab within the session so a refresh doesn't bounce the user
  // back. Read after mount to keep server and first client render identical.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TAB_KEY);
      if (saved === "points" || saved === "referrals") setTab(saved);
    } catch { /* storage blocked — default tab is fine */ }
  }, []);
  function pick(next: Tab) {
    setTab(next);
    try { sessionStorage.setItem(TAB_KEY, next); } catch { /* ignore */ }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "https://gooddrops.xyz";
  const myLink = address ? inviteUrl(origin, address) : "";
  const index = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-32">
          {/* Header: title + phase, and the competition switcher */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div className="flex items-center gap-4 min-w-0">
              <h1 className="text-[32px]/none lg:text-4xl/none text-heading">Competition</h1>
              {boardsVisible
                ? <PhasePill phase={phase ?? "upcoming"} loading={phase === null} />
                : season && (
                  <span className="h-9 px-4 rounded-full bg-white text-sm/none text-nav-muted flex items-center">
                    Off-season
                  </span>
                )}
            </div>
            {/* Same sliding pill as the leaderboard toggle, with these two tabs. */}
            {boardsVisible && (
            <div
              role="tablist"
              aria-label="Competitions"
              className="relative bg-white rounded-full p-1 flex items-center w-full lg:w-fit shrink-0"
            >
              <div
                aria-hidden
                className="absolute top-1 left-1 h-10 w-[calc(50%-4px)] lg:w-35 rounded-full bg-brand
                  motion-safe:transition-transform motion-safe:duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ transform: `translateX(${index * 100}%)` }}
              />
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => pick(id)}
                  className={`relative z-10 h-10 flex-1 lg:flex-none lg:w-35 flex items-center justify-center gap-x-3.5 rounded-full text-sm/none cursor-pointer
                    motion-safe:transition-colors ${tab === id ? "text-white" : "text-nav-muted hover:text-heading"}`}
                >
                  <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            )}
          </div>

          {season === null ? (
            <OffSeasonSkeleton />
          ) : !boardsVisible ? (
            <OffSeasonCard hasPast={season.hasPast} onShowPast={() => setShowPast(true)} />
          ) : tab === "points"
            ? <PointsBoard address={address} myLink={myLink} onSwitch={() => pick("referrals")} onSignIn={login} onPhase={setPhase} />
            : <ReferralBoard address={address} myLink={myLink} onSwitch={() => pick("points")} onSignIn={login} onPhase={setPhase} />}
        </div>
      </div>
    </div>
  );
}
