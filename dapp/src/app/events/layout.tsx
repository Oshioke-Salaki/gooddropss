import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Events",
  description: "Meetups, concerts and campus days with real G$ hidden around them. See what's on, how much is up for grabs, and go hunt.",
  alternates: { canonical: "/events" },
  openGraph: {
    title: "Events on GoodDrops",
    description: "Meetups, concerts and campus days with real G$ hidden around them.",
    url: "/events",
  },
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
