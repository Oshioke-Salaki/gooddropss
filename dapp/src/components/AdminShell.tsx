"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Landmark, Spot } from "@/types";
import { spotStatus } from "@/lib/spotStatus";

// Responsive admin chrome: a left sidebar on desktop, a sticky horizontal tab
// strip on mobile. Wraps every /admin/* page (after the password gate) so the
// whole console shares one navigation surface. Light theme throughout — the shell
// paints a cream background so pages that don't set their own inherit it.
const NAV: { href: string; label: string; icon: string; badge?: "suggestions" | "reports" | "businesses" }[] = [
  { href: "/admin/suggestions", label: "Suggestions", icon: "💡", badge: "suggestions" },
  { href: "/admin/reports",     label: "Reports",     icon: "🚩", badge: "reports" },
  { href: "/admin/places",      label: "Places",      icon: "🏷️" },
  { href: "/admin/businesses",  label: "Businesses",  icon: "🏪", badge: "businesses" },
  { href: "/admin/badges",      label: "Badges",      icon: "🏅" },
  { href: "/admin/analytics",   label: "Analytics",   icon: "📊" },
  { href: "/admin/competition", label: "Competition", icon: "🎁" },
  { href: "/admin/health",      label: "Health",      icon: "🩺" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);
  const [reports, setReports] = useState(0);
  const [pendingBiz, setPendingBiz] = useState(0);

  // Live badge counts. Suggestions = pending landmarks; Reports = flagged drops.
  // Refresh on the shared update events + a slow interval so they stay honest
  // without hammering the API.
  useEffect(() => {
    let alive = true;
    const loadSuggestions = () =>
      fetch("/api/landmarks?scope=all")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const list = Array.isArray(d.landmarks) ? (d.landmarks as Landmark[]) : [];
          setPending(list.filter((l) => l.status === "pending").length);
        })
        .catch(() => {});
    const loadReports = () =>
      fetch("/api/moderation")
        .then((r) => (r.ok ? r.json() : { reported: [] }))
        .then((d) => { if (alive && Array.isArray(d.reported)) setReports(d.reported.length); })
        .catch(() => {});
    const loadBusinesses = () =>
      fetch("/api/spots?scope=all")
        .then((r) => (r.ok ? r.json() : { spots: [] }))
        .then((d) => {
          if (!alive) return;
          const list = Array.isArray(d.spots) ? (d.spots as Spot[]) : [];
          setPendingBiz(list.filter((s) => spotStatus(s) === "pending").length);
        })
        .catch(() => {});
    const loadAll = () => { loadSuggestions(); loadReports(); loadBusinesses(); };
    loadAll();
    window.addEventListener("gd:landmarks-updated", loadSuggestions);
    window.addEventListener("gd:moderation-updated", loadReports);
    window.addEventListener("gd:businesses-updated", loadBusinesses);
    const t = setInterval(loadAll, 120_000);
    return () => {
      alive = false;
      window.removeEventListener("gd:landmarks-updated", loadSuggestions);
      window.removeEventListener("gd:moderation-updated", loadReports);
      window.removeEventListener("gd:businesses-updated", loadBusinesses);
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-cream md:flex">
      {/* Sidebar (desktop) / top tab strip (mobile) */}
      <aside
        className="sticky top-0 z-40 border-b-2 border-[#111] bg-white/95 backdrop-blur
                   md:min-h-[100dvh] md:w-56 md:flex-shrink-0 md:border-b-0 md:border-r-2"
        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
      >
        <div className="hidden px-5 pb-4 pt-6 md:block">
          <p className="text-lg font-black leading-none text-[#111]">GoodDrops</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#999]">Admin</p>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:px-3 md:py-0"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const badgeCount = item.badge === "suggestions" ? pending : item.badge === "reports" ? reports : item.badge === "businesses" ? pendingBiz : 0;
            const showBadge = badgeCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-extrabold transition-colors ${
                  active ? "bg-[#BFFD00] text-[#111] border-2 border-[#111]" : "text-[#555] hover:bg-[#eeede8] hover:text-[#111]"
                }`}
              >
                <span aria-hidden>{item.icon}</span>
                <span>{item.label}</span>
                {showBadge && (
                  <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[#FF5C5C] px-1.5 text-[11px] font-black leading-[18px] text-white md:ml-auto">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
          {/* Escape hatch back to the live map — every admin page needs it. */}
          <Link
            href="/"
            className="flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-[#888] transition-colors hover:bg-[#eeede8] hover:text-[#111] md:mt-2 md:border-t-2 md:border-[#e5e4df] md:pt-4"
          >
            <span aria-hidden>←</span>
            <span>Map</span>
          </Link>
        </nav>
      </aside>

      {/* Page content */}
      <main className="min-w-0 flex-1 bg-cream">{children}</main>
    </div>
  );
}
