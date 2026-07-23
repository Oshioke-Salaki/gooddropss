# GoodDrops — New Features

A running log of the features shipped in this cycle and, more importantly, *why*
each one matters. GoodDrops is a GPS treasure hunt where people hide and find
real G$ (GoodDollar UBI). Everything below is in service of one goal: make it
effortless, fair, and trustworthy for real humans to drop and hunt money in the
physical world.

---

## 1. Map Landmarks — an admin-curated "skeleton" for the map

**What it is.** Admins can name real places directly on the map (campuses,
markets, junctions, estates, places of worship, parks, transport hubs…). You
move the map so the centre crosshair (📍) sits on the spot, tap **Place here**,
give it a name and category, and sign — no gas, no transaction. The label then
appears for everyone, zoom-gated so the map never turns into clutter.

**Why it matters.** The base map tiles leave huge areas blank in exactly the
neighbourhoods GoodDrops is growing in (e.g. Barnawa, Narayi, NAFDAC Road in
Kaduna). A drop hint like "behind the blue kiosk near the junction" is useless if
the hunter can't find the junction. Landmarks give the map a shared vocabulary of
real, local orientation anchors — so hints make sense and hunts actually succeed.
A hunt that ends in "I couldn't find it" is a lost user; landmarks are how we
prevent that.

**Design decisions that protect UX:**
- **Center-crosshair placement, not tap-to-drop.** On a tilted/3D map a tiny
  finger drag registers as a pan, not a click, so "tap the exact pixel" fails
  constantly. Lining a fixed crosshair up with the spot is precise and works
  every time.
- **Zoom-gated + viewport-culled rendering.** Labels only appear once you're
  zoomed in enough to need them, and only for what's on screen — the map stays
  fast and readable.
- **Signature, not gas.** Naming a place costs nothing and takes a second. The
  signature still proves who did it, server-side.
- **Tap-to-edit, right on the map.** For admins, place labels are tappable (a
  subtle ✎ marks them as editable) — tap one to rename it, re-categorise it,
  add/adjust a note, hide it, or delete it, all from a single inline sheet
  without leaving the map. Fixing a typo is now a two-second job at the exact
  spot you see it, instead of hunting for the record in a separate admin list.
  For hunters the labels stay non-interactive so they can never swallow a tap
  meant for a nearby drop. Admins can also **📍 Preview on map** any place (or
  pending suggestion) straight from the Places/Suggestions lists — it opens the
  map, flies to the spot, and drops a brief highlight, so you can eyeball a
  location before approving or editing it.

---

## 2. Crowdsourced Suggestions — the community helps build the map

**What it is.** Any **verified** hunter (not just admins) can now suggest a
place. Same crosshair flow, but instead of going live instantly it enters an
**admin review queue** as a *pending* suggestion. Admins approve it onto the map
or reject it. Pending suggestions never appear on the public map until approved.

**Why it matters.** Two admins can't map a whole city. The people who live in a
neighbourhood know it better than anyone — where the real landmarks are, what
locals actually call them. Crowdsourcing turns every hunter into a contributor,
so the map gets richer the more the community uses it. That's a compounding
advantage: better map → better hunts → more users → more suggestions.

**How we keep it clean (no spam, no abuse):**
- **Verified humans only.** Suggestions require a GoodDollar face-verified
  identity. This piggybacks on GoodDollar's Sybil resistance — one real person,
  not a thousand bots.
- **The server decides status, never the client.** A suggester's request is
  *always* stored as pending; only an admin's signature can create or approve a
  live landmark. You can't "suggest" something straight onto the map.
- **Per-person flood cap.** Each human can have only a bounded number of
  suggestions awaiting review at once, so no one can bury the queue.
