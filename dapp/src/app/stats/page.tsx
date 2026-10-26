import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { getPublicStats, type PublicStats } from "./data";
import { StatsClient } from "./StatsClient";

// Rendered per request: the numbers come through Redis (uncacheable fetches),
// which can't run inside a timed static rebuild. getPublicStats is memoised
// for 60s per server instance, so this stays cheap; the client keeps it live.
export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("en");

export async function generateMetadata(): Promise<Metadata> {
  const s = await getPublicStats().catch(() => null);
  const description = s
    ? `${fmt(s.drops)} drops hidden, ${fmt(s.claimedG)} G$ found by ${fmt(s.hunters)} hunters. Live numbers from GoodDrops, the real-world treasure hunt for GoodDollar.`
    : "Live numbers from GoodDrops, the real-world treasure hunt for GoodDollar.";
  return {
    title: "GoodDrops in numbers",
    description,
    alternates: { canonical: "/stats" },
    openGraph: { title: "GoodDrops in numbers", description, url: "/stats" },
    twitter: { card: "summary_large_image", title: "GoodDrops in numbers", description },
  };
}

export default async function StatsPage() {
  // A subgraph blip shouldn't 500 the page — the client fetches and retries.
  const initial: PublicStats | null = await getPublicStats().catch(() => null);
  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-20">
          <StatsClient initial={initial} />
        </div>
      </div>
    </div>
  );
}
