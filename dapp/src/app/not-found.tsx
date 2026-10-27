import type { Metadata } from "next";
import Link from "next/link";
import { Map, CalendarDays, Trophy, ChartNoAxesColumn, MapPinOff, ChevronRight } from "lucide-react";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

const ELSEWHERE = [
  { href: "/events", label: "Events", hint: "Hunts at meetups and shows", Icon: CalendarDays },
  { href: "/leaderboard", label: "Rankings", hint: "Top hunters and droppers", Icon: Trophy },
  { href: "/stats", label: "Stats", hint: "G$ found across GoodDrops", Icon: ChartNoAxesColumn },
] as const;

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <main className="pt-nav px-4 pb-10 flex items-center justify-center min-h-[calc(100dvh-var(--spacing-nav))]">
        <div className="w-full max-w-[460px] flex flex-col gap-3">
          <section className="bg-white rounded-3xl p-6 sm:p-8 shadow-[0px_0px_12px_0px_#0000000A] flex flex-col items-center text-center">
            <div className="relative">
              <p aria-hidden className="font-anta text-[88px]/none sm:text-[104px]/none tracking-tight text-brand-soft select-none">404</p>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-14 h-14 rounded-full bg-brand text-white flex items-center justify-center shadow-[0px_8px_24px_0px_#2727E240]">
                  <MapPinOff className="w-6 h-6" strokeWidth={1.75} />
                </span>
              </span>
            </div>
            <h1 className="text-xl/none sm:text-2xl/none text-heading mt-6">Nothing hidden here</h1>
            <p className="text-sm/[150%] text-nav-muted mt-3 max-w-[340px]">
              This page doesn&apos;t exist, or the link is broken. The live drops are waiting on the map.
            </p>
            <Link
              href="/"
              className="mt-6 h-12 w-full sm:w-auto px-7 rounded-full bg-brand text-white text-base/none flex items-center justify-center gap-2 motion-safe:transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
            >
              <Map className="w-[18px] h-[18px]" strokeWidth={1.75} />
              Back to the map
            </Link>
          </section>

          <nav aria-label="Other places to go" className="bg-white rounded-3xl p-2 shadow-[0px_0px_12px_0px_#0000000A]">
            {ELSEWHERE.map(({ href, label, hint, Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 min-h-14 px-3 py-2 rounded-2xl motion-safe:transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <span className="w-10 h-10 shrink-0 rounded-full bg-surface text-heading flex items-center justify-center group-hover:bg-white motion-safe:transition-colors">
                  <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base/none text-heading">{label}</span>
                  <span className="block text-xs/none text-nav-muted mt-1.5 truncate">{hint}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-nav-muted shrink-0 motion-safe:transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </nav>
        </div>
      </main>
    </div>
  );
}
