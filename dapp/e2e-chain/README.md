# Money-path tests (forked Celo mainnet)

`npm run e2e:chain` starts a local `anvil` fork of Celo mainnet, runs
`money.test.ts` against the **deployed** GoodDrops contract using the app's own
ABI (`src/lib/contracts.ts`) and proof signer (`src/lib/claimProof.ts`), then
stops the fork.

Safe by construction:
- Nothing is broadcast to the real chain; the fork lives in memory.
- The fork's `gpsSigner` is replaced with a key generated for the run, so no
  proof produced here is valid on mainnet.
- The dropper is a freshly generated wallet funded on the fork. The hunter is a
  recent, currently face-verified claimer *impersonated on the fork* (anvil
  needs no key for that).

Needs Foundry (`anvil`, default `~/.foundry/bin/anvil`, override with
`ANVIL_BIN`) and `NEXT_PUBLIC_SUBGRAPH_URL` (read from `.env.local`).
Optional: `FORK_PORT` (default 8547), `FORK_UPSTREAM` (default forno).
