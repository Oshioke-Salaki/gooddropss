import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
});

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"
  ),
  title: "GoodDrops — Find hidden G$ in the wild",
  description:
    "Hide GoodDollar tokens at real-world GPS coordinates. Verified humans hunt them down and claim the reward.",
  openGraph: {
    title: "GoodDrops — Find hidden G$ in the wild",
    description: "Hunt hidden G$ in the wild. Drop money. Find money.",
    type: "website",
    siteName: "GoodDrops",
  },
  twitter: {
    card: "summary_large_image",
    title: "GoodDrops — Find hidden G$ in the wild",
    description: "Hunt hidden G$ in the wild. Drop money. Find money.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GoodDrops",
  },
  formatDetection: { telephone: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
