"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Landmark } from "@/types";

// Responsive admin chrome: a left sidebar on desktop, a sticky horizontal tab
// strip on mobile. Wraps every /admin/* page (after the password gate) so the
// whole console shares one navigation surface. Pages keep their own content and
// dark background; this only owns the nav.
const NAV: { href: string; label: string; icon: string; exact?: boolean; key?: string }[] = [
  { href: "/admin",             label: "Overview",    icon: "🏠", exact: true },
  { href: "/admin/suggestions", label: "Suggestions", icon: "💡", key: "suggestions" },
  { href: "/admin/places",      label: "Places",      icon: "🏷️" },
  { href: "/admin/analytics",   label: "Analytics",   icon: "📊" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);

  // Live pending-suggestion count for the Suggestions badge. Refreshes on the
  // shared landmarks-updated event (fires after any approve/reject) and on a
  // slow interval so the badge stays honest without hammering the API.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/landmarks?scope=all")
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const list = Array.isArray(d.landmarks) ? (d.landmarks as Landmark[]) : [];
          setPending(list.filter((l) => l.status === "pending").length);
        })
        .catch(() => {});
    load();
    const onUpd = () => load();
    window.addEventListener("gd:landmarks-updated", onUpd);
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      window.removeEventListener("gd:landmarks-updated", onUpd);
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#111] md:flex">
      {/* Sidebar (desktop) / top tab strip (mobile) */}
      <aside
        className="sticky top-0 z-40 border-b border-[#222] bg-[#0e0e0e]/95 backdrop-blur
                   md:min-h-[100dvh] md:w-56 md:flex-shrink-0 md:border-b-0 md:border-r"
        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
      >
        <div className="hidden px-5 pb-4 pt-6 md:block">
          <p className="text-lg font-black leading-none text-[#BFFD00]">GoodDrops</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#555]">Admin</p>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:overflow-visible md:px-3 md:py-0"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const showBadge = item.key === "suggestions" && pending > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-extrabold transition-colors ${
                  active ? "bg-[#BFFD00] text-[#111]" : "text-[#9a9a9a] hover:bg-[#1c1c1c] hover:text-white"
                }`}
              >
                <span aria-hidden>{item.icon}</span>
                <span>{item.label}</span>
                {showBadge && (
                  <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[#FF5C5C] px-1.5 text-[11px] font-black leading-[18px] text-white md:ml-auto">
                    {pending > 99 ? "99+" : pending}
                  </span>
                )}
              </Link>
            );
          })}
          {/* Escape hatch back to the live map — every admin page needs it. */}
          <Link
            href="/"
            className="flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-extrabold text-[#666] transition-colors hover:bg-[#1c1c1c] hover:text-white md:mt-2 md:border-t md:border-[#222] md:pt-4"
          >
            <span aria-hidden>←</span>
            <span>Map</span>
          </Link>
        </nav>
      </aside>

      {/* Page content */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
