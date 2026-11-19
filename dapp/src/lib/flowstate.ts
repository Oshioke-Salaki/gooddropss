// Flow State voting for GoodDrops (GoodBuilders Season 5).
//
// People who sign in here with email can't log into their wallet on
// flowstate.network, so we let them support GoodDrops from inside the app with
// the same wallet and the same council contract Flow State's site uses:
//   1. Claim voting rights: the wallet signs Flow State's own claim message and
//      our server forwards it to Flow State's eligibility service, which adds
//      the wallet as a voter (one per GoodDollar-verified person).
//   2. Vote: the wallet calls vote() on the council, setting its points for
//      GoodDrops. Only GoodDrops' entry is sent, so points a person gave other
//      projects are never touched.
// Votes are points, not money: nothing moves out of the voter's wallet, and
// GoodDrops gives nothing in return for voting (Flow State's rules forbid it).

import { parseAbi } from "viem";

export const FLOW_CHAIN_ID = 42220;
/** GoodBuilders Season 5 Flow Council on Celo. */
export const FLOW_COUNCIL = "0x889e0aadaa3f8b28a794ef70da147827c620a590" as const;
/** GoodDrops' funding address in that council (where its votes and stream go). */
export const FLOW_RECIPIENT = "0xB2914810724FE2Fb871960eB200Dea427854b1C7" as const;
export const FLOW_COUNCIL_URL = `https://flowstate.network/flow-councils/${FLOW_CHAIN_ID}/${FLOW_COUNCIL}`;
/** Flow State's voter-registration service (called from our server only). */
export const FLOW_ELIGIBILITY_URL = "https://flowstate.network/api/flow-council/eligibility";

export const FLOW_COUNCIL_ABI = parseAbi([
  "function vote((address recipient, uint96 amount)[] _votes)",
  "function getVoter(address _account) view returns ((address account, uint96 votingPower, (uint160 recipientId, uint96 amount)[] votes))",
  "function getVotes(address _account) view returns ((address recipient, uint96 amount)[])",
  "function getRecipient(address _account) view returns ((address account, uint96 votes))",
  "function maxVotingSpread() view returns (uint8)",
  "error UNAUTHORIZED()",
  "error NOT_FOUND(address account)",
  "error NOT_ENOUGH_VOTING_POWER()",
  "error TOO_MUCH_VOTING_SPREAD()",
]);

/**
 * Flow State's claim message, byte for byte (platform
 * src/app/flow-councils/lib/claimMessage.ts). Any difference fails every
 * signature, so the address is lowercased and the time floored to the second.
 * `issuedAt` is milliseconds.
 */
export function buildClaimMessage(address: string, issuedAt: number): string {
  const issuedAtSecond = Math.floor(issuedAt / 1000) * 1000;
  const timestamp = new Date(issuedAtSecond).toISOString().replace(/\.\d+Z$/, "Z");
  return [
    "Claim voting rights in this Flow Council.",
    "",
    `Council: ${FLOW_COUNCIL.toLowerCase()}`,
    `Chain: ${FLOW_CHAIN_ID}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued at: ${timestamp}`,
  ].join("\n");
}

export interface Ballot {
  /** Registered as a voter in this council. */
  isVoter: boolean;
  votingPower: number;
  /** Points this wallet currently gives GoodDrops. */
  forUs: number;
  /** Points given to all projects together. */
  used: number;
  /** Points not given to anyone yet. */
  available: number;
  /** Other projects this wallet currently gives points to. */
  others: { recipient: `0x${string}`; amount: number }[];
}

/** Turn the contract's answers into what the screen needs. */
export function toBallot(
  voter: { account: string; votingPower: bigint },
  votes: readonly { recipient: string; amount: bigint }[],
): Ballot {
  const isVoter = voter.account !== "0x0000000000000000000000000000000000000000";
  const votingPower = Number(voter.votingPower);
  let used = 0, forUs = 0;
  const others: Ballot["others"] = [];
  for (const v of votes) {
    const n = Number(v.amount);
    if (n <= 0) continue;
    used += n;
    if (v.recipient.toLowerCase() === FLOW_RECIPIENT.toLowerCase()) forUs += n;
    else others.push({ recipient: v.recipient as `0x${string}`, amount: n });
  }
  return { isVoter, votingPower, forUs, used, available: Math.max(0, votingPower - used), others };
}

/**
 * Votes this wallet could still give GoodDrops. A wallet that isn't a voter
 * yet can always be asked (claiming gives it votes). Votes already given to
 * other projects are theirs to keep: we only ever add free ones.
 */
export const canGiveMore = (b: Ballot) => !b.isVoter || b.available > 0;

/** The ballot that gives GoodDrops every free vote, and touches nothing else. */
export function ballotFor(b: Ballot): { recipient: `0x${string}`; amount: bigint }[] {
  return [{ recipient: FLOW_RECIPIENT, amount: BigInt(b.forUs + b.available) }];
}
