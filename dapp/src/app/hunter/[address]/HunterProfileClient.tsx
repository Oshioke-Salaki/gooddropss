"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { ProfileContent } from "@/components/profile/ProfileContent";
import { BadgeViewer } from "@/components/profile/BadgeViewer";
import { useHunterProfile, type WallBadge } from "@/components/profile/useHunterProfile";
import { OwnProfile } from "@/components/profile/OwnProfile";

/**
 * The standalone page version of the profile.
 *
 * Renders exactly the same `ProfileContent` as the drawer, so a shared
 * /hunter/<address> link and an in-app tap can never drift apart. The page is
 * kept (rather than folded into the drawer) because these URLs are public,
 * indexed, and already shared — the server component above still supplies the
 * metadata.
 *
 * Your OWN link shows the full profile page (edit, invite, rank) instead of
 * the public card — the same thing /me renders.
 */
export function HunterProfileClient({ address }: { address: string }) {
  const { address: connected } = useAccount();
  const isOwn = !!connected && connected.toLowerCase() === address.toLowerCase();
  if (isOwn) return <OwnProfile address={connected} />;
  return <PublicProfile address={address} />;
}

function PublicProfile({ address }: { address: string }) {
  const { data, badges } = useHunterProfile(address, false);
  const [badge, setBadge] = useState<WallBadge | null>(null);

  return (
    <>
      <div className="mx-auto w-full max-w-[683px] bg-white rounded-3xl shadow-[0px_0px_12px_0px_#0000000A] overflow-hidden">
        <ProfileContent
          address={address}
          data={data}
          badges={badges}
          selectedBadgeId={badge?.id ?? null}
          onSelectBadge={setBadge}
          header={<div className="pt-6" />}
        />
      </div>

      {badge && (
        <div
          onClick={() => setBadge(null)}
          className="modal-fade-in fixed inset-0 z-[1400] bg-[#0000000A] backdrop-blur-md
            flex items-center justify-center p-4"
        >
          <BadgeViewer badge={badge} onClose={() => setBadge(null)} />
        </div>
      )}
    </>
  );
}
