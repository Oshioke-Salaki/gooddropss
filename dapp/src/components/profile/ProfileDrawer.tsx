"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { X, Share2, Check } from "lucide-react";
import { useSheetDrag } from "@/hooks/useSheetDrag";
import { ProfileContent } from "./ProfileContent";
import { BadgeViewer } from "./BadgeViewer";
import { useHunterProfile, type WallBadge } from "./useHunterProfile";

export interface OpenProfileDetail {
  address: string;
  /** Leaderboard position, when the caller already knows it. */
  rank?: number | null;
}

/** Open the profile drawer from anywhere — a leaderboard row, the wallet modal. */
export function openProfile(address: string, rank?: number | null) {
  window.dispatchEvent(
    new CustomEvent<OpenProfileDetail>("gd:openProfile", {
      detail: { address, rank },
    }),
  );
}

/**
 * Mount ONCE (Providers). Listens for `gd:openProfile` and renders the drawer.
 *
 * A single global host rather than a drawer per call site: the leaderboard, the
 * wallet modal and anything added later all share one instance, so there's no
 * chance of two drawers stacking.
 */
export function ProfileDrawerHost() {
  const [open, setOpen] = useState<OpenProfileDetail | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenProfileDetail>).detail;
      if (detail?.address) setOpen(detail);
    };
    window.addEventListener("gd:openProfile", onOpen);
    return () => window.removeEventListener("gd:openProfile", onOpen);
  }, []);

  if (!open) return null;
  return (
    <ProfileDrawer
      key={open.address}
      address={open.address}
      rank={open.rank}
      onClose={() => setOpen(null)}
    />
  );
}

function ProfileDrawer({
  address,
  rank,
  onClose,
}: {
  address: string;
  rank?: number | null;
  onClose: () => void;
}) {
  const { address: connected } = useAccount();
  const isOwn =
    !!connected && connected.toLowerCase() === address.toLowerCase();
  const { data, badges } = useHunterProfile(address, isOwn);
  const [badge, setBadge] = useState<WallBadge | null>(null);
  const [shared, setShared] = useState(false);

  // Below lg the drawer is a bottom sheet: slides up, thumb it down to dismiss.
  // Inert at lg and up, where the CSS class handles the slide-in from the right.
  const { sheetRef, sheetStyle, handleProps } = useSheetDrag({
    onDismiss: onClose,
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Escape closes the drawer — but BadgeViewer captures it first when it's open,
  // so one press closes the badge and the next closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const share = useCallback(async () => {
    const url = `${window.location.origin}/hunter/${address.toLowerCase()}`;
    const title = "GoodDrops hunter";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    } catch {
      /* user dismissed the share sheet, or clipboard is blocked */
    }
  }, [address]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onClose}
      className="modal-fade-in fixed inset-0 z-[1400] bg-[#0000000A] backdrop-blur-md font-sans
        flex items-end justify-center px-4 pb-4
        lg:justify-end lg:items-stretch lg:p-5 lg:px-5"
    >
      {/* Badge viewer — a sibling of the drawer, not a child, so it stays put
          while the wall scrolls behind it. Left of the drawer on desktop, and
          top-aligned so the stretched overlay doesn't stretch it too. */}
      {badge && (
        <div className="fixed inset-0 lg:static flex items-center justify-center lg:items-start lg:mr-4 z-10 pointer-events-none">
          <div className="pointer-events-auto">
            <BadgeViewer badge={badge} onClose={() => setBadge(null)} />
          </div>
        </div>
      )}

      <div
        ref={sheetRef}
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hunter profile"
        className="drawer-in-lg relative w-full lg:w-[683px] lg:max-w-[calc(100vw-40px)]
          max-h-[85dvh] lg:max-h-none overflow-y-auto
          bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A]"
      >
        <ProfileContent
          address={address}
          rank={rank}
          data={data}
          badges={badges}
          selectedBadgeId={badge?.id ?? null}
          onSelectBadge={setBadge}
          header={
            <div
              {...handleProps}
              className="pt-6 px-6 pb-2 flex items-start justify-between gap-3"
            >
              <span className="text-sm/none text-nav-muted">Profile</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close profile"
                className="w-8 h-8 shrink-0 rounded-full bg-surface text-nav-muted flex items-center justify-center
                  cursor-pointer motion-safe:transition-colors hover:bg-nav-controls hover:text-heading"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          }
        />

        {/* Share — sticks to the bottom of the scroll container so it's always
            reachable however far down the wall you are. */}
        <div className="sticky bottom-0 px-6 pb-6 pt-2 flex justify-center lg:justify-end pointer-events-none">
          <button
            type="button"
            onClick={share}
            className="pointer-events-auto py-3 px-6 flex gap-x-2 items-center rounded-full bg-nav-active text-white
              text-sm/none cursor-pointer shadow-[0px_2px_12px_0px_#00000024]
              motion-safe:transition-opacity hover:opacity-90"
          >
            {shared ? (
              <Check className="w-[18px] h-[18px]" />
            ) : (
              <Share2 className="w-[18px] h-[18px]" />
            )}
            {shared ? "Link copied" : "Share card"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
