"use client";
import { Loader2, ShieldCheck } from "lucide-react";
import { useWalletSession } from "@/hooks/useWalletSession";

/**
 * "Confirm it's your wallet" prompt for private records (a shop under review,
 * an unapproved event) on a browser that hasn't proven the wallet yet. One
 * signature, no funds moved; every view listening for "gd:session-changed"
 * refetches once it's done.
 */
export function VerifyWalletCard({ address, title, body, className = "" }: {
  address: string;
  title: string;
  body: string;
  className?: string;
}) {
  const session = useWalletSession(address);
  if (session.verified) return null;
  return (
    <div className={`bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] p-6 flex flex-col sm:flex-row sm:items-center gap-4 ${className}`}>
      <span className="w-14 h-14 shrink-0 rounded-full bg-surface flex items-center justify-center text-heading">
        <ShieldCheck className="w-6 h-6" strokeWidth={1.75} />
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-y-2">
        <p className="text-base/[130%] text-heading">{title}</p>
        <p className="text-sm/[140%] text-nav-muted">{body}</p>
        {session.error && <p role="alert" className="text-sm/[140%] text-danger">{session.error}</p>}
      </div>
      <button
        type="button"
        onClick={() => session.verify()}
        disabled={session.verifying || session.checking}
        className="h-11 px-5 shrink-0 rounded-full bg-brand text-white text-sm/none flex items-center justify-center gap-2
          cursor-pointer motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed"
      >
        {session.verifying && <Loader2 className="w-4 h-4 animate-spin" />}
        {session.verifying ? "Confirm in your wallet…" : "Confirm it's me"}
      </button>
    </div>
  );
}
