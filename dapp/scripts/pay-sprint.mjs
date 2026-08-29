// Campus Sprint prize distribution — pays G$ from the reward wallet to the top-10
// sprint winners. Idempotent (skips anyone already paid in the ledger) and DRY-RUN
// by default. Run from the dapp dir so viem + .env.local resolve:
//
//   node --env-file=.env.local scripts/pay-sprint.mjs            # dry run (default)
//   node --env-file=.env.local scripts/pay-sprint.mjs --send     # actually transfer
//
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, getAddress, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const G_TOKEN      = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const REWARD_WALLET = getAddress("0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605");
const LEDGER = join(dirname(fileURLToPath(import.meta.url)), "sprint-payouts.json");
const SEND = process.argv.includes("--send");

// Top-10 Campus Sprint (Aug 17–20, 2026). Addresses resolved from the username
// index; @Emme is rank 7 (displayed as "Ramadan" on the board — per admin).
const WINNERS = [
  { rank: 1,  handle: "Blackbutler",  address: "0x82a6c050f58cbc4002cd11a2862b11400e430b8d", g$: 200_000 },
  { rank: 2,  handle: "Ghostbusters", address: "0xc2c2885a36ccf297bea31be2ff2fdc13101b21f1", g$: 120_000 },
  { rank: 3,  handle: "Shadow",       address: "0x199cdc1ca5efc16e2f41e66b047b0305e2bd7ebf", g$: 80_000 },
  { rank: 4,  handle: "Natasha",      address: "0x1b007dd8f96ac3cd74dda2e2766f017dc70d2a1d", g$: 14_000 },
  { rank: 5,  handle: "bigbounty",    address: "0x80f9f37d92bb0cbbfa0efebe9dbd6e519ed872f8", g$: 14_000 },
  { rank: 6,  handle: "spicyBeatz",   address: "0xf4efb99a1205dd4cd4249bc92a8b0e53aa373dd2", g$: 14_000 },
  { rank: 7,  handle: "Emme",         address: "0x6218a69c190227d6005f84a1517eb31a6c170bce", g$: 14_000 },
  { rank: 8,  handle: "MR9",          address: "0x85685c0064ee848931350382846e76c7610db04d", g$: 14_000 },
  { rank: 9,  handle: "Abuammar",     address: "0xe2d38281be8833d79f0d4ea50367b35986d77ba7", g$: 14_000 },
  { rank: 10, handle: "Chubs",        address: "0x9a30217d31dea57a220d7fc62ccae007e6535566", g$: 14_000 },
];

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));

let key = process.env.GAS_FAUCET_KEY;
if (!key) { console.error("✗ GAS_FAUCET_KEY not set (load with --env-file=.env.local)"); process.exit(1); }
if (!key.startsWith("0x")) key = "0x" + key;
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== REWARD_WALLET) {
  console.error(`✗ GAS_FAUCET_KEY wallet ${account.address} is NOT the reward wallet ${REWARD_WALLET}. Aborting.`);
  process.exit(1);
}

const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const walletClient = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

const pending = WINNERS.filter((w) => !ledger[w.address.toLowerCase()]?.txHash);
const totalG = pending.reduce((s, w) => s + w.g$, 0);

console.log(`\nCampus Sprint payout  ${SEND ? "🔴 LIVE (--send)" : "🟡 DRY RUN"}`);
console.log(`Reward wallet: ${REWARD_WALLET}`);
console.log(`Winners: ${WINNERS.length} · already paid: ${WINNERS.length - pending.length} · to pay now: ${pending.length} (${totalG.toLocaleString()} G$)\n`);

const bal = await publicClient.readContract({ address: G_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET] });
console.log(`Reward wallet G$ balance: ${Number(formatUnits(bal, 18)).toLocaleString()} G$`);
if (bal < parseUnits(String(totalG), 18)) {
  console.error(`✗ Insufficient G$ (need ${totalG.toLocaleString()}). Aborting.`); process.exit(1);
}
console.log("");

for (const w of WINNERS) {
  const addr = getAddress(w.address);
  const tag = `#${w.rank} @${w.handle}  ${w.g$.toLocaleString().padStart(8)} G$  ${addr}`;
  if (ledger[addr.toLowerCase()]?.txHash) { console.log(`⏭  ${tag}  (already paid: ${ledger[addr.toLowerCase()].txHash})`); continue; }
  if (!SEND) { console.log(`•  ${tag}`); continue; }
  try {
    const hash = await walletClient.writeContract({
      address: G_TOKEN, abi: erc20Abi, functionName: "transfer",
      args: [addr, parseUnits(String(w.g$), 18)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    ledger[addr.toLowerCase()] = { handle: w.handle, rank: w.rank, g$: w.g$, txHash: hash, at: new Date().toISOString() };
    save();
    console.log(`✅ ${tag}  ${hash}`);
  } catch (e) {
    console.error(`✗  ${tag}  FAILED: ${e.shortMessage ?? e.message}`);
    console.error("   Stopping so you can investigate; re-run to resume (already-paid are skipped).");
    process.exit(1);
  }
}

console.log(`\n${SEND ? "Done." : "Dry run complete — re-run with --send to distribute."}`);
