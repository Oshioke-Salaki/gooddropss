import type { Drop } from "@/types";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL ?? "";

const DROPS_QUERY = `
  query GetDrops($lastId: ID!) {
    drops(
      first: 1000
      orderBy: dropId
      orderDirection: asc
      where: { id_gt: $lastId }
    ) {
      id
      dropId
      dropper
      amount
      claimer
      expiry
      claimedAt
      createdAt
      status
      lat
      lng
      hint
    }
  }
`;

interface SubgraphDrop {
  id:        string;
  dropId:    string;
  dropper:   string;
  amount:    string;
  claimer:   string;
  expiry:    string;
  claimedAt: string;
  createdAt: string;
  status:    number;
  lat:       number;
  lng:       number;
  hint:      string;
}

function toDrop(d: SubgraphDrop): Drop {
  return {
    id:        BigInt(d.dropId),
    dropper:   d.dropper as `0x${string}`,
    amount:    BigInt(d.amount),
    claimer:   d.claimer as `0x${string}`,
    expiry:    Number(d.expiry),
    claimedAt: Number(d.claimedAt),
    createdAt: Number(d.createdAt),
    status:    d.status,
    lat:       d.lat,
    lng:       d.lng,
    hint:      d.hint,
  };
}

const DROP_BY_ID_QUERY = `
  query GetDrop($id: ID!) {
    drop(id: $id) {
      id dropId dropper amount claimer expiry claimedAt createdAt status lat lng hint
    }
  }
`;

export async function fetchDropById(id: string): Promise<Drop | null> {
  if (!SUBGRAPH_URL) return null;
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: DROP_BY_ID_QUERY, variables: { id } }),
    next: { revalidate: 30 },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const d: SubgraphDrop | null = json.data?.drop ?? null;
  return d ? toDrop(d) : null;
}

const DROP_BY_DROPID_QUERY = `
  query GetDropByDropId($dropId: String!) {
    drops(where: { dropId: $dropId }, first: 1) {
      id dropId dropper amount claimer expiry claimedAt createdAt status lat lng hint
    }
  }
`;

// Fetch a single drop by its on-chain numeric dropId.
// Falls back to contract read if the subgraph hasn't indexed it yet.
export async function fetchDropByDropId(dropId: string): Promise<Drop | null> {
  if (SUBGRAPH_URL) {
    try {
      const res = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: DROP_BY_DROPID_QUERY, variables: { dropId } }),
      });
      if (res.ok) {
        const json = await res.json();
        const drops: SubgraphDrop[] = json.data?.drops ?? [];
        if (drops.length > 0) return toDrop(drops[0]);
      }
    } catch {}
  }
  return null;
}

// ─── Recent activity ─────────────────────────────────────────────────────────

export interface ActivityItem {
  type: "drop" | "claim";
  id: string;
  address: string;
  amount: bigint;
  timestamp: number;
}

const ACTIVITY_QUERY = `
  query RecentActivity {
    newDrops: drops(first: 6, orderBy: dropId, orderDirection: desc) {
      id dropId dropper amount createdAt
    }
    newClaims: drops(
      first: 6, orderBy: claimedAt, orderDirection: desc
      where: { status: 1, claimedAt_gt: "0" }
    ) {
      id dropId claimer amount claimedAt
    }
  }
`;

export async function fetchRecentActivity(): Promise<ActivityItem[]> {
  if (!SUBGRAPH_URL) return [];
  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: ACTIVITY_QUERY }),
    });
    const json = await res.json();
    const drops: Array<{ id: string; dropId: string; dropper: string; amount: string; createdAt: string }> =
      json.data?.newDrops ?? [];
    const claims: Array<{ id: string; dropId: string; claimer: string; amount: string; claimedAt: string }> =
      json.data?.newClaims ?? [];

    const items: ActivityItem[] = [
      ...drops.map((d) => ({
        type: "drop" as const,
        id: `drop-${d.id}`,
        address: d.dropper,
        amount: BigInt(d.amount),
        timestamp: Number(d.createdAt),
      })),
      ...claims.map((c) => ({
        type: "claim" as const,
        id: `claim-${c.id}`,
        address: c.claimer,
        amount: BigInt(c.amount),
        timestamp: Number(c.claimedAt),
      })),
    ];

    return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
  } catch {
    return [];
  }
}

// ─── Hunter profile ───────────────────────────────────────────────────────────

export interface HunterStats {
  address: string;
  dropsCreated: Drop[];
  dropsClaimed: Drop[];
}

const HUNTER_QUERY = `
  query HunterProfile($addr: Bytes!) {
    created: drops(where: { dropper: $addr }, orderBy: dropId, orderDirection: desc) {
      id dropId dropper amount claimer expiry claimedAt createdAt status lat lng hint
    }
    claimed: drops(where: { claimer: $addr, status: 1 }, orderBy: claimedAt, orderDirection: desc) {
      id dropId dropper amount claimer expiry claimedAt createdAt status lat lng hint
    }
  }
`;

export async function fetchHunterProfile(address: string): Promise<HunterStats | null> {
  if (!SUBGRAPH_URL) return null;
  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: HUNTER_QUERY,
        variables: { addr: address.toLowerCase() },
      }),
      next: { revalidate: 60 },
    });
    const json = await res.json();
    const created: SubgraphDrop[] = json.data?.created ?? [];
    const claimed: SubgraphDrop[] = json.data?.claimed ?? [];
    return {
      address,
      dropsCreated: created.map(toDrop),
      dropsClaimed: claimed.map(toDrop),
    };
  } catch {
    return null;
  }
}

// Fetches all drops using cursor pagination (1 000 per page).
export async function fetchAllDrops(): Promise<Drop[]> {
  if (!SUBGRAPH_URL) throw new Error("NEXT_PUBLIC_SUBGRAPH_URL is not set");

  const all: Drop[] = [];
  let lastId = "0";

  while (true) {
    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: DROPS_QUERY, variables: { lastId } }),
    });

    if (!res.ok) throw new Error(`Subgraph request failed: ${res.status}`);

    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);

    const page: SubgraphDrop[] = json.data?.drops ?? [];
    all.push(...page.map(toDrop));

    if (page.length < 1000) break;
    lastId = page[page.length - 1].id;
  }

  return all;
}
