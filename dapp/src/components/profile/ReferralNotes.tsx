"use client";
import { UserPlus } from "lucide-react";
import { useInviterName } from "@/components/referral/InviteSheets";
import type { InviteResult } from "@/lib/referral";

/** For a referrer: people who accepted their invite but aren't counted yet. */
export function WaitingNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p className="text-sm/[145%] text-nav-muted mt-3">
      <span className="text-heading">{count} more on the way.</span>
      {" "}They count once they verify and find or hide their first drop.
    </p>
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
