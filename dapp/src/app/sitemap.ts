import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { getRedis, keys } from "@/lib/redis";

// Stable, public, indexable routes. Drop pages are intentionally excluded — they
// expire (1h–30d), so listing them would fill the sitemap with dead URLs. Event
// pages are included while they're upcoming or recent: they're public, have
// real content and are worth finding by search.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const routes: { path: string; changeFrequency: "daily" | "weekly"; priority: number }[] = [
    { path: "/",            changeFrequency: "daily",  priority: 1.0 },
    { path: "/events",      changeFrequency: "daily",  priority: 0.9 },
    { path: "/leaderboard", changeFrequency: "daily",  priority: 0.8 },
    { path: "/stats",       changeFrequency: "daily",  priority: 0.7 },
    { path: "/merchant",    changeFrequency: "weekly", priority: 0.6 },
    { path: "/sponsor",     changeFrequency: "weekly", priority: 0.6 },
  ];

  const out: MetadataRoute.Sitemap = routes.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  }));

  // Approved events from the last 30 days onward. A storage blip just means a
  // shorter sitemap this hour, never a failed one.
  try {
    const redis = getRedis();
    if (redis) {
      const since = Math.floor(Date.now() / 1000) - 30 * 86_400;
      const ids = await redis.zrange<string[]>(keys.eventsPublic(), since, "+inf", { byScore: true });
      for (const id of ids.slice(0, 500)) {
        out.push({ url: `${SITE_URL}/events/${id}`, lastModified: now, changeFrequency: "daily", priority: 0.7 });
      }
    }
  } catch { /* static routes still ship */ }

  return out;
}
