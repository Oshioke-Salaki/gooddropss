// Social-media campaign payout — 4 winners × 100,000 G$ = 400,000 G$.
// Idempotent (skips anyone already paid, recorded in scripts/social-payouts.json)
// and DRY-RUN by default. Run from the dapp dir:
//
//   node --env-file=.env.local scripts/pay-social.mjs           # dry run
//   node --env-file=.env.local scripts/pay-social.mjs --send    # actually pay
//
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, getAddress, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const G_TOKEN = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const REWARD_WALLET = getAddress("0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605");
const LEDGER = join(dirname(fileURLToPath(import.meta.url)), "social-payouts.json");
const SEND = process.argv.includes("--send");
const PRIZE_G = 100_000;

// Winners, resolved to their GoodDollar identity roots (the address shown on their
// GoodDrops profile / leaderboard), consistent with the Big Drop payout.
const WINNERS = [
  { name: "Abuammar",     address: "0xE2D38281BE8833d79f0D4ea50367B35986d77bA7" },
  { name: "Blackbutler",  address: "0x841542404F54eD377905a1277617fe862A985EC9" },
  { name: "Gooddollars",  address: "0x199cDc1ca5EFc16E2f41E66B047b0305E2bD7eBf" },
  { name: "Ghostbusters", address: "0xc2C2885A36ccF297Bea31be2fF2FdC13101b21F1" },
];

let key = process.env.GAS_FAUCET_KEY;
if (!key) { console.error("✗ GAS_FAUCET_KEY not set (load with --env-file=.env.local)"); process.exit(1); }
if (!key.startsWith("0x")) key = "0x" + key;
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== REWARD_WALLET) { console.error(`✗ Key is ${account.address}, not the reward wallet.`); process.exit(1); }

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const walletClient = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

const pending = WINNERS.filter((w) => !ledger[w.address.toLowerCase()]?.txHash);
const totalG = pending.length * PRIZE_G;
console.log(`\nSocial campaign payout  ${SEND ? "🔴 LIVE (--send)" : "🟡 DRY RUN"}`);
console.log(`Winners: ${WINNERS.length} · already paid: ${WINNERS.length - pending.length} · to pay now: ${pending.length} (${totalG.toLocaleString()} G$)\n`);

const bal = await publicClient.readContract({ address: G_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET] });
const gas = await publicClient.getBalance({ address: REWARD_WALLET });
console.log(`Reward wallet: ${Number(formatUnits(bal, 18)).toLocaleString()} G$ · ${Number(formatUnits(gas, 18)).toFixed(3)} CELO gas`);
if (bal < parseUnits(String(totalG), 18)) {
  const short = totalG - Number(formatUnits(bal, 18));
  console.error(`✗ Insufficient G$ — need ${totalG.toLocaleString()}, short by ~${Math.ceil(short).toLocaleString()} G$. Top up the reward wallet and re-run.`);
  process.exit(1);
}
if (gas === 0n) { console.error("✗ No CELO for gas."); process.exit(1); }
console.log("");

for (const w of WINNERS) {
  const addr = getAddress(w.address);
  const done = ledger[addr.toLowerCase()]?.txHash;
  const tag = `@${w.name.padEnd(14)} ${PRIZE_G.toLocaleString().padStart(8)} G$  → ${addr}`;
  if (done) { console.log(`⏭  ${tag}  (already: ${done})`); continue; }
  if (!SEND) { console.log(`•  ${tag}`); continue; }
  try {
    const hash = await walletClient.writeContract({
      address: G_TOKEN, abi: erc20Abi, functionName: "transfer",
      args: [addr, parseUnits(String(PRIZE_G), 18)],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    ledger[addr.toLowerCase()] = { username: w.name, g$: PRIZE_G, to: addr, txHash: hash, at: new Date().toISOString() };
    save();
    console.log(`✅ ${tag}  ${hash}`);
  } catch (e) {
    console.error(`✗  ${tag}  FAILED: ${e.shortMessage ?? e.message}`);
    console.error("   Stopping; re-run to resume (already-paid are skipped).");
    process.exit(1);
  }
}
console.log(`\n${SEND ? "Done." : "Dry run complete — re-run with --send to pay winners."}`);
