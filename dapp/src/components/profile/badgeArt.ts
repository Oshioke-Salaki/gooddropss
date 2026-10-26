/**
 * Badge illustrations.
 *
 * Badge IDs are immutable: `badgeTypeId()` is keccak256 of the slug and MUST
 * match GoodDropsBadges.sol, so renaming an id would orphan every badge already
 * minted on-chain. Artwork is therefore mapped ONTO existing ids here rather
 * than the ids being renamed to match the filenames.
 *
 * Only mappings we're confident about are filled in — a wrong illustration is
 * worse than the emoji fallback. See the README note in
 * "Things we have to come back to.md" for the unmatched artwork.
 */
export const BADGE_ART: Record<string, string> = {
  // parachute + crate — "created your first drop"; matches the 🪂 it replaces
  "drop-maker": "/badges/genesis-drop-badge.svg",
  // whale → whale
  whale: "/badges/crypto-whale-badge.svg",
  // planted flag — "created 10+ drops", staking out territory
  pioneer: "/badges/territory-maker-badge.svg",
  // honey jar — "found 1,000+ G$ in total"
  "money-magnet": "/badges/honey-pot-badge.svg",
};

/** Artwork not yet claimed by a badge id — waiting on a decision, not missing. */
export const UNMAPPED_ART = [
  "micro-funder", "endless-well", "event-host", "wilderness",
  "the-riddler", "crowd-pleaser", "full-cycle", "beacon-of-light",
] as const;

export function badgeArt(id: string): string | null {
  return BADGE_ART[id] ?? null;
}
