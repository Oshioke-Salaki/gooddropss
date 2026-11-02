// What a wallet signs to start a session (see lib/walletSession). Shared by the
// client and the server; dependency-free. Worded for the wallet prompt: people
// should see plainly that signing moves nothing.
export function walletSessionMessage(address: string, timestamp: number): string {
  return `Sign in to GoodDrops\nWallet: ${address.toLowerCase()}\nTime: ${timestamp}\n\nThis only proves the wallet is yours. It can't move any funds.`;
}
