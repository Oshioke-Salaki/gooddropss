"use client";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Coins, Target } from "lucide-react";
import { fetchRecentActivity, type ActivityItem } from "@/lib/subgraph";
import { formatG$ } from "@/lib/utils";
import { UserHandle } from "@/components/UserHandle";

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60)    return "just now";
  if (diff < 3_600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3_600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

export function ActivityTicker() {
  const [items, setItems]       = useState<ActivityItem[]>([]);
  const [visible, setVisible]   = useState<ActivityItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const seenRef   = useRef<Set<string>>(new Set());
  const timerRef  = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  async function load() {
    const data = await fetchRecentActivity();
    if (!data.length) return;

    const fresh = data.filter((a) => !seenRef.current.has(a.id));
    if (!fresh.length) {
      // On first load, show the 3 most recent with a 6s auto-dismiss
      if (seenRef.current.size === 0) {
        const initial = data.slice(0, 3);
        initial.forEach((a) => seenRef.current.add(a.id));
        setVisible(initial);
        initial.forEach((a) => {
          const t = setTimeout(() => dismiss(a.id), 6_000);
          timerRef.current.set(a.id, t);
        });
      }
      return;
    }

    fresh.forEach((a) => seenRef.current.add(a.id));
    setVisible((prev) => {
      const merged = [...fresh, ...prev].filter((a) => !dismissed.has(a.id));
      return merged.slice(0, 3);
    });

    // Auto-dismiss new items after 9 seconds
    fresh.forEach((a) => {
      const t = setTimeout(() => dismiss(a.id), 9_000);
      timerRef.current.set(a.id, t);
    });
  }

  function dismiss(id: string) {
    const t = timerRef.current.get(id);
    if (t) { clearTimeout(t); timerRef.current.delete(id); }
    setDismissed((prev) => new Set([...prev, id]));
    setVisible((prev) => prev.filter((a) => a.id !== id));
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 20_000);
    return () => {
      clearInterval(iv);
      timerRef.current.forEach(clearTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "152px",
        right: "12px",
        zIndex: 997,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: "230px",
        pointerEvents: "none",
      }}
    >
      <AnimatePresence>
        {visible.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: 40, scale: 0.92 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.92 }}
            transition={{ type: "spring", damping: 26, stiffness: 360 }}
            style={{
              background: "rgba(14,15,22,0.92)",
              backdropFilter: "blur(8px)",
              border: "1px solid #2a2a3e",
              borderRadius: 12,
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: 9,
              pointerEvents: "auto",
              cursor: "pointer",
              maxWidth: 260,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}
            onClick={() => dismiss(item.id)}
          >
            <div style={{
              width: 28, height: 28,
              borderRadius: "50%",
              background: item.type === "drop" ? "rgba(191,253,0,0.12)" : "rgba(0,207,255,0.12)",
              border: `1px solid ${item.type === "drop" ? "#BFFD0044" : "#00CFFF44"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {item.type === "drop"
                ? <Coins size={14} color="#BFFD00" />
                : <Target size={14} color="#00CFFF" />}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{
                margin: 0, fontSize: 12, fontWeight: 700, color: "#ddd",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                <UserHandle address={item.address} />{" "}
                <span style={{ color: item.type === "drop" ? "#BFFD00" : "#00CFFF", fontWeight: 900 }}>
                  {item.type === "drop" ? "dropped" : "claimed"}
                </span>{" "}
                {formatG$(item.amount)} G$
              </p>
              <p style={{ margin: 0, fontSize: 10, color: "#444", marginTop: 1 }}>
                {timeAgo(item.timestamp)}
              </p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
