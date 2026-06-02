import { BigInt, Address } from "@graphprotocol/graph-ts";
import {
  DropCreated,
  DropClaimed,
  DropReclaimed,
} from "../generated/GoodDrops/GoodDrops";
import { Drop } from "../generated/schema";

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
}

export function handleDropClaimed(event: DropClaimed): void {
  let drop = Drop.load(event.params.dropId.toString());
  if (drop == null) return;

  drop.claimer   = event.params.claimer;
  drop.claimedAt = event.params.claimedAt;
  drop.status    = 1; // Claimed

  drop.save();
}

export function handleDropReclaimed(event: DropReclaimed): void {
  let drop = Drop.load(event.params.dropId.toString());
  if (drop == null) return;

  drop.status = 2; // Reclaimed

  drop.save();
}
