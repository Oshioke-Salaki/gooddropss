"use client";
import { useProfile } from "@/hooks/useProfile";
import { shortAddr } from "@/lib/utils";

interface Props {
  address: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Resolves an address to a @username when one is set,
 * otherwise falls back to the shortened address (0xB291…b1C7).
 */
export function UserHandle({ address, style, className }: Props) {
  const profile = useProfile(address);
  const label   = profile?.username ? `@${profile.username}` : shortAddr(address);
  return (
    <span style={style} className={className}>
      {label}
    </span>
  );
}