- **No hijacking existing places.** Because the record id is generated on the
  client, we explicitly block a non-admin from overwriting a live landmark (or
  someone else's suggestion) by guessing its id — a suggester can only create a
  new place or re-edit their own pending one.
- **Quota frees on decision.** Approving or rejecting a suggestion releases the
  suggester's queue slot automatically.

---

## 2b. Landmarks in the Clue — hints hunters can actually follow

**What it is.** When you drop G$ and pick the spot, the drop form now shows the
**landmarks nearest that exact point** as one-tap chips. Tap "🎓 Colab Campus"
and it folds a clean "Near Colab Campus — …" into your clue. It works in the
single-drop flow and per-stop in the Hunt Chain builder, only offers places
within ~500 m, won't add the same place twice, and never overruns the on-chain
hint length.

**Why it matters.** GPS alone only gets a hunter within ~60 m — the clue does the
last leg. But a clue is only useful if it names something the hunter recognises,
and off-the-shelf map tiles are blank in the neighbourhoods GoodDrops is growing
in. This closes the loop on the Landmarks feature: the places admins and the
community add to the map become the shared vocabulary that drop hints are written
in. Better clue → the drop actually gets found → the dropper's money reaches a
real person. It also nudges every dropper toward good hints without making them
think.

---

## 2c. Drop Reporting & Moderation — keeping the map trustworthy

**What it is.** Every drop's sheet now has a discreet **"⚐ Report this drop"**
action. A verified hunter can flag it as *not there / can't find it*, *scam or
misleading*, *offensive*, *spam*, or *other*, with an optional note. Reports feed
a new **Reports** tab in the admin dashboard (with its own live count badge),
where an admin can:

- **Hide the drop from the map** — it vanishes for everyone, app-wide, instantly.
- **Un-hide** it if the report was wrong.
- **Dismiss** the report if the drop is fine.

**Why it matters.** A drop is on-chain and permissionless — anyone can create one,
and it can't be deleted from the blockchain. Without a moderation lever, one
scam or offensive drop is visible to every user with no recourse, and in a *money*
app that poisons trust fast. Hiding is the right tool: the app controls what its
map shows, so an admin can pull a bad drop out of everyone's view in one tap even
though the chain keeps its immutable record. Gating reports to **verified humans**
(the same GoodDollar Sybil resistance used elsewhere) stops the report queue from
being weaponised by bots. Admin actions are protected by the existing admin
session — no extra friction, no wallet popups.

---

## 2d. "Drop Near You" Alerts — bring hunters back in the moment

**What it is.** Hunters who turn on notifications can now be **pinged the moment a
drop appears near them**. With permission, the app shares a *coarse* location
(rounded to ~110 m — never a precise fix) only while notifications are on. When a
new public drop is created within ~2 km, nearby opted-in hunters get a "💰 New
drop near you!" push. It's throttled hard (at most one nearby ping every 20
minutes per person), capped in fan-out, skips the dropper themselves, and never
broadcasts private drops.

**Why it matters.** Treasure hunting is about *right place, right time*. Before
this, a drop could sit unclaimed a block away from someone who would have loved
it, because they had no idea it existed. Proximity alerts turn latent drops into
found ones — more claims, more "whoa, there's free money near me" moments, more
reasons to keep the app installed. The privacy design (coarse location, tied to
notification consent, easy to switch off) makes it something users are
comfortable saying yes to.

*Requires the drop-created webhook to carry the drop's coordinates; it no-ops
safely if they're ever absent.*

---

## 2e. Re-verify Reminders — don't let verified humans fall off the cliff

**What it is.** GoodDollar verification runs on a repeating ladder — a fresh
verifier is only whitelisted for **3 days** before they must re-authenticate, and
even the long rung eventually lapses. A scheduled job now scans push subscribers a
rotating batch at a time and sends a **re-verify nudge** to anyone whose
verification just lapsed, or is about to (last day of the 3-day rung, last few
days of the long one). Each person is reminded at most once every few days, so
it's a nudge, never nagging.

**Why it matters.** A verified human is GoodDrops' most valuable user — they can
claim, drop, suggest places, and report. When their window quietly elapses,
`getWhitelistedRoot` goes to zero and the app treats them as if they never
verified — they hit a wall mid-hunt with no warning. Catching them *before* the
cliff (or immediately after) with a one-tap path back keeps hard-won verified
users active instead of silently churning. It reuses the exact ladder logic the
app already uses on-screen, so the timing is always right.

*Runs on a scheduler (Vercel Cron, daily on Hobby) and needs a `CRON_SECRET`; the
endpoint fails closed if it isn't configured.*

---

## 3. Robust Admin Dashboard — a real console with a sidebar

**What it is.** The admin area is now a proper dashboard with a persistent
navigation sidebar (a horizontal tab strip on mobile):

- **Overview** — seed drops, set the max drop limit.
- **Suggestions** — review the crowdsourced landmark queue, with a live count
  badge so you can see at a glance how many places are waiting.
- **Reports** — triage hunter-flagged drops (hide / un-hide / dismiss), also with
  a live count badge.
