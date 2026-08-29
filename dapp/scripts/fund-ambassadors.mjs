// Bulk-fund ambassadors with circulation G$ so they can drop for their friends.
// Reads a wallet list from scripts/ambassadors.txt (one per line; either
//   0xADDRESS            -> uses --amount
//   0xADDRESS 2500       -> per-line amount in whole G$
// Blank lines and lines starting with # are ignored. Idempotent (skips wallets
// already funded in the ledger) and DRY-RUN by default. Run from the dapp dir:
//
//   node --env-file=.env.local scripts/fund-ambassadors.mjs --amount=5000
//   node --env-file=.env.local scripts/fund-ambassadors.mjs --amount=5000 --send
//
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, getAddress, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const G_TOKEN = getAddress("0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A");
const REWARD_WALLET = getAddress("0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605");
const DIR = dirname(fileURLToPath(import.meta.url));
const LIST = join(DIR, "ambassadors.txt");
const LEDGER = join(DIR, "ambassador-funding.json");
const SEND = process.argv.includes("--send");
const DEFAULT_AMT = Number((process.argv.find((a) => a.startsWith("--amount=")) ?? "").split("=")[1] || "0");

if (!existsSync(LIST)) {
  console.error(`✗ ${LIST} not found. Create it with one wallet per line (0xADDRESS or "0xADDRESS 2500").`);
  process.exit(1);
}
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const recipients = readFileSync(LIST, "utf8").split("\n").map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => { const [addr, amt] = l.split(/[\s,]+/); return { addr, g$: amt ? Number(amt) : DEFAULT_AMT }; });

const bad = recipients.filter((r) => !ADDR_RE.test(r.addr) || !(r.g$ > 0));
if (bad.length) { console.error("✗ Invalid lines:", bad); process.exit(1); }

let key = process.env.GAS_FAUCET_KEY;
if (!key) { console.error("✗ GAS_FAUCET_KEY not set (load with --env-file=.env.local)"); process.exit(1); }
if (!key.startsWith("0x")) key = "0x" + key;
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== REWARD_WALLET) { console.error(`✗ Key is ${account.address}, not the reward wallet.`); process.exit(1); }

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
const publicClient = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
const walletClient = createWalletClient({ account, chain: celo, transport: http("https://forno.celo.org") });

const pending = recipients.filter((r) => !ledger[r.addr.toLowerCase()]?.txHash);
const totalG = pending.reduce((s, r) => s + r.g$, 0);
console.log(`\nAmbassador funding  ${SEND ? "🔴 LIVE (--send)" : "🟡 DRY RUN"}`);
console.log(`Recipients: ${recipients.length} · already funded: ${recipients.length - pending.length} · to fund now: ${pending.length} (${totalG.toLocaleString()} G$)\n`);

const bal = await publicClient.readContract({ address: G_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [REWARD_WALLET] });
console.log(`Reward wallet G$ balance: ${Number(formatUnits(bal, 18)).toLocaleString()} G$`);
if (bal < parseUnits(String(totalG), 18)) { console.error(`✗ Insufficient G$ (need ${totalG.toLocaleString()}).`); process.exit(1); }
console.log("");

for (const r of recipients) {
  const addr = getAddress(r.addr);
  const done = ledger[addr.toLowerCase()]?.txHash;
  const tag = `${addr}  ${r.g$.toLocaleString().padStart(8)} G$`;
  if (done) { console.log(`⏭  ${tag}  (already: ${done})`); continue; }
  if (!SEND) { console.log(`•  ${tag}`); continue; }
  try {
    const hash = await walletClient.writeContract({ address: G_TOKEN, abi: erc20Abi, functionName: "transfer", args: [addr, parseUnits(String(r.g$), 18)] });
    await publicClient.waitForTransactionReceipt({ hash });
    ledger[addr.toLowerCase()] = { g$: r.g$, txHash: hash, at: new Date().toISOString() };
    save();
    console.log(`✅ ${tag}  ${hash}`);
  } catch (e) {
    console.error(`✗  ${tag}  FAILED: ${e.shortMessage ?? e.message}`);
    console.error("   Stopping; re-run to resume (already-funded are skipped).");
    process.exit(1);
  }
}
console.log(`\n${SEND ? "Done." : "Dry run complete — re-run with --send to fund."}`);
