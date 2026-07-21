import type { Metadata } from "next";
import { fetchDropByDropId } from "@/lib/subgraph";
import { formatG$, parseDropHint } from "@/lib/utils";
import DropPageClient from "./DropPageClient";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const drop = await fetchDropByDropId(id);
  if (!drop) return { title: "Drop not found" };

  const { hint } = parseDropHint(drop.hint);
  const amount = `${formatG$(drop.amount)} G$`;
  const title = `${amount} hidden somewhere 💰`;
  const description = hint
    ? `Clue: "${hint}" — Find it on GoodDrops.`
    : `${amount} is locked at a real-world GPS location. First to arrive claims it.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function DropPage({ params }: PageProps) {
  const { id } = await params;
  return <DropPageClient dropId={id} />;
}
