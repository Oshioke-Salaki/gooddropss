import type { Metadata } from "next";
import { RenewFlow } from "./RenewFlow";

// Reached only from the verification popup (never in the nav, never indexed):
// an email account linked to an original wallet renews its verification there.
export const metadata: Metadata = {
  title: "Renew your verification · GoodDrops",
  description: "Renew your GoodDollar verification with your original wallet.",
  robots: { index: false, follow: false },
};

export default function RenewPage() {
  return <RenewFlow />;
}
