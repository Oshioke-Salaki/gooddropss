// Single source of truth for the canonical site origin. Used by metadata,
// robots and sitemap so OpenGraph/canonical URLs resolve to the real domain
// instead of the Vercel preview URL.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://gooddrops.xyz")
).replace(/\/$/, "");

export const SITE_NAME = "GoodDrops";
export const X_HANDLE  = "@gooddropss";
