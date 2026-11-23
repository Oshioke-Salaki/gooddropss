"use client";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { SITE_URL } from "@/lib/site";
import { referralAcceptMessage, inviteUrl, type InviteResult } from "@/lib/referral";

/** GET /api/referral?address= */
export interface ReferralStatus {
  /** People this wallet's owner has brought in. */
  count: number;
  /** Accepted their invite, not counted yet. */
  waiting: number;
  referredBy: string | null;
  /** This wallet's OWN invite: none, waiting to count, or counted (already). */
  invite: InviteResult;
  /** New enough that an invite could still count (null = couldn't tell). */
  canBeInvited: boolean | null;
}

export const referralKey = (address?: string) => ["referral-status", address?.toLowerCase()] as const;

async function fetchStatus(address: string): Promise<ReferralStatus> {
  const r = await fetch(`/api/referral?address=${address.toLowerCase()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`referral status ${r.status}`);
  return r.json();
}

/** Thrown when the server refused the request outright (bad input, rate limit). */
export class InviteRequestError extends Error {
  constructor(message: string, readonly httpStatus: number) { super(message); }
}

async function postJson(url: string, body: unknown): Promise<InviteResult> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null) as (InviteResult & { error?: string }) | null;
  if (!r.ok || !j || !j.status) throw new InviteRequestError(j?.error ?? "Couldn't reach GoodDrops. Please try again.", r.status);
  return { status: j.status, reason: j.reason, referrer: j.referrer };
}

/** Re-check a saved invite (no wallet needed). */
export function settleInvite(invitee: string): Promise<InviteResult> {
  return postJson("/api/referral/settle", { invitee: invitee.toLowerCase() });
}

/**
 * Referral state for the connected wallet: their invite link, how many people
 * they've brought in (and how many are on the way), and their own invite.
 */
export function useReferral() {
  const { address } = useAccount();
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  const query = useQuery({
    queryKey: referralKey(address),
    queryFn: () => fetchStatus(address!),
    enabled: !!address,
    staleTime: 30_000,
    retry: 2,
    refetchOnWindowFocus: false,
  });

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: referralKey(address) }), [qc, address]);

  /**
   * Accept `referrer`'s invite: the wallet confirms a short message (silently for
   * Magic, a prompt for other wallets), then the server saves it and counts it as
   * soon as it qualifies. Throws if the wallet declined or the request failed.
   */
  const accept = useCallback(async (referrer: string): Promise<InviteResult> => {
    if (!address) throw new Error("Sign in first");
    const timestamp = Date.now();
    const signature = await signMessageAsync({ message: referralAcceptMessage(referrer, timestamp) });
    const res = await postJson("/api/referral", { referrer: referrer.toLowerCase(), signature, timestamp });
    await refresh();
    return res;
  }, [address, signMessageAsync, refresh]);

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    count: query.data?.count ?? 0,
    waiting: query.data?.waiting ?? 0,
    inviteLink: address ? inviteUrl(SITE_URL, address) : "",
    accept,
    refresh,
  };
}
