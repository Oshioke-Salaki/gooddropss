// Pay the tiered competition winners (top N) their prizes — run once AFTER the
// competition ends. Reads the final leaderboard from the live API, resolves each
// winner's current wallet, and pays their tier prize from the reward wallet.
// Idempotent (skips already-paid) and DRY-RUN by default. Run from the dapp dir:
//
//   node --env-file=.env.local scripts/pay-tiered.mjs             # dry run
//   node --env-file=.env.local scripts/pay-tiered.mjs --send      # actually pay
//   ... --api=https://gooddrops.xyz   (override leaderboard source)
//   ... --force                       (pay even if the contest isn't 'ended' yet)
//
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, getAddress, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { Redis } from "@upstash/redis";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const G_TOKEN = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const REWARD_WALLET = getAddress("0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605");
const LEDGER = join(dirname(fileURLToPath(import.meta.url)), "tiered-payouts.json");
const SEND = process.argv.includes("--send");
const FORCE = process.argv.includes("--force");
const API = (process.argv.find((a) => a.startsWith("--api=")) ?? "").split("=")[1] || "https://gooddrops.xyz";

const res = await fetch(`${API}/api/comp/leaderboard`);
const board = await res.json();
if (board.mode !== "tiered") { console.error(`✗ Competition is not in tiered mode (mode=${board.mode}).`); process.exit(1); }
if (board.phase !== "ended" && !FORCE) { console.error(`✗ Competition phase is '${board.phase}', not 'ended'. Re-run with --force to pay early.`); process.exit(1); }

const winners = (board.participants ?? []).filter((p) => p.prizeG > 0);
if (winners.length === 0) { console.error("✗ No winners with a prize on the board."); process.exit(1); }

const redis = Redis.fromEnv();
// Resolve each winner's payout wallet (the one their invite link was made from).
for (const w of winners) {
  const wallet = await redis.get(`gd:comp:wallet:${w.root.toLowerCase()}`);
  w.payout = getAddress(wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet : w.root);
}

let key = process.env.GAS_FAUCET_KEY;
if (!key) { console.error("✗ GAS_FAUCET_KEY not set."); process.exit(1); }
if (!key.startsWith("0x")) key = "0x" + key;
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== REWARD_WALLET) { console.error(`✗ Key is ${account.address}, not the reward wallet.`); process.exit(1); }

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const walletClient = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

const pending = winners.filter((w) => !ledger[w.root.toLowerCase()]?.txHash);
const totalG = pending.reduce((s, w) => s + w.prizeG, 0);
console.log(`\nTiered payout  ${SEND ? "🔴 LIVE (--send)" : "🟡 DRY RUN"}  (source: ${API})`);
console.log(`Winners: ${winners.length} · already paid: ${winners.length - pending.length} · to pay now: ${pending.length} (${totalG.toLocaleString()} G$)\n`);

const bal = await publicClient.readContract({ address: G_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET] });
console.log(`Reward wallet G$ balance: ${Number(formatUnits(bal, 18)).toLocaleString()} G$`);
if (bal < parseUnits(String(totalG), 18)) { console.error(`✗ Insufficient G$ (need ${totalG.toLocaleString()}).`); process.exit(1); }
console.log("");

for (const w of winners) {
  const handle = w.username ? `@${w.username}` : `${w.root.slice(0, 8)}…`;
  const tag = `#${w.rank} ${handle.padEnd(16)} ${w.prizeG.toLocaleString().padStart(8)} G$  → ${w.payout}  (${w.score} pts · ${w.reach} reached)`;
  if (ledger[w.root.toLowerCase()]?.txHash) { console.log(`⏭  ${tag}  paid: ${ledger[w.root.toLowerCase()].txHash}`); continue; }
  if (!SEND) { console.log(`•  ${tag}`); continue; }
  try {
    const hash = await walletClient.writeContract({ address: G_TOKEN, abi: erc20Abi, functionName: "transfer", args: [w.payout, parseUnits(String(w.prizeG), 18)] });
    await publicClient.waitForTransactionReceipt({ hash });
    ledger[w.root.toLowerCase()] = { rank: w.rank, username: w.username, g$: w.prizeG, to: w.payout, txHash: hash, at: new Date().toISOString() };
    save();
    console.log(`✅ ${tag}  ${hash}`);
  } catch (e) {
    console.error(`✗  ${tag}  FAILED: ${e.shortMessage ?? e.message}`);
    console.error("   Stopping; re-run to resume (already-paid are skipped).");
    process.exit(1);
  }
}
console.log(`\n${SEND ? "Done." : "Dry run complete — re-run with --send to pay winners."}`);
