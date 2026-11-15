import type { Metadata } from "next";
import { SwitchFlow } from "./SwitchFlow";

// Reached only by link (never in the nav, never indexed): people who signed in
// with a browser wallet move to email sign-in here, and linked accounts come
// back here to renew their verification with the original wallet.
export const metadata: Metadata = {
  title: "Switch to email sign-in · GoodDrops",
  description: "Move from your wallet app to signing in with your email. Keep your verification, G$ and standing.",
  robots: { index: false, follow: false },
};

export default function SwitchToEmailPage() {
  return <SwitchFlow />;
}