- **Places** — manage every live landmark (search, edit, hide/show, delete, and
  **📍 Preview on map** to jump straight to a place).
- **Analytics** — usage and activity.
- **Health** — an at-a-glance status board (see §11) of every integration —
  Redis, subgraph, push, the webhook/cron secrets — plus live counts.

**Why it matters.** As GoodDrops grows, admin work grows with it. A single
scrolling page doesn't scale. The sidebar makes the moderation surface obvious
and one tap away, and the **badge on Suggestions** means new community
contributions never get silently ignored — the thing the whole crowdsourcing
loop depends on. Reviewing is fast: approve, tidy-up-then-approve, or reject, all
with a "verify on map" link so an admin can sanity-check the real location before
it goes live. It's fully mobile responsive because admins are often out in the
field, on a phone, not at a desk.

---

## 4. Identity-Scoped Profiles & Anti-Cheat Leaderboard

**What it is.** Usernames, stats, streaks, and leaderboard standing are keyed to a
person's **GoodDollar identity root**, not to a single wallet address. All of a
verified human's linked wallets share one identity.

**Why it matters.** Two payoffs at once:
1. **Continuity.** A user who migrated from an old (Focus-Pet) wallet to a new
   GoodDrops wallet keeps their identity — the leaderboard shows their current
   GoodDrops address/username, not a stale wallet they've moved on from.
2. **Fairness.** Someone hunting across several linked wallets appears **once**,
   not many times. That closes an obvious leaderboard-farming loophole and keeps
   the rankings meaningful — which is the entire point of having a leaderboard.

It works automatically. Existing and already-migrated users are covered without
doing anything.

---

## 5. Safer, Clearer Dropping

**What it is.** A cluster of guardrails and UX fixes around creating drops:

- **Min/max amount validation** on single, chain, and batch drop creators, read
  live from the contract — you can't accidentally attempt an invalid drop.
- **Max single drop raised to 10,000 G$**, with an owner-only control in the
  admin Overview to change the on-chain limit; the drop form reflects it
  automatically.
- **Expiry clamping** so a drop can't be rejected for an out-of-range expiry.
- **No more silent "nothing happens."** A prior bug left the form stuck after a
  riddle drop; creating drops now always responds.

**Why it matters.** The moment a drop fails or the button does nothing, the
dropper assumes the app is broken and stops. These are the failures that quietly
kill trust in a money app. Catching bad input *before* the transaction, with a
clear message, turns a dead-end into a one-line fix the user can act on.

---

## 6. Better Claiming UX

**What it is.** When a drop has already been claimed by someone else (or is
otherwise gone), the claim sheet no longer offers a pointless "Try again" button.
It clearly says the drop is gone and gives a single **← Back to the map** action.
Loading states gate the buttons so nobody double-taps into an error.

**Why it matters.** Treasure hunts are competitive — you *will* sometimes arrive
second. "Try again" on something that can never succeed is a frustrating lie. An
honest, calm dead-end that points you back to the next hunt respects the user and
keeps them playing.

---

## 7. Migration Reliability (Focus-Pet → GoodDrops)

**What it is.** The companion migrate app moves ~700 face-verified users onto
GoodDrops wallets. Two blocking bugs were fixed:

- **Correct network.** The migration now runs on the right (mainnet) Web3Auth
  configuration, matching where these identities actually live.
- **Gas estimation on the G$ sweep.** The sweep transaction now estimates gas
  explicitly with a safety margin instead of failing with "intrinsic gas too
  low".

**Why it matters.** These are real, already-verified humans — the most valuable
users GoodDrops can onboard. Every migration failure is a person who did the hard
part (face verification) and then hit a wall. Making migration reliable is
directly making the user base bigger and higher-quality.

---

## 8. Discoverability (SEO)

**What it is.** Proper metadata, canonical domain, sitemap, robots, and
structured data so `gooddrops.xyz` is understood and surfaced by search engines
and link unfurls.

**Why it matters.** A location-based money app grows by word of mouth and shared
links. If a shared GoodDrops link looks broken or a search turns up nothing, that
growth leaks away. Good SEO is table stakes for being taken seriously.

---

### The through-line

Every feature here reduces one of a few core frictions:

- **"I can't find it."** → Landmarks + crowdsourcing give the map real places, and
  landmark-anchored clues point hunters at the exact spot.
- **"Is this fair / real / safe?"** → Identity-scoped anti-cheat, verified-only
  suggestions and reports, and one-tap moderation keep the map honest.
