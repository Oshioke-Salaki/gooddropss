// ─────────────────────────────────────────────────────────────────────────────
// GoodDrops — Week 1 competition payout (winners chosen by the team, by username).
//
//   node scripts/pay-prizes.mjs --hunters              # DRY RUN (prints plan, sends nothing)
//   node scripts/pay-prizes.mjs --hunters  --send      # pay the top 5 HUNTERS
//   node scripts/pay-prizes.mjs --droppers             # DRY RUN for droppers
//   node scripts/pay-prizes.mjs --droppers --send      # pay the top 5 DROPPERS (tomorrow)
//
// Reads dapp/.env.local for PRIZE_WALLET_KEY (falls back to GAS_FAUCET_KEY, since the
// prize wallet 0x4412…6605 is the same wallet). Sends G$ (ERC-20 transfer).
//
// SAFETY:
//  · dry-run unless --send            · asserts the sending wallet == the stated prize wallet
//  · checks G$ + CELO before sending  · ledger (scripts/prize-payouts.json) → never double-pays
//  · pays HUNTERS and DROPPERS independently (some people are in both lists)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseUnits, formatEther, getAddress } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const G$ = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const PRIZE_WALLET = "0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605"; // the stated prize wallet
const RATE = Number(process.env.GDOLLAR_USD ?? "0.000117");        // $ per G$ (current market price)
const USD = { 1: 8, 2: 7, 3: 6, 4: 4, 5: 3 };
const g = (usd) => parseUnits(String(Math.round(usd / RATE)), 18); // whole-G$ amount

// Winners by RANK — addresses resolved from @username via the profile store.
const HUNTERS = [
  { rank: 1, name: "Shadow",      addr: "0x199cdc1ca5efc16e2f41e66b047b0305e2bd7ebf" },
  { rank: 2, name: "LS_Coin",     addr: "0xc2c2885a36ccf297bea31be2ff2fdc13101b21f1" },
  { rank: 3, name: "Boss",        addr: "0x1b007dd8f96ac3cd74dda2e2766f017dc70d2a1d" },
  { rank: 4, name: "Big Bounty",  addr: "0x80f9f37d92bb0cbbfa0efebe9dbd6e519ed872f8" },
  { rank: 5, name: "Terry",       addr: "0xd765e7cff224dd97d30b9bcf7232846e3a0284da" },
];
const DROPPERS = [
  { rank: 1, name: "LS_Coin",     addr: "0xc2c2885a36ccf297bea31be2ff2fdc13101b21f1" },
  { rank: 2, name: "Shadow",      addr: "0x199cdc1ca5efc16e2f41e66b047b0305e2bd7ebf" },
  { rank: 3, name: "Black Butler",addr: "0x82a6c050f58cbc4002cd11a2862b11400e430b8d" },
  { rank: 4, name: "Coins",       addr: "0x0cf73ce39dc6ce537dc6288567236864598a5ad8" },
  { rank: 5, name: "Boss",        addr: "0x1b007dd8f96ac3cd74dda2e2766f017dc70d2a1d" },
];

const SEND = process.argv.includes("--send");
const cat = process.argv.includes("--hunters") ? "hunters" : process.argv.includes("--droppers") ? "droppers" : null;
if (!cat) { console.error("Pass --hunters or --droppers (add --send to actually pay)."); process.exit(1); }
const list = (cat === "hunters" ? HUNTERS : DROPPERS).map((w) => ({ ...w, g: g(USD[w.rank]), usd: USD[w.rank] }));

const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const ERC20 = [
  { type: "function", name: "transfer",  stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view",       inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];
const fmt = (wei) => (Number(wei) / 1e18).toLocaleString();
const total = list.reduce((s, w) => s + w.g, 0n);

console.log(`\n${cat.toUpperCase()} payout  ·  rate $${RATE}/G$\n`);
for (const w of list) console.log(`  #${w.rank} ${w.name.padEnd(13)} $${w.usd}  →  ${fmt(w.g).padStart(9)} G$   ${w.addr}`);
console.log(`\n  TOTAL: ${fmt(total)} G$\n`);

const LEDGER = new URL("./prize-payouts.json", import.meta.url);
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};

if (!SEND) { console.log("DRY RUN — nothing sent. Re-run with --send to pay.\n"); process.exit(0); }

// ── Send ─────────────────────────────────────────────────────────────────────
let key = env.PRIZE_WALLET_KEY ?? env.GAS_FAUCET_KEY;
if (!key) { console.error("❌ Set PRIZE_WALLET_KEY (or GAS_FAUCET_KEY) in .env.local"); process.exit(1); }
key = key.startsWith("0x") ? key : `0x${key}`;
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== PRIZE_WALLET.toLowerCase()) {
  console.error(`❌ Wallet mismatch: key is ${account.address}, expected prize wallet ${PRIZE_WALLET}. Aborting.`); process.exit(1);
}
const wallet = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

const [gBal, celoBal] = await Promise.all([
  pub.readContract({ address: G$, abi: ERC20, functionName: "balanceOf", args: [account.address] }),
  pub.getBalance({ address: account.address }),
]);
console.log(`Prize wallet ${account.address}\n  G$: ${fmt(gBal)}   CELO: ${formatEther(celoBal)}\n`);
if (gBal < total) { console.error(`❌ Not enough G$ (need ${fmt(total)}, have ${fmt(gBal)}). Fund the wallet first.`); process.exit(1); }
if (celoBal < parseUnits("1", 16)) { console.error("❌ Low CELO for gas — add ~0.05 CELO."); process.exit(1); }

for (const w of list) {
  const lk = `${cat}:${w.addr.toLowerCase()}`;
  if (ledger[lk]) { console.log(`  ↷ skip #${w.rank} ${w.name} (already paid: ${ledger[lk]})`); continue; }
  try {
    const hash = await wallet.writeContract({ address: G$, abi: ERC20, functionName: "transfer", args: [getAddress(w.addr), w.g] });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error("reverted");
    ledger[lk] = hash; writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
    console.log(`  ✅ #${w.rank} ${w.name.padEnd(13)} ${fmt(w.g)} G$ → ${w.addr}   ${hash}`);
  } catch (e) {
    console.error(`  ❌ FAILED #${w.rank} ${w.name}: ${e.shortMessage || e.message}. Ledger saved — re-run to retry the rest.`); process.exit(1);
  }
}
console.log(`\n✅ ${cat} done. Ledger: scripts/prize-payouts.json\n`);
