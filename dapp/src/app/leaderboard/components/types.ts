/** One ranked identity. Wallets linked to the same GoodDollar root collapse into one. */
export interface Rank {
  /** The wallet this person actually uses — the most recently active of the group. */
  address: string;
  totalWei: bigint;
  /** Drops created (droppers) or drops claimed (hunters). */
  count: number;
}

export type Tab = "droppers" | "hunters";

/** Copy that swaps with the tab, kept in one place so the two views can't drift. */
export const TAB_COPY: Record<Tab, {
  unit: string;
  totalLabel: string;
  activeLabel: string;
  /** Tighter wording for the phone, where two chips share one row. */
  activeLabelShort: string;
  totalCountLabel: string;
  totalCountLabelShort: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptyBody: string;
}> = {
  droppers: {
    unit: "drops",
    totalLabel: "Dropped with Good Drops",
    activeLabel: "Active droppers",
    activeLabelShort: "Droppers",
    totalCountLabel: "Total drops",
    totalCountLabelShort: "Drops",
    searchPlaceholder: "Search droppers...",
    emptyTitle: "No droppers yet",
    emptyBody: "Be the first to hide G$ on the map.",
  },
  hunters: {
    unit: "claims",
    totalLabel: "Claimed with Good Drops",
    activeLabel: "Active hunters",
    activeLabelShort: "Hunters",
    totalCountLabel: "Total claims",
    totalCountLabelShort: "Claims",
    searchPlaceholder: "Search hunters...",
    emptyTitle: "No hunters yet",
    emptyBody: "Be the first to claim a drop.",
  },
};
