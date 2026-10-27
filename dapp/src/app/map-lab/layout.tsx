import type { Metadata } from "next";

// Private preview of the next map. Reachable by URL only; never indexed.
export const metadata: Metadata = {
  title: "Map lab",
  robots: { index: false, follow: false },
};

export default function MapLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
