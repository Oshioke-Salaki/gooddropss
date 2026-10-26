"use client";
import { useCallback, useEffect, useState } from "react";
import { boardFromJson, type Board, type BoardJson } from "@/lib/board";

const EMPTY: Board = { droppers: [], hunters: [], droppedWei: 0n, claimedWei: 0n, totalDrops: 0, totalClaims: 0 };

// One board per page load, shared by every component that asks for it (the
// Rankings page and the profile both mount this hook).
let shared: { at: number; board: Board } | null = null;
let inflight: Promise<Board> | null = null;
const SHARED_TTL_MS = 30_000;

async function loadBoard(fresh: boolean): Promise<Board> {
  if (!fresh && shared && Date.now() - shared.at < SHARED_TTL_MS) return shared.board;
  if (!fresh && inflight) return inflight;
  const p = fetch(`/api/board${fresh ? "?fresh=1" : ""}`, fresh ? { cache: "no-store" } : undefined)
    .then((r) => (r.ok ? (r.json() as Promise<BoardJson>) : Promise.reject(new Error(`board ${r.status}`))))
    .then((j) => {
      const board = boardFromJson(j);
      shared = { at: Date.now(), board };
      return board;
    })
    .finally(() => { inflight = null; });
  inflight = p;
  return p;
}

/**
 * Both leaderboards, built on the server (see /api/board and lib/board).
 *
 * Entries are grouped by GoodDollar identity root and each row shows the wallet
 * that person actually uses. Same return shape as before, so the Rankings page
 * and the profile read it unchanged — but the phone now downloads one small,
 * CDN-cached JSON instead of paging the entire drop history and resolving every
 * wallet's identity itself.
 */
export function useLeaderboard() {
  const [board, setBoard] = useState<Board>(() => shared?.board ?? EMPTY);
  const [loading, setLoading] = useState(() => !shared);
  const [error, setError] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    try {
      const b = await loadBoard(fresh);
      setBoard(b);
      setError(false);
    } catch (e) {
      console.error("[useLeaderboard]", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { ...board, loading, error, refresh };
}
