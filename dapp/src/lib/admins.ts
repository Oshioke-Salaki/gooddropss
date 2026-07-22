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
const BUILTIN_ADMINS = [
  "0xb2914810724fe2fb871960eb200dea427854b1c7",
  "0xad0e3ffae25c836935a99289aaf2362ac7ad6584",
];

// Append more admins WITHOUT a code change via a comma-separated env var, e.g.
//   NEXT_PUBLIC_ADMIN_ADDRESSES="0xabc…,0xdef…"
// NEXT_PUBLIC so the client UI gate and the server-side write checks (landmarks)
// read the exact same list. Malformed entries are ignored.
const ENV_ADMINS = (process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? "")
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter((a) => /^0x[0-9a-f]{40}$/.test(a));

const ADMIN_SET = new Set<string>([
  ...BUILTIN_ADMINS.map((a) => a.toLowerCase()),
  ...ENV_ADMINS,
]);

export function isAdminAddress(address?: string | null): boolean {
  if (!address) return false;
  return ADMIN_SET.has(address.toLowerCase());
}
