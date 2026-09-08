// Pay the REFERRAL competition — run once AFTER it ends. Reads the final referral
// leaderboard from the live API and pays each unlocked referrer their earned G$
// (covered referrals × per-referral rate). Idempotent and DRY-RUN by default.
//
//   node --env-file=.env.local scripts/pay-referrals.mjs --api=https://www.gooddrops.xyz
//   node --env-file=.env.local scripts/pay-referrals.mjs --api=https://www.gooddrops.xyz --send
//   ... --root    (pay the identity root shown on the leaderboard)
//   ... --force   (pay even if the contest isn't 'ended' yet)
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
const LEDGER = join(dirname(fileURLToPath(import.meta.url)), "referral-payouts.json");
const SEND = process.argv.includes("--send");
const FORCE = process.argv.includes("--force");
// Default: pay the wallet they actively use in GoodDrops (gd:comp:wallet:<root>),
// falling back to the root. --root forces the identity root instead.
const USE_ROOT = process.argv.includes("--root");
const API = (process.argv.find((a) => a.startsWith("--api=")) ?? "").split("=")[1] || "https://www.gooddrops.xyz";

const res = await fetch(`${API}/api/comp/referrals`);
const board = await res.json();
if (!board?.ok) { console.error("✗ Could not read the referral leaderboard."); process.exit(1); }
if (board.phase !== "ended" && !FORCE) { console.error(`✗ Phase is '${board.phase}', not 'ended'. Re-run with --force to pay early.`); process.exit(1); }

// Only unlocked referrers with a non-zero earned amount get paid.
const winners = (board.participants ?? []).filter((p) => p.unlocked && BigInt(p.earnedWei ?? "0") > 0n);
if (winners.length === 0) { console.error("✗ Nobody has earned anything on the referral board."); process.exit(1); }

const redis = Redis.fromEnv();
for (const w of winners) {
  if (USE_ROOT) { w.payout = getAddress(w.root); continue; }
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
const totalWei = pending.reduce((s, w) => s + BigInt(w.earnedWei), 0n);
const totalG = Number(formatUnits(totalWei, 18));
console.log(`\nReferral payout  ${SEND ? "🔴 LIVE (--send)" : "🟡 DRY RUN"}  (source: ${API})`);
console.log(`Earners: ${winners.length} · already paid: ${winners.length - pending.length} · to pay now: ${pending.length} (${totalG.toLocaleString()} G$)`);
if (board.stats) console.log(`Pot: ${Number(formatUnits(BigInt(board.stats.potWei), 18)).toLocaleString()} G$ · slots ${board.stats.slotsUsed}/${board.stats.slots} used\n`);

const bal = await publicClient.readContract({ address: G_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET] });
const gas = await publicClient.getBalance({ address: REWARD_WALLET });
console.log(`Reward wallet: ${Number(formatUnits(bal, 18)).toLocaleString()} G$ · ${Number(formatUnits(gas, 18)).toFixed(3)} CELO gas`);
if (bal < totalWei) {
  console.error(`✗ Insufficient G$ — need ${totalG.toLocaleString()}, short by ~${Math.ceil(totalG - Number(formatUnits(bal, 18))).toLocaleString()} G$.`);
  process.exit(1);
}
if (gas === 0n) { console.error("✗ No CELO for gas."); process.exit(1); }
console.log("");

for (const w of winners) {
  const handle = w.username ? `@${w.username}` : `${w.root.slice(0, 8)}…`;
  const amtG = Number(formatUnits(BigInt(w.earnedWei), 18));
  const tag = `#${String(w.rank).padStart(2)} ${handle.padEnd(16)} ${amtG.toLocaleString().padStart(9)} G$  → ${w.payout}  (${w.covered}/${w.count} referrals)`;
  if (ledger[w.root.toLowerCase()]?.txHash) { console.log(`⏭  ${tag}  paid: ${ledger[w.root.toLowerCase()].txHash}`); continue; }
  if (!SEND) { console.log(`•  ${tag}`); continue; }
  try {
    const hash = await walletClient.writeContract({
      address: G_TOKEN, abi: erc20Abi, functionName: "transfer",
      args: [w.payout, BigInt(w.earnedWei)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    ledger[w.root.toLowerCase()] = { rank: w.rank, username: w.username, g$: amtG, referrals: w.covered, to: w.payout, txHash: hash, at: new Date().toISOString() };
    save();
    console.log(`✅ ${tag}  ${hash}`);
  } catch (e) {
    console.error(`✗  ${tag}  FAILED: ${e.shortMessage ?? e.message}`);
    console.error("   Stopping; re-run to resume (already-paid are skipped).");
    process.exit(1);
  }
}
console.log(`\n${SEND ? "Done." : "Dry run complete — re-run with --send to pay."}`);
