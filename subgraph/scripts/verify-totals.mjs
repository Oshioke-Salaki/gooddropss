// Compare a deployment's running totals (GlobalStats) with a full count of its
// drops. Run before pointing the app at a new version:
//
//   node scripts/verify-totals.mjs https://api.goldsky.com/api/public/<project>/subgraphs/gooddrops/<version>/gn
//
// Exits 0 when every total matches, 1 otherwise.

const url = process.argv[2];
if (!url) { console.error("usage: node scripts/verify-totals.mjs <subgraph url>"); process.exit(2); }

async function q(query, variables = {}) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await res.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

let g, _meta;
try {
  ({ globalStats: g, _meta } = await q(`{ _meta { block { number } } globalStats(id: "global") {
  drops claims reclaims droppedWei claimedWei reclaimedWei activeCount activeWei droppers hunters } }`));
} catch (e) {
  console.error(/no field `globalStats`/.test(e.message)
    ? "This deployment has no running totals (it's the older version). Point this at the new one."
    : `Couldn't read the subgraph: ${e.message}`);
  process.exit(1);
}
if (!g) { console.error("No GlobalStats yet: is this a v2 deployment, and has it indexed a drop?"); process.exit(1); }

const want = { drops: 0n, claims: 0n, reclaims: 0n, droppedWei: 0n, claimedWei: 0n, reclaimedWei: 0n, activeCount: 0n, activeWei: 0n };
const droppers = new Set(), hunters = new Set();
let lastId = "";
for (;;) {
  const { drops } = await q(`query($l: ID!, $b: Int!) { drops(first: 1000, orderBy: id, where: { id_gt: $l }, block: { number: $b }) {
    id dropper claimer amount status } }`, { l: lastId, b: _meta.block.number });
  for (const d of drops) {
    const amt = BigInt(d.amount);
    want.drops++; want.droppedWei += amt; droppers.add(d.dropper);
    if (d.status === 1) { want.claims++; want.claimedWei += amt; hunters.add(d.claimer); }
    else if (d.status === 2) { want.reclaims++; want.reclaimedWei += amt; }
    else { want.activeCount++; want.activeWei += amt; }
  }
  if (drops.length < 1000) break;
  lastId = drops[drops.length - 1].id;
}
want.droppers = BigInt(droppers.size);
want.hunters = BigInt(hunters.size);

let ok = true;
for (const [k, v] of Object.entries(want)) {
  const got = BigInt(g[k]);
  const same = got === v;
  ok &&= same;
  console.log(`${same ? "ok  " : "DIFF"} ${k.padEnd(13)} totals ${got}  count ${v}`);
}
console.log(ok ? `\nAll totals match at block ${_meta.block.number}.` : "\nTotals differ: do not switch the app to this version.");
process.exit(ok ? 0 : 1);
