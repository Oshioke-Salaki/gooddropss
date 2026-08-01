import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });

// Requested winners (by the names you gave)
const NAMES = ["Shadow", "Ls_Coin", "Boss", "Big Bounty", "Terry", "Black Butler", "Coins"];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Build username -> root from gd:username:* keys
const map = {}; // normalizedUsername -> { stored, root }
let cursor = "0";
do {
  const [next, keys] = await redis.scan(cursor, { match: "gd:username:*", count: 500 });
  cursor = String(next);
  for (const k of keys) {
    const stored = k.slice("gd:username:".length);
    const root = await redis.get(k);
    if (root) map[norm(stored)] = { stored, root: String(root).toLowerCase() };
  }
} while (cursor !== "0");

// Resolve each requested name + confirm the display username on the profile
const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });
console.log("\nusername (requested)   →  @stored            root address");
console.log("──────────────────────────────────────────────────────────────────────");
for (const name of NAMES) {
  const hit = map[norm(name)];
  if (!hit) { console.log(`❌ "${name}"  →  NOT FOUND (no such username in profiles)`); continue; }
  const prof = await redis.get(`gd:profile:${hit.root}`).catch(() => null);
  const disp = prof?.username ?? hit.stored;
  console.log(`✅ ${name.padEnd(20)} →  @${disp.padEnd(16)} ${hit.root}`);
}

// Prize wallet G$ balance
const G$ = "0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A";
const bal = await pub.readContract({
  address: G$, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
  functionName: "balanceOf", args: ["0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605"],
});
const celoBal = await pub.getBalance({ address: "0x4412C27Bb9caae546E71Fc3D4cE7F328F11E6605" });
console.log(`\nPrize wallet 0x4412C27B…6605:  ${(Number(bal) / 1e18).toLocaleString()} G$   ·   ${(Number(celoBal) / 1e18).toFixed(3)} CELO`);
console.log("Need: 933,333 G$ per category (hunters, then droppers) = 1,866,666 G$ total\n");
