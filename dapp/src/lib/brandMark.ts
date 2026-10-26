// The GoodDrops mark: a geometric G with an orange drop set into its left side,
// pointing in. Pure paths (no masks or clip-paths) so the exact same geometry
// renders in React, in next/og ImageResponse (favicon, app icons, OG cards)
// and as the static files in /public. Generated on a 512 grid; regenerate the
// whole set together rather than hand-editing one path.

export const MARK_VIEWBOX = "0 0 512 512";

/** Upper arm of the G, from the drop notch to the rounded terminal. */
export const MARK_G_TOP =
  "M96.71 154.70 A 200 200 0 0 1 422.37 127.44 A 47.0 47.0 0 0 1 350.36 187.86 A 106 106 0 0 0 178.12 201.71 Z";

/** Lower arm of the G with its crossbar. */
export const MARK_G_BOTTOM =
  "M96.71 357.30 A 200 200 0 0 0 467.83 233.00 L 326.16 233.00 A 47.0 47.0 0 0 0 326.16 327.00 L 347.87 327.00 A 106 106 0 0 1 178.12 310.29 Z";

/** The drop. */
export const MARK_DROP =
  "M236.16 256.00 L 140.16 200.57 A 64 64 0 1 0 140.16 311.43 Z";

export const BRAND_BLUE = "#2727E2";
export const BRAND_SPARK = "#FF9825";

/** The mark as a standalone SVG string (for static files and data URIs). */
export function markSvg(g = BRAND_BLUE, dropColor = BRAND_SPARK, size = 512): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}">` +
    `<path d="${MARK_G_TOP}" fill="${g}"/><path d="${MARK_G_BOTTOM}" fill="${g}"/>` +
    `<path d="${MARK_DROP}" fill="${dropColor}"/></svg>`;
}
