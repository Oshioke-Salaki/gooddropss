import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/Providers";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SITE_URL, SITE_NAME, X_HANDLE } from "@/lib/site";

const TITLE = "GoodDrops — Find hidden G$ in the wild";
const DESCRIPTION =
  "Hide GoodDollar tokens at real-world GPS coordinates. Verified humans hunt them down and claim the reward — real money, real places.";

// Fonts are self-hosted from /public/fonts (see the @font-face rules in
// globals.css), so builds never depend on reaching Google Fonts.
const FONT_PRELOADS = ["/fonts/dm-sans-latin.woff2", "/fonts/anta-latin.woff2"];

export const viewport: Viewport = {
  themeColor: "#F8F8F8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: TITLE,
    // Child pages set just their name; this appends " · GoodDrops".
    template: "%s · GoodDrops",
  },
  description: DESCRIPTION,
  keywords: [
    "GoodDrops", "GoodDollar", "G$", "treasure hunt", "geocaching",
    "crypto rewards", "Celo", "UBI", "web3 game", "find money", "real world crypto",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "games",
  // Domain-ownership verification (TalentApp).
  other: {
    "talentapp:project_verification":
      "6cf26c7776d62bdb274fb9a3a7f4a7e3e8f3f77a89ce8e11a2736438e0a01f8b18e51b2942fa281ef7e3b1377fc53906e79e4160af321ed13b949d8e5792c272",
  },
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: TITLE,
    description: "Hunt hidden G$ in the wild. Drop money. Find money.",
    url: "/",
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: "Hunt hidden G$ in the wild. Drop money. Find money.",
    site: X_HANDLE,
    creator: X_HANDLE,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: SITE_NAME,
  },
  formatDetection: { telephone: false },
};

// Structured data — helps Google render a richer result (site name, logo, sitelinks).
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#org` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icons/512`,
      sameAs: ["https://x.com/gooddropss"],
    },
  ],
};

const NO_SESSION_SCRIPT = `try{var s=localStorage.getItem("gd:signed-in")==="1";if(!s){var w=JSON.parse(localStorage.getItem("wagmi.store")||"null");var st=w&&w.state;s=!!(st&&st.current&&st.connections&&st.connections.value&&st.connections.value.length)}if(!s)document.documentElement.classList.add("gd-no-session")}catch(e){}`;

const GATE_CSS = `.gd-no-session [aria-label="Loading GoodDrops"]{display:none}html:not(.gd-no-session) [aria-label="Loading GoodDrops"]{animation:none!important;opacity:1}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before first paint: if this browser has no session to restore, hide the
            session loader at once, so a new visitor never sees it while the app
            loads. Mirrors hadSavedSession() in hooks/useSessionRestore. */}
        <script dangerouslySetInnerHTML={{ __html: NO_SESSION_SCRIPT }} />
        {/* Inline, not in globals.css, so it applies on the very first paint even
            before the stylesheet loads: nothing to restore = no loader; a session
            to restore = the loader from frame one (no fade-in), so the app never
            flashes before it. */}
        <style dangerouslySetInnerHTML={{ __html: GATE_CSS }} />
        <link rel="preconnect" href="https://tiles.openfreemap.org" crossOrigin="anonymous" />
        {FONT_PRELOADS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
        <Analytics />
      </body>
    </html>
  );
}
