"use client";
import { useAccount } from "wagmi";
import { InviteCard } from "@/components/InviteCard";

// Show the invite card only when a hunter is looking at THEIR OWN profile —
// showing your invite link on someone else's page would make no sense.
export function OwnProfileInvite({ profileAddress }: { profileAddress: string }) {
  const { address } = useAccount();
  if (!address || address.toLowerCase() !== profileAddress.toLowerCase()) return null;
  return <InviteCard />;
}
