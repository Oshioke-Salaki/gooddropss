import { BigInt, Address } from "@graphprotocol/graph-ts";
import {
  DropCreated,
  DropClaimed,
  DropReclaimed,
  DropExtended,
} from "../generated/GoodDrops/GoodDrops";
import { Drop, GlobalStats, DailyStats, Account } from "../generated/schema";

const ZERO = BigInt.fromI32(0);
const ONE = BigInt.fromI32(1);
const SECONDS_PER_DAY = 86400;

// ── Running totals ───────────────────────────────────────────────────────────

function globalStats(): GlobalStats {
  let g = GlobalStats.load("global");
  if (g == null) {
    g = new GlobalStats("global");
    g.drops = ZERO; g.claims = ZERO; g.reclaims = ZERO;
    g.droppedWei = ZERO; g.claimedWei = ZERO; g.reclaimedWei = ZERO;
    g.activeCount = ZERO; g.activeWei = ZERO;
    g.droppers = ZERO; g.hunters = ZERO;
    g.updatedAt = ZERO;
  }
  return g;
}

function dailyStats(timestamp: BigInt): DailyStats {
  const day = timestamp.toI32() / SECONDS_PER_DAY;
  const id = day.toString();
  let d = DailyStats.load(id);
  if (d == null) {
    d = new DailyStats(id);
    d.day = day;
    d.date = BigInt.fromI32(day * SECONDS_PER_DAY);
    d.drops = ZERO; d.claims = ZERO; d.reclaims = ZERO;
    d.droppedWei = ZERO; d.claimedWei = ZERO; d.reclaimedWei = ZERO;
  }
  return d;
}

function account(address: Address, timestamp: BigInt): Account {
  const id = address.toHexString();
  let a = Account.load(id);
  if (a == null) {
    a = new Account(id);
    a.dropsCreated = ZERO; a.droppedWei = ZERO;
    a.claims = ZERO; a.claimedWei = ZERO; a.biggestClaimWei = ZERO;
    a.firstActivityAt = timestamp;
  }
  if (timestamp.lt(a.firstActivityAt)) a.firstActivityAt = timestamp;
  a.lastActivityAt = timestamp;
  return a;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

export function handleDropCreated(event: DropCreated): void {
  let drop = new Drop(event.params.dropId.toString());

  drop.dropId    = event.params.dropId;
  drop.dropper   = event.params.dropper;
  drop.amount    = event.params.amount;
  drop.claimer   = Address.zero();
  drop.expiry    = event.params.expiry;
  drop.claimedAt = BigInt.fromI32(0);
  drop.status    = 0; // Active
  drop.lat       = event.params.lat;
  drop.lng       = event.params.lng;
  drop.hint      = event.params.hint;

  drop.createdAt = event.block.timestamp;
  drop.createdTx = event.transaction.hash;

  drop.save();

  const ts = event.block.timestamp;
  const amount = event.params.amount;

  const a = account(event.params.dropper, ts);
  const g = globalStats();
  if (a.dropsCreated.equals(ZERO)) g.droppers = g.droppers.plus(ONE);
  a.dropsCreated = a.dropsCreated.plus(ONE);
  a.droppedWei = a.droppedWei.plus(amount);
  a.save();

  g.drops = g.drops.plus(ONE);
  g.droppedWei = g.droppedWei.plus(amount);
  g.activeCount = g.activeCount.plus(ONE);
  g.activeWei = g.activeWei.plus(amount);
  g.updatedAt = ts;
  g.save();

  const d = dailyStats(ts);
  d.drops = d.drops.plus(ONE);
  d.droppedWei = d.droppedWei.plus(amount);
  d.save();
}

export function handleDropClaimed(event: DropClaimed): void {
  let drop = Drop.load(event.params.dropId.toString());
  if (drop == null) return;
  // Count a drop's settlement once, even if an event were ever replayed.
  const wasActive = drop.status == 0;

  drop.claimer   = event.params.claimer;
  drop.claimedAt = event.params.claimedAt;
  drop.status    = 1; // Claimed

  drop.save();
  if (!wasActive) return;

  const ts = event.block.timestamp;
  const amount = drop.amount;

  const a = account(event.params.claimer, ts);
  const g = globalStats();
  if (a.claims.equals(ZERO)) g.hunters = g.hunters.plus(ONE);
  a.claims = a.claims.plus(ONE);
  a.claimedWei = a.claimedWei.plus(amount);
  if (amount.gt(a.biggestClaimWei)) a.biggestClaimWei = amount;
  a.save();

  g.claims = g.claims.plus(ONE);
  g.claimedWei = g.claimedWei.plus(amount);
  g.activeCount = g.activeCount.minus(ONE);
  g.activeWei = g.activeWei.minus(amount);
  g.updatedAt = ts;
  g.save();

  const d = dailyStats(ts);
  d.claims = d.claims.plus(ONE);
  d.claimedWei = d.claimedWei.plus(amount);
  d.save();
}

export function handleDropReclaimed(event: DropReclaimed): void {
  let drop = Drop.load(event.params.dropId.toString());
  if (drop == null) return;
  const wasActive = drop.status == 0;

  drop.status = 2; // Reclaimed

  drop.save();
  if (!wasActive) return;

  const ts = event.block.timestamp;
  const amount = drop.amount;

  const g = globalStats();
  g.reclaims = g.reclaims.plus(ONE);
  g.reclaimedWei = g.reclaimedWei.plus(amount);
  g.activeCount = g.activeCount.minus(ONE);
  g.activeWei = g.activeWei.minus(amount);
  g.updatedAt = ts;
  g.save();

  const d = dailyStats(ts);
  d.reclaims = d.reclaims.plus(ONE);
  d.reclaimedWei = d.reclaimedWei.plus(amount);
  d.save();
}

export function handleDropExtended(event: DropExtended): void {
  let drop = Drop.load(event.params.dropId.toString());
  if (drop == null) return;

  // Reactivation: push the expiry forward. Status stays Active (0) — the drop
  // was never claimed or reclaimed, it just had a new deadline set.
  drop.expiry = event.params.newExpiry;

  drop.save();
}
