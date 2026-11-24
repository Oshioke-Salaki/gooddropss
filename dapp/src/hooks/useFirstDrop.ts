"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** GET/POST /api/first-drop (see lib/firstDrop). */
export type FirstDropStatus = "offer" | "owed" | "sending" | "paid" | "done" | "unverified";
export interface FirstDropView { status: FirstDropStatus; bonusG: number; wallet?: string; tx?: string }

export const firstDropKey = (address?: string) => ["first-drop", address?.toLowerCase()] as const;

async function get(address: string): Promise<FirstDropView> {
  const r = await fetch(`/api/first-drop?address=${address.toLowerCase()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`first-drop ${r.status}`);
  return r.json();
}

async function post(address: string, dropId?: string): Promise<FirstDropView> {
  const r = await fetch("/api/first-drop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: address.toLowerCase(), ...(dropId ? { dropId } : {}) }),
  });
  if (!r.ok) throw new Error(`first-drop ${r.status}`);
  return r.json();
}

/** The bonus has been earned (sent or on its way). */
export const bonusEarned = (s?: FirstDropStatus) => s === "owed" || s === "sending" || s === "paid";

/** Where this wallet stands on the first-drop bonus. */
export function useFirstDrop(address?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: firstDropKey(address),
    queryFn: () => get(address!),
    enabled: !!address,
    staleTime: 60_000,
    retry: 1,
    // While a bonus is on its way, check back until it lands.
    refetchInterval: (q) => (q.state.data?.status === "owed" || q.state.data?.status === "sending" ? 15_000 : false),
  });

  /**
   * Report a drop that just landed. The indexer can lag a few seconds behind the
   * chain, so keep asking (briefly) until the server has seen it.
   */
  const report = useCallback(async (dropId?: string): Promise<FirstDropView | null> => {
    if (!address) return null;
    let last: FirstDropView | null = null;
    for (const wait of [0, 3, 6, 12, 25]) {
      if (wait) await new Promise((r) => setTimeout(r, wait * 1000));
      try {
        last = await post(address, dropId);
        qc.setQueryData(firstDropKey(address), last);
        if (last.status !== "offer") return last;
      } catch { /* try again */ }
    }
    return last;
  }, [address, qc]);

  return { ...query, view: query.data, report };
}
