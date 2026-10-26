import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { getUsername } from "@/lib/serverProfile";
import { shortAddr } from "@/lib/utils";
import { HunterProfileClient } from "./HunterProfileClient";

interface PageProps { params: Promise<{ address: string }> }

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

// Metadata is server-rendered so shares and crawlers get a real title; the body
// itself is the same client `ProfileContent` the drawer uses, fed by /api/hunter
// (which carries its own CDN cache).
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { address } = await params;
  const username = await getUsername(address);
  const name = username ? `@${username}` : shortAddr(address);
  const canonical = `/hunter/${address.toLowerCase()}`;
  return {
    title: `${name} — Hunter`,
    description: `See ${name}'s GoodDrops stats, achievements and claim history — real G$ found in the wild.`,
    alternates: { canonical },
    openGraph: {
      title: `${name} — GoodDrops Hunter`,
      description: `${name}'s GoodDrops stats, achievements and claim history.`,
      url: canonical,
      type: "profile",
    },
  };
}

export default async function HunterPage({ params }: PageProps) {
  const { address } = await params;
  if (!ADDR_RE.test(address)) notFound();

  return (
    <div className="min-h-screen bg-surface font-sans">
      <Nav />
      <div className="pt-nav">
        <div className="px-4 lg:px-15 pt-10 pb-20">
          <HunterProfileClient address={address.toLowerCase()} />
        </div>
      </div>
    </div>
  );
}
