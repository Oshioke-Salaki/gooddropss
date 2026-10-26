"use client";
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MessageCircle, Send, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { UserHandle } from "@/components/UserHandle";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Skeleton } from "@/app/leaderboard/components/Skeleton";
import type { Comment } from "@/app/api/comments/[dropId]/route";

function timeAgo(ts: number): string {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60)    return "just now";
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

interface Props {
  dropId:  string;
  dropper?: string; // address of the drop creator — gets a distinct badge
}

export function DropComments({ dropId, dropper }: Props) {
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

  const canPost = !!text.trim() && !posting;

  return (
    <div className="border-t border-line pt-4 font-sans">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2.5 w-full text-left cursor-pointer rounded-full
          motion-safe:transition-colors hover:text-heading text-nav-muted"
      >
        <MessageCircle className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
        <span className="text-sm/none text-heading">
          Comments{comments.length > 0 && !open ? ` (${comments.length})` : ""}
        </span>
        <ChevronDown
          className={`w-4 h-4 ml-auto shrink-0 motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-4 flex flex-col gap-3">
              {/* Comment input */}
              {isConnected ? (
                <form
                  className="flex gap-2 items-end"
                  onSubmit={(e) => { e.preventDefault(); handlePost(); }}
                >
                  <label className="flex-1 min-w-0">
                    <span className="sr-only">Your comment</span>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value.slice(0, 280))}
                      placeholder="Leave a note for hunters…"
                      rows={2}
                      disabled={posting}
                      className="w-full rounded-2xl bg-surface px-4 py-3 text-sm/[140%] text-heading placeholder:text-nav-muted
                        border border-transparent outline-none resize-none motion-safe:transition-colors focus:border-brand
                        disabled:opacity-60"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!canPost}
                    aria-label="Post comment"
                    className="w-11 h-11 shrink-0 rounded-full bg-brand text-white flex items-center justify-center cursor-pointer
                      motion-safe:transition-colors hover:bg-brand/90 disabled:bg-[#A4A4A4] disabled:cursor-not-allowed"
                  >
                    {posting
                      ? <Loader2 className="w-[18px] h-[18px] animate-spin" />
                      : <Send className="w-[18px] h-[18px]" strokeWidth={2} />}
                  </button>
                </form>
              ) : (
                <p className="text-sm/none text-nav-muted">Sign in to leave a comment</p>
              )}

              {error && <p role="alert" className="text-sm/none text-danger">{error}</p>}

              {/* Comment list */}
              {loading ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}
                </div>
              ) : comments.length === 0 ? (
                <p className="text-sm/none text-nav-muted">No comments yet. Be the first.</p>
              ) : (
                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto overscroll-contain">
                  {comments.map((c) => {
                    const isDropper = !!dropper && c.author.toLowerCase() === dropper.toLowerCase();
                    const isMe      = address?.toLowerCase() === c.author.toLowerCase();
                    return (
                      <div key={c.id} className="flex gap-3 rounded-2xl bg-surface px-4 py-3">
                        <ProfileAvatar address={c.author} size={28} ringColor="transparent" className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <UserHandle address={c.author} className="text-sm/none text-heading" />
                            {isDropper && (
                              <span className="rounded-full bg-brand-soft text-brand px-2 py-1 text-xs/none">Dropper</span>
                            )}
                            {isMe && (
                              <span className="rounded-full bg-white text-nav-muted px-2 py-1 text-xs/none">you</span>
                            )}
                            <span className="ml-auto text-xs/none text-nav-muted">{timeAgo(c.timestamp)}</span>
                          </div>
                          <p className="mt-1.5 text-sm/[140%] text-heading break-words">{c.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
