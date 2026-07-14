// Wallets allowed into /admin (batch drop seeding) and /admin/analytics.
//
// This is an APP-LEVEL allowlist, not on-chain authority. The GoodDrops contract
// owner is still 0xb291…b1c7 alone, so nothing here grants pause/setGpsSigner/
// upgrade rights. The admin pages only seed drops (createDrop — permissionless
// anyway) and read analytics, so widening this is safe.
//
// It is also NOT the security boundary: /admin sits behind the server-side
// ADMIN_PASSWORD gate (see adminAuth.ts), which fails closed. This list just says
// which connected wallet the UI will render the tools for.
const ADMIN_ADDRESSES = [
  "0xb2914810724fe2fb871960eb200dea427854b1c7",
  "0xad0e3ffae25c836935a99289aaf2362ac7ad6584",
] as const;

export function isAdminAddress(address?: string | null): boolean {
  if (!address) return false;
  return ADMIN_ADDRESSES.includes(
    address.toLowerCase() as (typeof ADMIN_ADDRESSES)[number],
  );
}
