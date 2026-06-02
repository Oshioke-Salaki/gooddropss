# GoodDrops

**The world's first real-money GPS treasure hunt.**

Hide G$ at any location on earth. Anyone with a smartphone can find it.
No casino. No house edge. No bots. Just real people, real places, real money.

[gooddrops.xyz](https://gooddrops.xyz) · Celo Mainnet · `0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131`

---

## The problem nobody talks about with UBI

GoodDollar has distributed over **$20 million** in Universal Basic Income to more than **500,000 verified humans** across 181 countries — predominantly in Africa, Latin America, and Southeast Asia. The infrastructure works. The wallets are funded.

But UBI money sits still.

Recipients claim their daily G$ and hold it. There is no reason to spend it locally, no product built around its circulation, no game that makes it move. The economic velocity — the thing that actually creates community wealth — is missing.

**Dead money is not basic income. It's a database entry.**

---

## The solution

GoodDrops is a location-based treasure hunt where people hide real G$ at GPS coordinates and others physically go there to claim it.

Think Pokémon GO, but instead of catching imaginary creatures, you win actual money. No virtual currency. No loot boxes. No conversion rates. The number you see on screen is the number that hits your wallet.

The rules are simple:
- Anyone with G$ can hide a drop anywhere in the world
- Any GoodDollar-verified human can hunt it
- First person to physically arrive within 100 metres claims it
- The contract enforces everything — no trust required

That's it. That's the whole game.

---

## Why this is a big deal

### 1. It gives UBI a velocity layer

When a dropper hides money in their neighbourhood and a hunter walks three blocks to claim it, that G$ has moved. It has created economic activity, physical movement, and a social interaction — all things that sitting in a wallet does not do.

Every drop is a micro-stimulus injected into a specific real-world location. Multiply by 500,000 users and you have a system that makes UBI behave like a local currency rather than a savings account.

### 2. It is the first crypto product that requires you to show up

Virtually every Web3 product can be gamed from a laptop. Bots, farms, airdrop hunters — they never leave their chairs. GoodDrops cannot be farmed remotely. The Haversine distance check is client-side, but the GoodDollar identity verification is on-chain. You need a verified human identity and a body at the right place at the right time.

This is the rarest thing in Web3: **a Sybil-resistant, bot-proof, physical interaction.**

### 3. It is already deployed on mainnet with real money in it

The smart contract is live on Celo. Drops are being created. The subgraph is indexing every event. There is nothing simulated here.

---

## How it works

### For droppers

1. Open [gooddrops.xyz](https://gooddrops.xyz) on any mobile browser — no app store needed
2. Connect a GoodDollar wallet
3. Tap **Drop G$**, pick a location on the map, set an amount (1–500 G$) and a clue
4. Approve the G$ transfer and confirm — the drop is now live on-chain
5. Optionally: generate a printable QR sticker and stick it anywhere in the physical world. Scanners arrive at a claim page directly

### For hunters

1. Open the map — live drops appear as pins clustered by amount and rarity
2. Walk toward a pin. A real-time proximity ring shows exactly when you are within 100m
3. Hit **Claim**. The transaction fires. The G$ arrives.
4. The contract enforces single-claim atomically — no race condition, no double-spend

### The private drop

Create a drop and toggle **Private**. It disappears from the public map. You get a shareable link: `gooddrops.xyz/drop/42`. Send it to one person, a group, or attach a QR code to a physical object. Only people with the link can even see the drop exists. This is P2P wealth transfer as a treasure hunt — a birthday gift, a team reward, a micro-grant — all delivered as a physical experience.

---

## The numbers behind the opportunity

| Signal | Figure |
|---|---|
| GoodDollar verified users | 500,000+ |
| Countries represented | 181 |
| Location-based gaming revenue (2023) | $1.2 billion (Pokémon GO alone) |
| Global unbanked population | 1.4 billion |
| Crypto gaming market (projected 2027) | $65.7 billion |
| Celo transactions per day | ~200,000 |
| G$ daily UBI distribution | ~50,000 G$ |

GoodDrops has a **captive day-one user base of 500,000 people** who already hold G$, already have wallets, and already understand the token. There is no cold-start problem. The distribution channel exists. The product just needed to be built.

---

## Business model

### Phase 1 — Sponsored Drops (now buildable)

Businesses pay to place branded drops near their location. A café in Lagos drops 200 G$ near their entrance. A market in Nairobi drops 500 G$ on Friday afternoon. The protocol takes a 5% fee. Marketing spend becomes game content. Footfall becomes measurable. This is the first Web3 advertising product that requires physical presence to convert.

**Unit economics:** A business paying $10 in protocol fees generates ~200 G$ in drops. At current exchange rates that is ~$0.40 in real G$. The game subsidy is real but the attention and foot traffic delivered is worth multiples of the marketing cost.

### Phase 2 — Protocol fee on all drops

A small protocol fee (1–2%) on every drop funds the treasury. At 1,000 drops/day averaging 20 G$ each, that is 200–400 G$/day in protocol revenue — compounding as the user base grows.

### Phase 3 — Institutional drops

NGOs, governments, and impact organizations want to distribute aid to specific communities. GoodDrops gives them a mechanism to drop funds at specific GPS coordinates — food banks, health clinics, disaster zones — and have them claimed by verified humans in that location. This is programmable, auditable, GPS-targeted aid distribution.

---

## The moat

**Physical presence requirement** — You cannot automate showing up. Every drop claim is a real human making a real journey.

**GoodDollar identity layer** — The on-chain identity check (via `IIdentityV2.isWhitelisted`) means every claimer is a verified unique human. No Sybil attacks, no bot farms.

**Network effects** — More hunters make dropping more satisfying (your money will be found). More droppers make hunting more rewarding (more to find). Both sides grow together.

**First mover in physical crypto drops** — This category does not exist yet. GoodDrops is defining it.

**Celo infrastructure** — Celo is mobile-first, EVM-compatible, carbon-neutral, and has sub-cent transaction fees. A claim costs less than $0.001. This is the only chain where this product makes economic sense at scale.

---

## What is built today

| Feature | Status |
|---|---|
| Smart contract (UUPS upgradeable, auditable) | ✅ Live on Celo mainnet |
| Mobile PWA (no app store required) | ✅ Live at gooddrops.xyz |
| Real-time map with clustering | ✅ |
| GPS proximity claiming | ✅ |
| GoodDollar identity verification | ✅ On-chain |
| Physical QR drop stickers | ✅ |
| Private / invitation drops | ✅ |
| Drop rarity system (Common → Legendary) | ✅ |
| Flash drops (1h window, high stakes) | ✅ |
| Live activity ticker | ✅ |
| Push notifications (drop appeared near you) | ✅ |
| Hunter leaderboard | ✅ |
| My Drops dashboard with QR share | ✅ |
| Subgraph indexing (Goldsky) | ✅ |
| Reclaim expired drops | ✅ |

---

## Roadmap

### Q3 2026 — Sponsored Drops
Business-facing dashboard to create geo-targeted sponsored drops. Protocol fee collection. Analytics per drop (claim time, distance travelled, claimer demographics).

### Q3 2026 — Drop Chains
A sequence of 3–5 connected drops where claiming #1 reveals the coordinates of #2. A clue, a story, a journey. The final drop pays the full reward. GoodDrops becomes a storytelling platform for physical-world treasure hunts.

### Q4 2026 — City Leaderboards & Territory
Top hunter/dropper in a neighbourhood earns a territorial badge. City-vs-city rankings. Local pride. Turns GoodDrops from a solo game into a community sport.

### Q4 2026 — Yield Accumulation
Unclaimed drops compound in value over time via a protocol fee pool. A drop placed Monday worth 10 G$ is worth 14 G$ by Friday. The longer a drop sits, the richer it gets. Creates economic tension and forces hunters to act.

### Q1 2027 — AR Mode
Point your camera at the world. Drops within 200m appear as floating coins in augmented reality. This is the feature that goes viral. This is the screenshot on the app store. This is the moment GoodDrops becomes a category.

### Q1 2027 — Institutional Drop API
REST API for NGOs and aid organizations to programmatically create drops at GPS coordinates. Bulk drop creation, claim verification, disbursement reporting. Turns GoodDrops into humanitarian infrastructure.

---

## Smart contract

```
Contract:  GoodDrops
Network:   Celo Mainnet
Address:   0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131
Token:     G$ (0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A)
Standard:  ERC-20 with UUPS upgradeability (OpenZeppelin 5.x)
Identity:  GoodDollar IIdentityV2 (0xC361A6E67822a0EDc17D899227dd9FC50BD62F42)
```

**Security properties:**
- ReentrancyGuard on all state-changing functions
- Checks-effects-interactions pattern throughout
- `totalLocked` accounting prevents owner from rescuing active drop funds
- `reclaimExpired` is NOT gated by `whenNotPaused` — users can always retrieve their funds even during a security pause
- GPS coordinates stored on-chain as `int32 × 1e6` — no floating point, no rounding errors
- UUPS upgrade path controlled by owner multisig

---

## Tech stack

| Layer | Technology |
|---|---|
| Blockchain | Celo (EVM, mobile-first, $0.001 tx fees) |
| Smart contract | Solidity 0.8.24 · OpenZeppelin 5.x · Hardhat |
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript |
| Wallet | Wagmi 2 · Viem 2 · RainbowKit |
| Maps | Leaflet · react-leaflet · Stadia Maps |
| Indexing | The Graph (Goldsky) |
| Push notifications | Web Push · Upstash Redis |
| Identity | GoodDollar Citizen SDK · Identity SDK |
| Animations | Framer Motion |
| Hosting | Vercel |

---

## Running locally

```bash
# Clone
git clone https://github.com/your-org/gooddrops
cd gooddrops/dapp

# Install
npm install

# Configure
cp .env.example .env.local
# Set NEXT_PUBLIC_WC_PROJECT_ID, NEXT_PUBLIC_SUBGRAPH_URL, VAPID keys

# Run
npm run dev
```

The app runs against Celo mainnet by default. To test locally without spending real G$, point `NEXT_PUBLIC_SUBGRAPH_URL` at a local Graph node and deploy the contract to Alfajores testnet.

**Smart contract:**
```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network celo
```

---

## The case for now

**Why location-based crypto hasn't worked before:**
Every previous attempt at location-based crypto (Foam, COIN app, Geo Web) failed because they solved problems nobody had. They were looking for use cases to justify the tech.

GoodDrops is different. The use case is obvious. The demand is pre-existing. The user base is already funded and verified. The technology (Celo, GoodDollar, GPS APIs) has matured to the point where this is a weekend project, not a research programme.

**Why GoodDollar makes this defensible:**
Without an identity layer, GoodDrops becomes a bot farm. One entity creates 1,000 wallets, watches the blockchain for new drops, scripts the claiming. The game dies in a week. GoodDollar's on-chain identity verification — the same system that ensures UBI reaches real humans — is the exact primitive needed to make GoodDrops work at scale.

This is the rarest thing in crypto product development: **a user problem, a user base, and a technical primitive that all found each other at the same time.**

---

## Contact

Built on GoodDollar. Powered by Celo.

If you are an investor, foundation, NGO, or developer who wants to talk about what comes next — the door is open.

[gooddrops.xyz](https://gooddrops.xyz)
