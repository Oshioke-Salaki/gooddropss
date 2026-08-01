# GoodDrops → Proof of Presence: Brutal Assessment & Build Roadmap

*The plan for turning GoodDrops from a treasure hunt into a presence protocol —
badges, collections, and merchant-funded drops — without killing it by
over-building.*

---

## Part 1 — The brutal assessment

### The one insight that changes everything

**GoodDrops already produces something POAP never did: cryptographic proof that
ONE REAL HUMAN was PHYSICALLY at a PLACE at a TIME.**

Break that down against POAP:

| Property | POAP | GoodDrops today |
|---|---|---|
| Proof you attended | ❌ Mint links/codes get shared in Telegram and farmed from couches worldwide | ✅ GPS-verified claim, server-signed (`gpsSigner` → `claimWithProof`) |
| Proof you're a unique human | ❌ One person can mint to 50 wallets | ✅ GoodDollar face verification + identity-root scoping (one identity, all linked wallets collapse) |
| Time attestation | ✅ block time | ✅ block time |
| On-chain record | ✅ | ✅ (`DropClaimed` events, already indexed on Dune + Goldsky) |
| Economic weight | ❌ free mint | ✅ the claim moved real money — attendance had stakes |

POAP is a *souvenir*. A GoodDrops claim is *evidence*. That's a strictly stronger
primitive, and it's not a pivot — you already built it.

### Idea 1: "Be POAP or greater" — verdict: ✅ YES, but as a feature, not a war

**What's right:** the primitive is genuinely better (above). Events, DAOs,
loyalty programs, and airdrop-hunters all *want* Sybil-resistant proof of
attendance; POAP's farming problem is well known.

**Brutal truths:**
1. **POAP's moat is brand + network, not tech.** "Technically better POAP" is
   how engineers lose to marketers. Don't announce a protocol; ship badges
   inside GoodDrops, prove them at one real event, and let the protocol story
   emerge from evidence.
2. **Your proof has a hole, and it's disqualifying until fixed:** the geo/VPN
   anti-spoof check in `/api/claim-proof` is hard-disabled
   (`if (!isLocalIp && false)`). A teenager with a mock-location app can forge
   "presence" today. You cannot market *proof* of presence while presence is
   spoofable. **Fixing this is Phase 0, non-negotiable.**
3. **27 users.** A protocol with no users is a whitepaper. The badge system must
   first serve retention/status for YOUR hunters, and only later become an API
   for others.

### Idea 2: NFT collections tied to drops (the Devconnect set) — verdict: ✅ YES, this is the killer retention + event product

**What's right:** "collect 5 special drops → unlock the set → status" is a
quest system, a reason to walk further, and a sponsorship product in one. Events
are the perfect wedge: a sponsor pays for the drops, attendees hunt booths, the
set is the memento, GoodDrops gets hundreds of verified new users in one venue.

**Brutal truths:**
1. **Gas + wallet reality.** Your users are Magic email-wallets with zero CELO —
   the exact population that can't pay an NFT mint. Any design where the user
   pays gas is dead on arrival. → **Lazy mint, server-sponsored**: badges are
   *earned* off-chain instantly (free, from claims you already index) and
   *minted* on-chain optionally, gas paid by your relayer. Earn ≠ mint.
