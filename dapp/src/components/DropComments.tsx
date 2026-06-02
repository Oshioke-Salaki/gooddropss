"use client";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { shortAddr } from "@/lib/utils";
import type { Comment } from "@/app/api/comments/[dropId]/route";

function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60)    return "just now";
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

interface Props {
  dropId: string;
}

export function DropComments({ dropId }: Props) {
  const { address, isConnected } = useAccount();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [posting, setPosting]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [error, setError]       = useState("");

  const fetchComments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res  = await fetch(`/api/comments/${dropId}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load comments"); return; }
      setComments(json.comments ?? []);
    } catch {
      setError("Network error loading comments");
    } finally {
      setLoading(false);
    }
  }, [dropId]);

  useEffect(() => {
    if (open) fetchComments();
  }, [open, fetchComments]);

  async function handlePost() {
    if (!address || !text.trim()) return;
    setPosting(true);
    setError("");
    try {
      const res  = await fetch(`/api/comments/${dropId}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ author: address, text: text.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to post"); return; }
      setComments((prev) => [json.comment, ...prev]);
      setText("");
    } catch {
      setError("Network error");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div style={{ borderTop: "2px solid #f0f0f0", paddingTop: 16 }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left"
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
      >
        <MessageCircle size={15} color="#888" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Comments {comments.length > 0 && !open ? `(${comments.length})` : ""}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#bbb" }}>{open ? "▲" : "▼"}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Comment input */}
              {isConnected ? (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 280))}
                    placeholder="Leave a note for hunters…"
                    rows={2}
                    style={{
                      flex: 1,
                      border: "2px solid #e8e6e0",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 13,
                      fontFamily: "inherit",
                      resize: "none",
                      outline: "none",
                      background: "#f9f9f7",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "#111"; }}
                    onBlur={(e)  => { e.currentTarget.style.borderColor = "#e8e6e0"; }}
                  />
                  <button
                    onClick={handlePost}
                    disabled={posting || !text.trim()}
                    style={{
                      width: 38, height: 38,
                      background: text.trim() ? "#111" : "#e8e6e0",
                      border: "none",
                      borderRadius: 10,
                      cursor: posting || !text.trim() ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {posting
                      ? <Loader2 size={16} color="#fff" style={{ animation: "spin 1s linear infinite" }} />
                      : <Send size={16} color={text.trim() ? "#BFFD00" : "#aaa"} />}
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>
                  Sign in to leave a comment
                </p>
              )}

              {error && (
                <p style={{ fontSize: 12, color: "#ff3b3b", margin: 0 }}>{error}</p>
              )}

              {/* Comment list */}
              {loading ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", color: "#aaa", fontSize: 12 }}>
                  <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                  Loading comments…
                </div>
              ) : comments.length === 0 ? (
                <p style={{ fontSize: 12, color: "#bbb", margin: 0 }}>
                  No comments yet. Be the first!
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
                  {comments.map((c) => (
                    <div key={c.id} style={{
                      background: "#f5f4f0",
                      border: "1.5px solid #e8e6e0",
                      borderRadius: 10,
                      padding: "8px 12px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 800, color: "#888",
                          fontFamily: "monospace",
                        }}>
                          {shortAddr(c.author)}
                        </span>
                        {address?.toLowerCase() === c.author && (
                          <span style={{
                            fontSize: 9, fontWeight: 900, color: "#111",
                            background: "#BFFD00", borderRadius: 4, padding: "1px 5px",
                          }}>you</span>
                        )}
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "#bbb" }}>
                          {timeAgo(c.timestamp)}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: "#333", lineHeight: 1.4 }}>
                        {c.text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