- **"Nothing's happening near me."** → Proximity alerts surface drops in the
  moment; re-verify reminders keep verified humans from silently churning.
- **"It's broken."** → Drop/claim/migration fixes remove the dead-ends that make
  a money app feel untrustworthy.

Get those right and GoodDrops is something people actually want to use — and tell
their neighbours about.

---

## 9. Product Analytics (Vercel Analytics)

**What it is.** `@vercel/analytics` is mounted app-wide, capturing page views and
Web Vitals with zero PII and no cookie banner.

**Why it matters.** You can't improve what you can't see. Knowing which pages
hunters actually land on, where they drop off, and how fast the app feels turns
"I think" into "I know" — so the next round of work targets what real usage shows,
not guesses. It auto-collects once deployed on Vercel; nothing to configure.

---

## 10. Webhook Hardening & Tests

**What it is.** The drop webhook (`/api/push/webhook`) — which powers claim
notifications and the new "drop near you" broadcast — now understands **both** the
generic event shape *and* Goldsky's real Mirror/entity-diff shape
(`{ op: "INSERT" | "UPDATE", data: { new, old } }`), deriving *created* vs
*claimed* from the row's status transition. It also ignores events older than 15
minutes, so a subgraph re-index or Mirror bootstrap can never blast stale pings.
When `GOLDSKY_WEBHOOK_SECRET` is set, the endpoint **verifies the
`goldsky-webhook-secret` header** and rejects anything else — so nobody can forge
drop events to trigger spam pushes. The normalisation is a pure module
(`lib/webhookNormalize.ts`) covered by unit tests, alongside tests for the
report/landmark **signature auth round-trips** (client signs → server recovers the
exact signer), the admin allowlist, and the input validators.

**Why it matters.** Notifications that fire on the wrong payload shape — or spam
users during a re-index — erode trust fast in a money app. Matching the actual
webhook format and guarding replay makes the alerts dependable. The tests lock in
the security-critical bits (a report can't be replayed for a different drop, a
non-admin can't pass the allowlist) so future changes can't quietly break them.
Run them with `npm test`.

---

## 11. Admin Health Dashboard

**What it is.** A **Health** tab (`/admin/health`) that shows, at a glance, the
status of every external dependency the app relies on — Redis (with a live ping),
the subgraph (with its current indexed block), web-push/VAPID, and each secret
(internal notify, Goldsky webhook, cron) — each flagged OK / Warn / Error / Off,
plus live counts (push subscribers, hunters sharing location, reported/hidden
drops, landmarks). It's admin-cookie gated and never exposes secret values.

**Why it matters.** These new features lean on services that live *outside* the
codebase — a webhook you configure in Goldsky, env vars you set in Vercel, a cron
that only fires when its secret is present. When something isn't wired, the
symptom is silent (a push that just never arrives), which is miserable to debug.
The Health tab turns "is it actually working?" into a five-second glance, so
misconfiguration is caught immediately instead of via a confused user. It's also
your post-deploy smoke test.

---

### Configuration notes (for whoever deploys)

- **Nearby-drop alerts** rely on the on-chain webhook (Goldsky → `/api/push/webhook`)
  delivering each new drop's `lat`/`lng`. The handler now speaks Goldsky's Mirror
  format, but you must still have a Goldsky webhook *configured* to POST `Drop`
  entity changes to that path. The broadcast no-ops safely if coordinates are
  absent.
- **Re-verify reminders** run via Vercel Cron (`dapp/vercel.json`) and require a
  `CRON_SECRET` env var; the endpoint fails closed without it. Vercel automatically
  sends that secret as the cron request's `Authorization` header. Generate one with
  `openssl rand -hex 32`.
  - **Vercel Hobby only allows once-daily crons**, so the schedule is `0 9 * * *`
    (09:00 UTC daily). At the current subscriber count one daily run covers
    everyone; the run also rotates a cursor so a larger base is covered across
    days (well inside the 3-day reminder cooldown).
  - Want tighter timing (e.g. every 6h)? Either upgrade to Vercel Pro and change
    the schedule, or point an external free scheduler (cron-job.org, GitHub
    Actions, Upstash QStash) at `GET /api/cron/reverify` with the header
    `Authorization: Bearer <CRON_SECRET>`.
- See `dapp/.env.example` for the full, commented list of environment variables.
- Push features reuse the existing VAPID/web-push setup and Upstash Redis.
