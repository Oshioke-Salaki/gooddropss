import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Stable, public, indexable routes. Drop pages are intentionally excluded — they
// expire (1h–30d), so listing them would fill the sitemap with dead URLs.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: { path: string; changeFrequency: "daily" | "weekly"; priority: number }[] = [
    { path: "/",            changeFrequency: "daily",  priority: 1.0 },
    { path: "/leaderboard", changeFrequency: "daily",  priority: 0.8 },
    { path: "/merchant",    changeFrequency: "weekly", priority: 0.6 },
    { path: "/sponsor",     changeFrequency: "weekly", priority: 0.6 },
  ];

  return routes.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));
}
