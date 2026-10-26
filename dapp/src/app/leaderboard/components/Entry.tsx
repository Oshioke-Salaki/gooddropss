"use client";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { UserHandle } from "@/components/UserHandle";

interface IdentityProps {
  address: string;
  count: number;
  unit: string;
  /** White text for the dark "your rank" bar; default is the light-surface palette. */
  onDark?: boolean;
  /** Opens the profile drawer. Omit on surfaces that shouldn't be clickable. */
  onOpen?: () => void;
  /** Overrides the resolved handle — the MeBar says "You" rather than your name. */
  nameOverride?: string;
}

/** Avatar + name + "708 drops". Shared by the podium, the rows and your own bar. */
export function EntryIdentity({
  address,
  count,
  unit,
  onDark = false,
  onOpen,
  nameOverride,
}: IdentityProps) {
  const name = (
    <span
      className={`text-base/none lg:text-lg/none truncate ${onDark ? "text-white" : "text-heading"}`}
    >
      {nameOverride ?? <UserHandle address={address} />}
    </span>
  );

  return (
    <div className="flex items-center gap-x-4 min-w-0">
      {/* Avatar sizing is inline px inside `Avatar`, so it can't be driven by a
          breakpoint class — render the two sizes and let CSS pick. Both are pure
          renders sharing one cached profile lookup, so there's no extra cost. */}
      <span className="lg:hidden shrink-0">
        <ProfileAvatar address={address} size={38} ringColor="transparent" />
      </span>
      <span className="hidden lg:block shrink-0">
        <ProfileAvatar address={address} size={46} ringColor="transparent" />
      </span>
      <div className="flex flex-col gap-y-3.5 lg:gap-y-4 min-w-0">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 text-left cursor-pointer motion-safe:transition-opacity hover:opacity-80"
          >
            {name}
          </button>
        ) : (
          name
        )}
        <span
          className={`text-sm/none ${onDark ? "text-white/70" : "text-nav-muted"}`}
        >
          {count.toLocaleString("en-US")} {unit}
        </span>
      </div>
    </div>
  );
}

/** The right-hand G$ total. */
export function EntryAmount({
  value,
  onDark = false,
}: {
  value: string;
  onDark?: boolean;
}) {
  return (
    <div className="flex flex-col gap-y-3.5 lg:gap-y-4 items-end shrink-0">
      <span
        className={`text-base/none lg:text-lg/none ${onDark ? "text-white" : "text-heading"}`}
      >
        {value}
      </span>
      <span
        className={`text-sm/none ${onDark ? "text-white/70" : "text-nav-muted"}`}
      >
        G$
      </span>
    </div>
  );
}
