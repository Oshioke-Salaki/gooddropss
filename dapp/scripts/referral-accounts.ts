// One-off: give every existing referrer a fixed referral ACCOUNT, and merge
// anyone whose referrals were split across two keys by a GoodDollar root change.
//
//   npx tsx --env-file=.env.local scripts/referral-accounts.ts            # dry run: prints the plan
//   npx tsx --env-file=.env.local scripts/referral-accounts.ts --apply    # writes it
//
// Run AFTER the code with lib/referralLedger is deployed: the old code reads
// counts by "today's root", so a merge would hide a split-off count from it.
//
// What it does, per person (accounts joined by: the account, its prize wallet,
// and that wallet's identity root today):
//   • canonical = the account with the earliest referral (its history is the person's);
//   • every other account's referrals move into it with their ORIGINAL credit
//     times (competition order unchanged), referredBy pointers follow, the
//     leaderboard and competition participant sets follow, the old keys go;
//   • the person's wallet(s) and roots are bound to the canonical account.
// Safety: a group where a non-canonical account has prize payouts or paid slots
// is reported and SKIPPED (payout accounting is per account; move it by hand).
// Idempotent: re-running finds nothing left to merge and every bind is SET NX.

import { getRedis, keys } from "@/lib/redis";
import { resolveIdentityRootStrict } from "@/lib/identityRoot";

const APPLY = process.argv.includes("--apply");
const ADDR = /^0x[0-9a-f]{40}$/;

async function main() {
  const r = getRedis();
  if (!r) throw new Error("No Redis configured");

  const scan = async (match: string) => {
    let cur: string | number = 0; const out: string[] = [];
    do { const [c, k]: [string | number, string[]] = await r.scan(cur, { match, count: 1000 }); cur = c; out.push(...k); } while (String(cur) !== "0");
    return out;
  };

  const accounts = (await scan("gd:ref:of:*")).map((k) => k.slice("gd:ref:of:".length).toLowerCase()).filter((a) => ADDR.test(a));
  const accountSet = new Set(accounts);

  // Union-find over accounts.
  const parent = new Map(accounts.map((a) => [a, a]));
  const find = (a: string): string => { let x = a; while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };

  const wallets = new Map<string, Set<string>>(); // account → wallets/roots that belong to it
  for (const a of accounts) {
    const links = new Set<string>([a]);
    const w = ((await r.get<string>(keys.compPayoutWallet(a))) ?? "").toLowerCase();
    if (ADDR.test(w)) {
      links.add(w);
      try { links.add((await resolveIdentityRootStrict(w)).toLowerCase()); }
      catch { console.warn(`  ! couldn't read the root of ${w}; linking by wallet only`); }
    }
    wallets.set(a, links);
    for (const l of links) if (accountSet.has(l)) union(a, l);
  }

  const groups = new Map<string, string[]>();
  for (const a of accounts) groups.set(find(a), [...(groups.get(find(a)) ?? []), a]);

  const slotSets = await scan("gd:comp:ref:slots:*");
  const compReferrerSets = await scan("gd:comp:referrers:*");
  const firstCredit = async (a: string) => {
    const z = await r.zrange<(string | number)[]>(keys.referralCredited(a), 0, 0, { withScores: true });
    return z.length ? Number(z[1]) : Number.MAX_SAFE_INTEGER;
  };
  const hasPayouts = async (a: string) => {
    if ((await scan(`gd:comp:ref:paid:*:${a}`)).length) return true;
    for (const s of slotSets) if ((await r.smembers<string[]>(s)).some((m) => m.startsWith(`${a}|`))) return true;
    return false;
  };

  let merged = 0, skipped = 0, bound = 0;
  for (const members of groups.values()) {
    const ordered = (await Promise.all(members.map(async (a) => ({ a, t: await firstCredit(a), n: await r.scard(keys.referralsOf(a)) }))))
      .sort((x, y) => x.t - y.t || y.n - x.n);
    const canonical = ordered[0].a;
    const others = ordered.slice(1);

    if (others.length) {
      const blocked = [];
      for (const o of others) if (await hasPayouts(o.a)) blocked.push(o.a);
      if (blocked.length) {
        console.log(`SKIP ${canonical}: ${blocked.join(", ")} has prize payouts; merge by hand.`);
        skipped++;
        continue;
      }
      console.log(`MERGE into ${canonical} (${ordered[0].n} referrals): ${others.map((o) => `${o.a} (${o.n})`).join(", ")}`);
      if (APPLY) {
        for (const { a: from } of others) {
          const rows = await r.zrange<(string | number)[]>(keys.referralCredited(from), 0, -1, { withScores: true });
          const members2 = (await r.smembers<string[]>(keys.referralsOf(from))) ?? [];
          let added = 0;
          for (const inv of members2) {
            added += await r.sadd(keys.referralsOf(canonical), inv);
            const by = await r.get<string>(keys.referredBy(inv));
            if (!by || by.toLowerCase() === from) await r.set(keys.referredBy(inv), canonical);
          }
          for (let i = 0; i < rows.length; i += 2) {
            await r.zadd(keys.referralCredited(canonical), { nx: true }, { score: Number(rows[i + 1]), member: String(rows[i]) });
          }
          if (added) await r.zincrby(keys.referralLeaders(), added, canonical);
          await r.zrem(keys.referralLeaders(), from);
          for (const s of compReferrerSets) {
            if (await r.sismember(s, from)) { await r.sadd(s, canonical); await r.srem(s, from); }
          }
          // Waiting invites listed under the old key.
          const waiting = await r.zrange<(string | number)[]>(keys.refPendingOf(from), 0, -1, { withScores: true });
          for (let i = 0; i < waiting.length; i += 2) await r.zadd(keys.refPendingOf(canonical), { nx: true }, { score: Number(waiting[i + 1]), member: String(waiting[i]) });
          // Prize wallet: keep the canonical one if set, else take the newer account's.
          const pw = await r.get<string>(keys.compPayoutWallet(from));
          if (pw) await r.set(keys.compPayoutWallet(canonical), pw.toLowerCase(), { nx: true });
          await r.del(keys.referralsOf(from), keys.referralCredited(from), keys.refPendingOf(from));
        }
        // Verify the merge before moving on.
        const after = await r.scard(keys.referralsOf(canonical));
        console.log(`  → ${canonical} now has ${after}`);
      }
      merged++;
    }

    // Bind every wallet/root of this person to the canonical account.
    const links = new Set<string>();
    for (const m of members) for (const l of wallets.get(m) ?? []) links.add(l);
    for (const l of links) {
      const cur = await r.get<string>(keys.refAccount(l));
      if (cur && cur.toLowerCase() !== canonical) { console.log(`  ! ${l} is already bound to ${cur}; leaving it`); continue; }
      if (!cur) { bound++; if (APPLY) await r.set(keys.refAccount(l), canonical, { nx: true }); }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run"}: ${accounts.length} accounts in ${groups.size} people · ${merged} merged · ${skipped} skipped · ${bound} bindings ${APPLY ? "written" : "to write"}.`);
  if (!APPLY) console.log("Nothing was written. Re-run with --apply.");
}

main().catch((e) => { console.error(e); process.exit(1); });
