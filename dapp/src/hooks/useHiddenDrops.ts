"use client";
import { useState, useEffect } from "react";

// Drop ids an admin has hidden from the map (offensive / scam). Fetched once and
// refreshed when moderation actions fire the shared event. Fails open to an empty
// set — a moderation-service blip must never blank the whole map.
export function useHiddenDrops(): Set<string> {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/moderation/hidden")
        .then((r) => r.json())
        .then((d) => {
          if (alive && Array.isArray(d.hidden)) setHidden(new Set(d.hidden.map(String)));
        })
        .catch(() => {});
    load();
    const onUpd = () => load();
    window.addEventListener("gd:moderation-updated", onUpd);
    return () => { alive = false; window.removeEventListener("gd:moderation-updated", onUpd); };
  }, []);

  return hidden;
}
