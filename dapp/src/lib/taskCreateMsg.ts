// Signed-message strings for the merchant task flow. Kept in a dependency-free
// module so both client components and server routes can import them without
// pulling server-only code (node:crypto in taskLock) into the browser bundle.

// A merchant signs this to attach a task record to a drop they created.
export function taskCreateMessage(dropId: string, spotId: string): string {
  return `GOODDROPS_TASK_CREATE:${dropId}:${spotId}`;
}

// A merchant signs this to approve a hunter's scanned QR. Bound to the nonce so
// the signature can't be replayed for another scan.
export function approveMessage(nonce: string): string {
  return `GOODDROPS_TASK_APPROVE:${nonce}`;
}
