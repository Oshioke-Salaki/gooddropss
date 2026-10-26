"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Lightbulb, Flag, Tag, Store, Medal, ChartColumn, Gift, HeartPulse, Map, LogOut, Equal, X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type { Landmark, Spot } from "@/types";
import { spotStatus } from "@/lib/spotStatus";
import { Logo } from "@/components/Logo";
import { CountBadge } from "@/components/admin/ui";

// The admin console's chrome: a white sidebar at lg and up, a top bar with a
// menu below it (the links drop down as a pill rail, like the public nav). It
// wraps every /admin/* page after the password gate, so the whole console shares
// one navigation surface and one background.
const NAV: { href: string; label: string; Icon: LucideIcon; badge?: "suggestions" | "reports" | "businesses" }[] = [
  { href: "/admin/suggestions", label: "Suggestions", Icon: Lightbulb,   badge: "suggestions" },
  { href: "/admin/reports",     label: "Reports",     Icon: Flag,        badge: "reports" },
  { href: "/admin/places",      label: "Places",      Icon: Tag },
  { href: "/admin/businesses",  label: "Businesses",  Icon: Store,       badge: "businesses" },
  { href: "/admin/badges",      label: "Badges",      Icon: Medal },
  { href: "/admin/analytics",   label: "Analytics",   Icon: ChartColumn },
  { href: "/admin/competition", label: "Competition", Icon: Gift },
  { href: "/admin/health",      label: "Health",      Icon: HeartPulse },
];

const LINK = "flex items-center gap-2.5 rounded-full px-4 py-3 text-sm/none whitespace-nowrap motion-safe:transition-colors cursor-pointer";
const LINK_IDLE = "text-nav-muted hover:bg-surface hover:text-heading";
const LINK_ACTIVE = "bg-nav-active-bg text-nav-active";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);
  const [reports, setReports] = useState(0);
  const [pendingBiz, setPendingBiz] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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

  // Navigating closes the phone menu; Escape does too.
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try { await fetch("/api/admin/logout", { method: "POST" }); } catch { /* reload re-checks the cookie anyway */ }
    window.location.reload();
  }

  const countFor = (badge?: "suggestions" | "reports" | "businesses") =>
    badge === "suggestions" ? pending : badge === "reports" ? reports : badge === "businesses" ? pendingBiz : 0;

  const links = NAV.map(({ href, label, Icon, badge }) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={clsx(LINK, "shrink-0", active ? LINK_ACTIVE : LINK_IDLE)}
      >
        <Icon size={18} strokeWidth={1.75} className="shrink-0" />
        <span>{label}</span>
        <span className="lg:ml-auto"><CountBadge n={countFor(badge)} /></span>
      </Link>
    );
  });

  return (
    <div className="min-h-dvh bg-surface font-sans lg:flex">
      {/* ── Sidebar (lg+) ─────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-col w-[240px] shrink-0 sticky top-0 h-dvh bg-white border-r border-line px-4 py-6">
        <div className="flex items-center justify-between px-2">
          <Logo size="md" />
          <span className="rounded-full bg-brand-soft text-brand text-xs/none px-2.5 py-1.5">Admin</span>
        </div>
        <nav className="flex flex-col gap-1 mt-8" aria-label="Admin sections">{links}</nav>
        <div className="mt-auto pt-4 border-t border-line flex flex-col gap-1">
          <Link href="/" className={clsx(LINK, LINK_IDLE)}>
            <Map size={18} strokeWidth={1.75} /> Back to map
          </Link>
          <button type="button" onClick={signOut} disabled={signingOut} className={clsx(LINK, LINK_IDLE, "disabled:opacity-50")}>
            <LogOut size={18} strokeWidth={1.75} /> {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      {/* ── Top bar (below lg) ────────────────────────────────────────────── */}
      <header className="lg:hidden sticky top-0 z-40 bg-white border-b border-line">
        <div className="flex items-center justify-between gap-3 px-4 h-nav">
          <div className="flex items-center gap-3 min-w-0">
            <Logo size="md" />
            <span className="rounded-full bg-brand-soft text-brand text-xs/none px-2.5 py-1.5">Admin</span>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="admin-mobile-links"
            className="w-10 h-10 rounded-full bg-nav-controls text-heading flex items-center justify-center cursor-pointer"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Equal className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div id="admin-mobile-links" className="border-t border-line shadow-[0px_4px_12px_0px_#0000000A] bg-white">
            <div className="no-scrollbar flex items-center overflow-x-auto px-4 py-3 gap-1">
              {links}
              <Link href="/" className={clsx(LINK, LINK_IDLE, "shrink-0")}>
                <Map size={18} strokeWidth={1.75} /> Map
              </Link>
              <button type="button" onClick={signOut} disabled={signingOut} className={clsx(LINK, LINK_IDLE, "shrink-0 disabled:opacity-50")}>
                <LogOut size={18} strokeWidth={1.75} /> Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
