import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRedis } from "@/lib/redis";
import { getEvent } from "@/lib/eventStore";
import { CATEGORY_LABEL, isEventId } from "@/lib/events";
import EventPageClient from "./EventPageClient";

interface PageProps { params: Promise<{ id: string }> }

/** Only approved (or cancelled) events are public; anything else gets generic metadata. */
async function publicEventFor(id: string) {
  if (!isEventId(id)) return null;
  try {
    const redis = getRedis();
    const e = redis ? await getEvent(redis, id) : null;
    return e && (e.status === "approved" || e.status === "cancelled") ? e : null;
  } catch { return null; }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const e = await publicEventFor(id);
  if (!e) return { title: "Event", robots: { index: false } };

  const when = new Date(e.startsAt * 1000).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
  const title = e.status === "cancelled" ? `${e.title} (cancelled)` : e.title;
  const description = `${CATEGORY_LABEL[e.category]} · ${when} · ${e.venueName}. ${e.budgetG.toLocaleString("en-US")} G$ of drops to find. ${e.description.slice(0, 120)}`.trim();
  return {
    title,
    description,
    alternates: { canonical: `/events/${id}` },
    openGraph: { title, description, type: "website", url: `/events/${id}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EventPage({ params }: PageProps) {
  const { id } = await params;
  if (!isEventId(id)) notFound();
  return <EventPageClient id={id} />;
}
