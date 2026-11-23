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

// A shop owner signs this once to unlock their reward scanner on this phone for
// 12 hours (lib/scannerSession). Worded for the wallet prompt.
export function scannerSessionMessage(address: string, timestamp: number): string {
  return `Unlock the GoodDrops reward scanner\nWallet: ${address.toLowerCase()}\nTime: ${timestamp}\n\nLets this phone approve your shop's rewards for 12 hours. It can't take anything from your wallet.`;
}
