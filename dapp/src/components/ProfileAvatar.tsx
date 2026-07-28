"use client";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/hooks/useProfile";

// Client Avatar that resolves the person's chosen preset (and username) from
// their profile. useProfile is cached + deduped by address, so many of these on
// one page (e.g. the leaderboard) share a single fetch per address.
export function ProfileAvatar(props: {
  address: string;
  size?: number;
  ringColor?: string;
  badge?: string | null;
  username?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const p = useProfile(props.address);
  return <Avatar {...props} username={props.username ?? p?.username} preset={p?.avatar} />;
}