2. **Nobody buys NFTs anymore — and that's fine, because that's not the point.**
   The value here is *status and access*, not resale. Make badges
   **soulbound (non-transferable)** by default. That's better for status (can't
   be bought), better for Sybil-integrity (can't be sold to fake a history), and
   keeps you a million miles from "financial product" territory.
3. **Don't build a self-serve collection builder yet.** That's a whole SaaS.
   V1 = admin-curated sets (you define them in the admin console), one flagship
   event collection as the showcase. Sponsor self-serve comes after one success.
4. **You already have a proto-badge system** (achievements: Drop Maker, Whale,
   Pioneer…). Don't build a parallel one — *unify*: achievements become badges,
   badges can be minted.

### Idea 3: Merchant task-locked drops — verdict: ✅ YES, this is the revenue engine — with one flow fix

**What's right:** businesses fund drops around their shops, gated on real-world
tasks → GoodDrops becomes a **foot-traffic machine** merchants pay for. It
extends GoodSpots (merchants already exist in your model), and critically:
**merchants bring their own customers**, which means merchant drops are a user
acquisition channel, not just a monetization one. At 27 users, that ordering
matters enormously.

**Brutal truths:**
1. **Your QR flow is backwards.** "Customer clicks drop → shows a QR → merchant
   scans and approves" — right instinct, but the *direction* of the scan is the
   security. A static QR at the counter can be photographed and replayed from
   home. The correct flow (detailed in Part 3): the **customer's app renders a
   one-time, expiring QR** `{dropId, claimer, nonce}`; the **merchant scans it**
   in their dashboard and taps Approve; the server records a single-use approval
   bound to that customer's identity; then the normal GPS-verified claim
   proceeds. Merchant = physical gatekeeper, GPS = location gate, nonce = replay
   gate, identity root = Sybil gate. Four locks, all reusing patterns you have.
2. **Task verification: keep it 100% merchant-attested in v1.** No Instagram
   API, no receipt OCR. "Did they do the thing? Merchant taps yes." The merchant
   is spending their own G$ — they have every incentive to verify honestly. API
   verifications are a v2 rabbit hole.
3. **Merchant onboarding is the actual hard part** — not the code. Dashboard
   must be dead simple (a phone web page: fund, create reward, scan, approve).
   Pilot with 3–5 real businesses near your existing hunter density (Kaduna
   South / Colab corridor — you can see it on your own heatmap) before building
   anything self-serve.
4. **Framing/regulatory:** "do a task, earn G$ reward" = a loyalty program.
   Keep that framing everywhere (it's also the honest one). Soulbound badges +
   no cash-equivalence promises keeps this clean. Not legal advice; worth a real
   check before scaling merchant payments.

### The meta-verdict: these are one product, sequenced

```
  Fix the proof  →  Badges (status)  →  Merchant drops (money + users)  →  Event kit (all three at once)
  (Phase 0)         (Phase 1–2)         (Phase 3)                          (Phase 4)
```

- Presence proof is the **foundation** (both other ideas are worthless if
  presence is forgeable).
- Badges are the **retention layer** (why hunters keep coming back and what
  they show off).
- Merchant drops are the **economic layer** (who funds the G$ and brings the
  next users).
- An **event** (Devconnect-class) is where all three converge into one
  showcase: sponsor-funded drops + a collectible set + booth tasks.

**What NOT to build yet (kill list):** a standalone POAP-competitor protocol; a
sponsor self-serve collection builder; IG/social API task verification;
transferable/tradeable NFTs; a marketplace. All are Phase 5+ *if ever*.

---

## Part 2 — Phase 0: Make presence actually provable (1 week)

*Everything else stands on this. Ship first.*

### 0.1 Re-enable anti-spoof in `/api/claim-proof`
- Remove the `&& false` kill-switch; restore the IP-vs-GPS plausibility check.
- Add signals (all server-side, no new UX):
  - **IP geolocation sanity**: claimed GPS within N km of IP geo (generous — mobile
    IPs wander; start at 250km, tighten with data; VPN/datacenter ASN → reject).
  - **Velocity check** (you already have `gd:velocity:*` keys): reject if the
    same identity claims from points implying >150 km/h travel.
  - **Device-position confidence**: require fresh `Geolocation` fix (timestamp +
    accuracy fields already available client-side — pass them in the proof
    request; reject accuracy > 150m or stale > 60s fixes).
- Log-only mode for 3–5 days (shadow flag suspicious claims to Redis, review in
  admin Health/Reports) → then enforce. Zero false-positive tolerance strategy:
  when rejected, error says *why* ("VPN detected — turn it off to claim").

### 0.2 Gas top-up faucet (kills your #1 support issue AND unblocks NFT mints)
- `POST /api/gas-topup`: verified-human + identity-root rate-limited (e.g. 3
  top-ups / 30 days), sends ~0.05 CELO from a funded hot wallet when balance <
  threshold. Called automatically pre-claim/pre-drop when needed.
- Ops: fund a dedicated wallet (start: 50 CELO ≈ covers thousands of top-ups),
  alert in `/admin/health` when balance low. Env: `GAS_FAUCET_KEY`.

### 0.3 Presence record (the quiet foundation of everything)
Every successful claim already emits `DropClaimed`. Add a derived, queryable
**presence ledger** keyed by identity root:
- Redis: `gd:presence:{root}` → sorted set of `{dropId, lat*, lng*, ts, tag}`
  (*coarse coords, same 3-decimal privacy standard as the heatmap*).
- Written in `/api/claim-proof` on success (server-side, atomic with proof).
- This is what badges, sets, and the future API all read. One source of truth.

---

## Part 3 — The three products

### Phase 1: Presence Badges (off-chain first) — 1–2 weeks

**What ships:** every claim can earn badges; badges display on the hunter
profile and share cards; admin defines badge rules; zero gas, zero contracts.

**Data model (Redis):**
```
gd:badge:def:{badgeId}        → {name, emoji/art, description, rule, setId?, createdAt}
gd:badges:{root}              → Set of earned badgeIds (identity-scoped!)
gd:badge:earned:{badgeId}     → Set of roots (for "only 43 people have this")
gd:set:def:{setId}            → {name, art, badgeIds[], reward?, sponsor?}
gd:sets:index                 → Set of setIds
```

**Rule types (v1 — computed server-side on claim):**
- `first_claim` · `claims_count ≥ N` · `claimed_drop_in {dropIds}` (event sets)
- `claimed_near {lat,lng,radius}` (venue badges — reuses haversine)
- `campaign {campaignId}` (sponsor campaign badges — hint tag already exists)
- `streak ≥ N` (reuse streak system)
- Migrate existing achievements (Drop Maker, Whale, Pioneer…) into badge defs —
  one system, not two.

**Where it hooks in:** `/api/claim-proof` success path → evaluate rules → award →
push notification "🏅 Badge unlocked: Devconnect Explorer (1/5)". Set completion
→ bigger celebration + share card.

**Surfaces:** hunter profile badge wall (rarity shown: "held by 12 humans"),
set progress UI ("3/5 — 2 more booths to go" with a map link to remaining
drops), share card with badge art + referral link (share-to-earn already wired).

**Admin:** new **Badges** tab in the admin sidebar: create badge, create set,
attach dropIds/campaign, see holder counts.

### Phase 2: On-chain collection (soulbound, sponsored mint) — 1–2 weeks

**Contract:** `GoodDropsBadges.sol` — ERC-721, UUPS (same stack as GoodDrops):
- `mint(address to, uint256 badgeTypeId, bytes serverSig)` — only with signature
  from `badgeSigner` (same pattern as `gpsSigner`; server signs after checking
  the Redis ledger). One per badgeType per identity root (server enforces root
  uniqueness; contract enforces per-address).
- **Soulbound**: transfers revert (allow burn). Metadata: `tokenURI` →
  IPFS/`https://gooddrops.xyz/api/badges/meta/{typeId}` (start with API-hosted
  JSON — pragmatic; pin to IPFS when a set matters).
- Deploy on Celo; gas for mint paid by a relayer route (`/api/badges/mint`
  submits the tx server-side — user signs nothing, pays nothing) OR user-sent
  with faucet top-up. Relayer is cleaner: badge = gift.

**UX:** badge wall shows "Mint on-chain — free" on earned badges. Minted badges
get the ⛓️ mark + Celoscan link. Nothing forces minting; the off-chain badge is
already the status object in-app.

**Flagship:** ONE curated event collection to launch it (see Phase 4).

### Phase 3: Merchant task-locked drops — 2–3 weeks

**The flow (hardened version of yours):**
```
1. Merchant (a GoodSpot with a wallet) creates a REWARD DROP:
   amount, radius pin at their shop, task text ("Buy any coffee"), quantity,
   expiry. Funds it exactly like a normal drop (escrowed in GoodDrops).
   Stored marker: hint tag [T:merchantId] + Redis task record.
2. Hunter sees a distinct "task drop" pin 🎁: card shows the task + merchant
   name + "Do the task, then get approved in-store."
3. Hunter does the task IRL, taps "I did it" → app checks GPS in-range first,
   then renders a ONE-TIME QR: {dropId, claimerAddr, nonce, exp: 120s}
   (nonce minted by server: gd:taskqr:{nonce} → {dropId, root, exp}, single-use).
4. Merchant opens /merchant (phone web dashboard) → Scan → camera reads QR →
   sees "Approve reward: 50 G$ → @username for 'Buy any coffee'?" → Approve.
   Server verifies merchant owns the drop + nonce valid+unused → writes
   gd:taskapproval:{dropId}:{root} (TTL 10 min) → burns nonce.
5. Hunter's app (polling/push) lights up "Approved — claim now!" → normal
   claimWithProof path; /api/claim-proof additionally requires the approval
   record for [T:] drops. G$ lands. Approval consumed.
```
**Why this shape:** merchant-scans-customer (not the reverse) means the QR is
dynamic and useless if photographed; single-use nonce kills replay; GPS still
required so approvals can't be sold remotely; identity root caps each human to
one reward per drop; merchant never touches keys or gas at approval time (a
session-authed dashboard action, wallet-signed once at merchant registration).

**Merchant dashboard (`/merchant` upgrade, mobile-first):** register/link
GoodSpot → fund & create reward drops (reuse CreateDropSheet guts + task field)
→ Scan & approve (webcam/`getUserMedia` QR reader) → history + simple stats
(rewards given, unique customers, repeat rate). Later: CSV export.

**Anti-abuse:** per-root one reward per drop; per-merchant daily approval cap;
approvals logged for the Reports/moderation surface; merchant flagged if
approval velocity is inhuman.

**Pilot:** 3–5 businesses in the Kaduna South corridor where hunter density
already exists. Concierge-onboard them personally. Success = a merchant funds a
SECOND campaign with their own money.

### Phase 4: The Event Kit (Devconnect-class showcase) — 1 week of glue

Bundle what now exists into a repeatable product:
- **Venue set:** N special drops at booths/landmarks (`createManyDrops` — one tx),
  each mapped to a badge; completing the set = event NFT + bonus drop.
- **Sponsor page:** campaign branding (campaigns system already does this).
- **Booth tasks:** optional merchant-locks on specific drops ("visit the
  GoodDollar booth and say hi" → staffer scans & approves).
- **Live event dashboard:** the Dune dashboard filtered to venue coords + a
  real-time claims ticker on a big screen (ActivityTicker, fullscreen mode).
- **Onboard flow at the door:** QR → gooddrops.xyz?ref=EVENT → Magic email
  signup → face verify → first drop is 10 steps away. Gas faucet makes it
  seamless.

This is the demo that makes the "greater than POAP" story *visible*: verified
humans, physically present, provably, with money moving — on a public dashboard.

### Phase 5 (LATER, gated on traction): the Presence API
Only after events + merchants prove demand: `GET /api/presence/verify?root=&near=&when=` +
embeddable widget ("✓ Verified present at Devconnect 2026") + docs. That's the
protocol play — earned, not announced.

---

## Part 4 — Everything you need (the checklist)

**Contracts**
- [ ] `GoodDropsBadges.sol` (ERC-721 soulbound, UUPS, `badgeSigner` mint auth) + tests + Alfajores dry-run + Celoscan verify
- [ ] (No GoodDrops.sol changes needed for merchant locks — enforcement lives in the claim-proof gate, like riddles)

**Backend**
- [ ] Re-enabled anti-spoof (IP-geo, ASN/VPN list, velocity, fix-freshness) with shadow mode
- [ ] `/api/gas-topup` + faucet wallet + health check
- [ ] Presence ledger writes in claim-proof
- [ ] Badge engine: defs CRUD (admin), rule evaluation on claim, `gd:badge*`/`gd:set*` keys
- [ ] `/api/badges/*`: list/earned/meta/mint (relayer)
- [ ] Merchant: task-drop records, QR nonce mint/burn, approve endpoint, approval gate in claim-proof
- [ ] Push notifications: badge earned, set progress, approval granted

**Frontend**
- [ ] Badge wall on hunter profile + rarity counts + mint button + Celoscan link
- [ ] Set progress UI + map link to remaining drops + completion celebration
- [ ] Task-drop pin style + task card + one-time QR screen
- [ ] `/merchant` dashboard: register, create reward, scan (getUserMedia), approve, history
- [ ] Admin: Badges tab (create badge/set, holders), merchant oversight in Reports
- [ ] Share cards with badge art (referral link already baked in)

**Ops / non-code**
- [ ] Fund gas faucet + badge relayer wallets; low-balance alerts in /admin/health
- [ ] Badge art (even simple emoji-style at first; hire for the flagship set)
- [ ] IPFS pinning (flagship set only, later)
- [ ] Merchant pilot: pick 3–5, print table-tents ("Earn G$ here 💰"), onboard in person
- [ ] Event partner outreach (Celo/GoodDollar community events first — warm intros)
- [ ] Loyalty-program legal sanity check before scaling merchant payments

**Metrics that decide success (check on Dune + admin analytics)**
- Phase 0: spoof-rejection rate <2% false positives; gas-failure support pings → 0
- Phase 1–2: D7 retention of badge-earners vs non (target: 2×); % claims that earn a badge (>40%); mint rate (curiosity signal)
- Phase 3: merchant repeat-funding rate (the ONLY number that matters); new users whose first touch is a merchant drop
- Phase 4: event signups → verified → first claim conversion (>50% of scanned QRs)

---

## Part 5 — Sequencing summary

| Phase | What | Time | Depends on |
|---|---|---|---|
| 0 | Anti-spoof + gas faucet + presence ledger | ~1 wk | — |
| 1 | Off-chain badges + sets + admin + profile wall | 1–2 wk | 0 |
| 2 | Soulbound badge contract + sponsored mint | 1–2 wk | 1 |
| 3 | Merchant task drops + QR approve + dashboard | 2–3 wk | 0 (parallel w/ 2) |
| 4 | Event kit (flagship collection + playbook) | ~1 wk glue | 1–3 |
| 5 | Presence API (protocol play) | later | traction |

Total to "complete banger": **6–9 focused weeks**, every phase shipping user
value on its own — no big-bang.
