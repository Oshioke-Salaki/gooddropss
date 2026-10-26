"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerUpRight, Search, X } from "lucide-react";
import { landmarkMeta } from "@/lib/landmarks";
import type { Landmark } from "@/types";

interface Props {
  /**
   * The approved places to search. Passed in rather than fetched here so the
   * page and the map share one `useLandmarks()` result (one request, one source
   * of truth) — `/api/landmarks` returns active-only unless asked otherwise.
   */
  landmarks: Landmark[];
  /** Called with the chosen place — the map flies there. */
  onSelect: (landmark: Landmark) => void;
}

const MAX_RESULTS = 8;

/**
 * Search the approved landmarks and fly the map to one.
 *
 * Filtering is in-memory over the already-loaded list, so results are instant
 * and there's no per-keystroke request. Supports full keyboard control
 * (Arrow keys / Enter / Escape) and click-outside to dismiss.
 */
export function MapSearchBar({ landmarks, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Rank: name-prefix beats name-contains beats a match in the note, so typing
  // "bar" surfaces "Barnawa" above "…, Barnawa".
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Landmark[];
    const scored: { lm: Landmark; score: number }[] = [];
    for (const lm of landmarks) {
      const name = lm.name.toLowerCase();
      const note = (lm.note ?? "").toLowerCase();
      let score = -1;
      if (name.startsWith(q)) score = 0;
      else if (name.includes(q)) score = 1;
      else if (note.includes(q)) score = 2;
      else if (landmarkMeta(lm.category).label.toLowerCase().startsWith(q)) score = 3;
      if (score >= 0) scored.push({ lm, score });
    }
    scored.sort((a, b) => a.score - b.score || a.lm.name.localeCompare(b.lm.name));
    return scored.slice(0, MAX_RESULTS).map((s) => s.lm);
  }, [query, landmarks]);

  // Reset the highlighted row whenever the result set changes.
  useEffect(() => { setActive(0); }, [query]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(lm: Landmark) {
    onSelect(lm);
    setOpen(false);
    // Reset to the empty state — the map is now showing the place, so the bar
    // is ready for the next search rather than holding a stale query.
    setQuery("");
    inputRef.current?.blur();
  }

  function clear() {
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { query ? clear() : setOpen(false); return; }
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === "Enter") { e.preventDefault(); const lm = results[active]; if (lm) choose(lm); }
  }

  const showList = open && query.trim().length > 0;

  return (
    // Two shapes, one component: below lg a full-bleed band tucked under the nav,
    // at lg and up a floating 320px pill over the map's top-left corner.
    <div ref={rootRef} className="font-sans w-full lg:w-[320px]">
      {/* Search bar */}
      <div className="relative w-full">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls="map-search-results"
          aria-autocomplete="list"
          placeholder="Search locations..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full py-6 pl-6 pr-14 bg-white text-sm/none text-heading placeholder:text-nav-muted outline-none
            lg:py-4 lg:rounded-full lg:focus:ring-2 lg:focus:ring-brand/30 lg:transition-shadow"
        />
        {/* Search turns into a clear button the moment there's something to clear. */}
        <button
          type="button"
          onClick={query ? clear : () => inputRef.current?.focus()}
          aria-label={query ? "Clear search" : "Search"}
          className="absolute top-1/2 right-6 lg:right-5 -translate-y-1/2 text-black cursor-pointer"
        >
          {query ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
        </button>
      </div>

      {/* Results — flush under the band on mobile, a detached card on desktop. */}
      {showList && (
        <div
          id="map-search-results"
          ref={listRef}
          role="listbox"
          className="w-full max-h-[60vh] lg:max-h-[320px] overflow-y-auto bg-white rounded-b-3xl py-6 flex flex-col
            lg:mt-2 lg:rounded-3xl"
          style={{ boxShadow: "0px 0px 12px 0px #0000000A" }}
        >
          {results.length === 0 ? (
            <p className="px-6 text-sm/[140%] text-nav-muted">
              No places match &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            results.map((lm, i) => (
              <button
                key={lm.id}
                data-idx={i}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(lm)}
                className={`py-3 px-6 flex items-center gap-x-3 text-left w-full transition-colors ${
                  i === active ? "bg-surface" : ""
                }`}
              >
                <div className="bg-surface rounded-full p-2 shrink-0">
                  <CornerUpRight className="w-4 h-4 text-heading" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm/[100%] text-heading mb-2 truncate">{lm.name}</h3>
                  <h4 className="text-xs/[100%] text-nav-muted truncate">
                    {lm.note?.trim() || landmarkMeta(lm.category).label}
                  </h4>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default MapSearchBar;
