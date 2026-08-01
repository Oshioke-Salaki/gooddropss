import { randomBytes } from "node:crypto";

// ── Merchant task-locked drops (Phase 3) — server helpers ─────────────────────
// Client-safe constants/types/helpers live in taskShared.ts and are re-exported
// here so existing server imports from "@/lib/taskLock" keep working. The signed
// message strings live in taskCreateMsg.ts (also client-safe).
export * from "./taskShared";
export { approveMessage, taskCreateMessage } from "./taskCreateMsg";

// 16 bytes of entropy — unguessable, so a QR nonce can't be forged, only minted.
// Server-only (node:crypto), which is why it's not in taskShared.
export function newNonce(): string {
  return randomBytes(16).toString("hex");
}
