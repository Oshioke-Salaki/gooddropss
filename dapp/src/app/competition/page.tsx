"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Nav, BottomNav } from "@/components/Nav";
import { inviteUrl } from "@/lib/referral";
import { Trophy, UserPlus } from "lucide-react";
import clsx from "clsx";
import { PointsBoard } from "./PointsBoard";
import { ReferralBoard } from "./ReferralBoard";

type Tab = "points" | "referrals";
const TAB_KEY = "gd:comp:tab";

// Two competitions run side by side, each with its own pot, rules and leaderboard.
// Only the selected board is mounted, so the other one never fetches or renders —
// switching tabs costs one request, not two.
export default function CompetitionPage() {
  const { address } = useAccount();
  const [tab, setTab] = useState<Tab>("points");

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

  const tabs: { id: Tab; label: string; Icon: typeof Trophy }[] = [
    { id: "points", label: "Points", Icon: Trophy },
    { id: "referrals", label: "Referrals", Icon: UserPlus },
  ];

  return (
    <div className="min-h-screen bg-cream pb-24">
      <Nav />
      <div className="max-w-screen-md mx-auto px-4 pt-20 pb-8">

        {/* Competition switcher */}
        <div role="tablist" aria-label="Competitions"
          className="grid grid-cols-2 gap-1 p-1 mb-4 border-2 border-ink rounded-2xl bg-card shadow-brutal-sm">
          {tabs.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                onClick={() => pick(id)}
                className={clsx(
                  "flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-black text-sm transition-colors",
                  active ? "bg-ink text-lime" : "text-muted hover:bg-cream",
                )}
              >
                <Icon size={15} /> {label}
              </button>
            );
          })}
        </div>

        {tab === "points"
          ? <PointsBoard address={address} myLink={myLink} onSwitch={() => pick("referrals")} />
          : <ReferralBoard address={address} myLink={myLink} onSwitch={() => pick("points")} />}
      </div>
      <BottomNav />
    </div>
  );
}
