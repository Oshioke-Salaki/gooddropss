// Normalise a private key read from env into viem's required 0x-prefixed,
// 32-byte hex form. Accepts keys stored WITH or WITHOUT the `0x` prefix — a
// very common .env foot-gun that otherwise makes `privateKeyToAccount` throw
// "invalid private key". Returns undefined for missing/malformed values so
// callers can fail cleanly instead of crashing the request.
export function normalizePk(raw: string | undefined | null): `0x${string}` | undefined {
  if (!raw) return undefined;
  const hex = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  return `0x${hex.toLowerCase()}` as `0x${string}`;
}
