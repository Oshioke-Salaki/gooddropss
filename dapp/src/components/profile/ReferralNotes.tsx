"use client";
import { useState } from "react";
import { ChevronDown, Loader2, UserPlus } from "lucide-react";
import { useInviterName } from "@/components/referral/InviteSheets";
import type { InviteResult } from "@/lib/referral";
import type { WaitingFriend } from "@/app/api/referral/waiting/route";

const STEP_LABEL: Record<WaitingFriend["step"], string> = {
  verify: "Needs to verify",
  drop: "Needs a first drop",
};

function ago(at: number): string {
  const h = Math.max(0, Math.floor((Date.now() / 1000 - at) / 3600));
  if (h < 1) return "joined just now";
  if (h < 24) return `joined ${h}h ago`;
  const d = Math.floor(h / 24);
  return `joined ${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * For a referrer: people who accepted their invite but aren't counted yet, and
 * (on a tap) what each one still has to do, so they know what to tell them.
 */
export function WaitingNote({ count, address }: { count: number; address?: string }) {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<WaitingFriend[] | null>(null);
  const [failed, setFailed] = useState(false);
  if (count <= 0) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !friends && address) {
      setFailed(false);
      fetch(`/api/referral/waiting?address=${address.toLowerCase()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: { friends?: WaitingFriend[] }) => setFriends(d.friends ?? []))
        .catch(() => setFailed(true));
    }
  }

  const needVerify = friends?.filter((f) => f.step === "verify").length ?? 0;
  const needDrop = friends?.filter((f) => f.step === "drop").length ?? 0;

  return (
    <div className="mt-3">
      <p className="text-sm/[145%] text-nav-muted">
        <span className="text-heading">{count} more on the way.</span>
        {" "}They count once they verify and find or hide their first drop.
      </p>
      {address && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="mt-2 h-9 px-3.5 -ml-1 rounded-full text-sm/none text-brand flex items-center gap-1.5 cursor-pointer hover:bg-brand-soft"
        >
          {open ? "Hide" : "See who and what they need"}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
        </button>
      )}
      {open && (
        <div className="mt-2 rounded-2xl bg-surface p-3.5">
          {failed ? (
            <p className="text-sm/[145%] text-nav-muted">Couldn&apos;t load the list just now. Try again in a moment.</p>
          ) : !friends ? (
            <p className="text-sm/none text-nav-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          ) : friends.length === 0 ? (
            <p className="text-sm/[145%] text-nav-muted">Everyone on the way has just been counted.</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-line">
                {friends.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="block text-sm/none text-heading truncate">{f.name ? `@${f.name}` : "A new friend"}</span>
                      <span className="block text-xs/none text-nav-muted mt-1.5">{ago(f.at)}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1.5 text-xs/none ${f.step === "verify" ? "bg-streak-bg text-streak" : "bg-brand-soft text-brand"}`}>
                      {STEP_LABEL[f.step]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs/[150%] text-nav-muted mt-3 pt-3 border-t border-line">
                {needVerify > 0 && <>Tell friends who need to verify to tap <span className="text-heading">Get verified</span> on the map and do the quick face check. </>}
                {needDrop > 0 && <>Friends who need a first drop can open their welcome chest, or claim or hide any drop.</>}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * For the person who was invited: their invite is waiting to count, or (if
 * they're new and have none) a way to add who invited them.
 */
export function MyInviteNote({ invite, canBeInvited, onAdd }: {
  invite: InviteResult | undefined;
  canBeInvited: boolean | null | undefined;
  onAdd: () => void;
}) {
  const name = useInviterName(invite?.status === "waiting" ? invite.referrer : null);
  if (invite?.status === "waiting") {
    return (
      <p className="text-sm/[145%] text-nav-muted mt-5">
        You joined through <span className="text-heading">{name}</span>&apos;s invite. It counts for them once you verify and find or hide your first drop.
      </p>
    );
  }
  if (invite?.status === "none" && canBeInvited) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 h-11 px-5 rounded-full border border-line text-sm/none text-heading flex items-center
          justify-center gap-2 cursor-pointer motion-safe:transition-colors hover:bg-surface"
      >
        <UserPlus className="w-[18px] h-[18px]" strokeWidth={1.75} />
        Did someone invite you?
      </button>
    );
  }
  return null;
}
