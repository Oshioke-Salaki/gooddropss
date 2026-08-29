"use client";
import { useAccount } from "wagmi";
import Link from "next/link";
import { Package, ArrowRight } from "lucide-react";

// Owner-only entry into the drop-management console (/my-drops): reclaim expired
// G$, reactivate drops, and copy hidden-drop share links. Self-gates on the
// connected wallet exactly like OwnProfileInvite, so visitors to someone else's
// public profile never see it. Lives on your profile now instead of the nav bar.
export function OwnerDropsCard({ profileAddress }: { profileAddress: string }) {
  const { address } = useAccount();
  if (!address || address.toLowerCase() !== profileAddress.toLowerCase()) return null;
  return (
    <Link
      href="/my-drops"
      className="flex items-center gap-3 border-2 border-ink rounded-2xl p-4 bg-card shadow-brutal-sm hover:bg-cream transition-colors"
    >
      <div className="w-10 h-10 rounded-xl border-2 border-ink bg-lime flex items-center justify-center shrink-0">
        <Package size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm leading-tight">Your drops</p>
        <p className="text-xs text-muted leading-snug">Manage the drops you&apos;ve hidden — reclaim expired G$, reactivate, or share hidden drops.</p>
      </div>
      <ArrowRight size={18} className="shrink-0 text-muted" />
    </Link>
  );
}
