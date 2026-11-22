// The identity-grouped leaderboard, built once and shared by everything that
// shows it: /api/board (Rankings) and the public /stats page. Both used to build
// the same thing separately every minute.
//
// Server only.

import type { Drop } from "@/types";
import { fetchAllDrops } from "@/lib/subgraph";
import { resolveRoots } from "@/lib/roots";
import { memo } from "@/lib/serverCache";
import { buildBoard, type Board } from "@/lib/board";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface BoardSnapshot {
  drops: Drop[];
  /** wallet → identity root (lowercase). */
  roots: Map<string, string>;
  board: Board;
  /** Unix ms it was built. */
  at: number;
}

/** Built at most once a minute per instance; `fresh` (refresh button) rebuilds, floored at a few seconds. */
export function getBoardSnapshot(opts: { fresh?: boolean } = {}): Promise<BoardSnapshot> {
  return memo("board:snapshot", 60_000, async () => {
    const drops = await fetchAllDrops({ fresh: opts.fresh });
    const addrs = new Set<string>();
    for (const d of drops) {
      addrs.add(d.dropper.toLowerCase());
      if (d.claimer !== ZERO) addrs.add(d.claimer.toLowerCase());
    }
    const roots = await resolveRoots([...addrs]);
    return { drops, roots, board: buildBoard(drops, roots), at: Date.now() };
  }, { fresh: opts.fresh });
}
