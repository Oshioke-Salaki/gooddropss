# Things we have to come back to

Running list of things parked during the 2026 UI refresh, so nothing gets lost.
Add to it freely — one row per item, newest at the bottom of its section.

---

## Temporarily commented out

Code is still in place, wrapped in a JSX comment with a "Restore by uncommenting"
note at each site. Nothing was deleted.

| What | Where | Why it was parked | What it needs |
|---|---|---|---|
| **"N drops live" status badge** (also its "Loading drops…" and "No drops yet — be the first!" states) | `src/app/page.tsx`, just above the heatmap block | Fixed at `top: 70px`, which now lands on top of the mobile search band. Still in the old brutalist style (lime, `border-2 border-ink`, `shadow-brutal-sm`). | Reposition so it clears `--spacing-nav` + the search band, and restyle to the refresh. Decide whether it belongs on mobile at all. |
| **Hotspots / demand-heatmap toggle** | `src/app/page.tsx`, below the status badge | Old brutalist styling, and it competed with the new map controls in the bottom-left corner. | Restyle to match `MapZoomControls` / `MyLocationButton` and find it a home. The heatmap layer itself still works — `MapView` keeps `heatmapPoints` / `showHeatmap`, only the toggle UI is hidden, so `showHeatmap` is stuck at `false`. |

### Dangling reference

`src/components/CreateDropSheet.tsx` (~line 997) still tells the user
*"Tip: 🔥 Hotspots on the map shows where hunters are active."* — that control is
currently hidden, so the tip points at nothing. Reword or drop it if the toggle
doesn't come back soon.

---

## Dropped in the leaderboard rewrite

Both were in the old page and have no slot in the new design. Say the word if
either should come back.

- **Hunter streak chips.** The old board fetched streaks for the top 20 hunters
  and showed a 🔥 badge beside names with a 2+ day streak. There's no room for it
  in the new row, and it cost 20 extra requests per load.
- **The inline "that's you — claim your name" nudge.** Replaced by the floating
  MeBar, which offers "Set your name" in the amount slot when the connected
  wallet has no username.

---

## Badges — artwork needs a decision

`public/badges/` has **12 illustrations**, but their names don't match any badge
in `src/lib/badges.ts`. They look like a new, nicer-named badge set.

**Badge IDs cannot be renamed.** `badgeTypeId()` is `keccak256(slug)` and must
match `GoodDropsBadges.sol` — renaming an id orphans every badge already minted
on-chain. So artwork is mapped *onto* existing ids in
`src/components/profile/badgeArt.ts`.

Mapped so far (4 of 11 built-ins), only where the meaning is unambiguous:

| Badge id | Artwork | Why |
|---|---|---|
| `drop-maker` | genesis-drop | "created your first drop"; parachute matches the 🪂 it replaces |
| `whale` | crypto-whale | exact |
| `pioneer` | territory-maker | "created 10+ drops" — planted flag |
| `money-magnet` | honey-pot | "found 1,000+ G$ in total" |

**Built-ins still on emoji — art needed:** `first-hunt` 🎯, `speed-demon` ⚡,
`legend` 👑, `collector` 🛡️, `serial-hunter` 🔟, `hunt-machine` 💯, `on-fire` 🔥.

**Artwork with no badge yet** — tell me which id each belongs to (or whether
these should become *new* badges with new rules): micro-funder, endless-well,
event-host, wilderness, the-riddler, crowd-pleaser, full-cycle, beacon-of-light.

The mock's "Wilderness — place a drop in a remote, scenic, or hard-to-reach
outdoor location" isn't a rule the engine has today; it would need a new
`BadgeRule` variant.

---

## Drop G$ drawer

Replaced `CreateDropSheet` (1398 lines, deleted). Logic now lives in
`src/components/drop/useCreateDrop.ts`; the drawer is layout only.

| What | Notes |
|---|---|
| **Campaign drops lost their banner** | `campaignId` / `campaignName` still work end-to-end (the `[C:…]` hint encoding is untouched), but the old coloured campaign header is gone, and `campaignColor` is no longer a prop. Nothing in the app currently passes `campaignId`, so this is dormant until campaigns come back. |
| **Preview map is a second WebGL context** | `DropMiniMap` creates its own MapLibre instance while the drawer is open. It's non-interactive and disposed on close, but on a low-end phone two live GL contexts is a real cost. If it bites, swap it for a static raster preview. |
| **`BatchDropCreator` and `ChainDropCreator` are still the old design** | Both duplicate chunks of the drop logic (approval, the SKEW expiry maths, the identity gate). They could now be rebuilt on `useCreateDrop`. |

---

## Map markers

| What | Notes |
|---|---|
| **`landmarkMeta` is no longer used on the map** | The old landmark label showed a per-category icon and border colour from `landmarkMeta()` (`src/lib/landmarks.ts`). The new pill uses one red pin for everything, so category is no longer distinguishable at a glance. `landmarkMeta` is still used by the landmark sheets and `MapSearchBar`'s subtitle — it's only the map label that dropped it. Decide whether category should come back as a small chip on the pill, or whether the pin should be tinted per category. |
| **Special-drop variations** | Flash / riddle / chain / campaign / task drops currently collapse into a single placeholder emoji on the drop pill (`typeMark` in `src/components/map/markers.ts`). Designer is drawing proper variations — swap the emoji for the artwork when it lands. |
| **`public/treasure_chest.svg` should be deleted** | It's a 2048×2048 PNG base64'd inside a 31×32 SVG — **2.24 MB**. Replaced by `public/treasure-chest.png` (64px, 4 KB). The old file is still shipping in the bundle. |
| **Other map components could move into `src/components/map/`** | `MapSearchBar`, `MapZoomControls`, `MyLocationButton`, `MapActionButtons` are still in `src/components/`. `markers.ts` moved there; the rest is a mechanical import update. |

---

## Dropped in the profile rewrite

The drawer replaced the old `/hunter/[address]` body. These components are now
unreferenced — kept on disk, not deleted:

| Component | What it did | Note |
|---|---|---|
| `ShareableHunterCard` | Rendered a shareable stat card | "Share card" currently shares/copies the profile link instead |
| `OwnerDropsCard` | Manage your own drops from your profile | Still reachable from the map |
| `OwnProfileInvite` | Invite-a-friend block | Also on `/competition` |
| `BadgeWall` | Old badge grid + "save to wallet" | **Saving badges on-chain has no UI now** — see below |
| `HunterStreakBadge` · `HunterRank` · `EditAvatarButton` | | Streak is a chip in the drawer; rank is the medal; avatar edit is in the wallet modal |

**The one real gap: saving badges to the wallet.** `BadgeWall` had a free,
relayer-paid "Save your N badges" button hitting `/api/badges/mint`. The drawer
shows `minted` state but has no way to trigger it. The endpoint is untouched —
it just needs a button.

---

## Design assets still needed

| What | Notes |
|---|---|
| **Blue basket logo mark** | Every mockup of the refreshed nav shows a blue basket icon, but there's no such asset in `public/`. `logo-mark.svg` is the old lime drop-pin. The nav still renders the text logo ("good" + "drops."). Drop the SVG in and it's a one-line swap in `Nav.tsx`. |

---

## Done since this list started

- **`BottomNav` removed.** The hamburger rail replaces it. Its `bottom-16` allowance
  came off the map box in `page.tsx`, and the bottom map controls dropped from
  `96px` to `32px` now that there's no bar to clear.

---

## Refresh not finished

| What | Notes |
|---|---|
| **Pages still on the old look** | `/competition`, `/merchant`, `/my-drops`. (`/leaderboard` is done.) |
| **`text-sm/[100%]` everywhere** | `text-sm/none` is the shorter equivalent and works today — no config needed. Once every page is migrated we *could* make 100% leading the default by setting `--text-sm--line-height: 1` (and siblings) in `@theme`, so bare `text-sm` is enough. Not safe yet: the unmigrated pages have real paragraph text that would go cramped. |
| **Old brutalist sheets** | `CreateDropSheet`, `ClaimSheet`, `ChainDropCreator`, `LocationPickerSheet`, `ShopSheet`, `HuntingMode`, `VerificationModal`, `ColdStartCard`, `GasTopup`, `PushPermissionBanner`, `VerifyBanner` — all still 2.5px borders, offset shadows, lime. |

---

## Partner shared sign-in — built, switched off

Code is live but inert until `NEXT_PUBLIC_PARTNER_MAGIC_KEY` is set. To activate:

1. Partner sends: publishable key, domains, name, logo (see `../PARTNER_SHARED_LOGIN.md`).
2. **Our Magic dashboard** → Settings → Allowed Origins & Redirects → add the partner's domain(s). Dashboard step — can't be done from code.
3. Set the four `NEXT_PUBLIC_PARTNER_*` vars in Vercel and redeploy.
4. Smoke test both directions (partner doc, Part 6).

For local cross-key testing, temporarily add `http://localhost:3000` to **our** allowlist so the partner can test against our key; remove after.

---

## Ops

| What | Notes |
|---|---|
| **Fund the reward wallet** | Both competitions need ~1,993,383 G$ total; balance was 961.98 G$ last checked. CELO for gas is fine. |
| **Nothing is deployed** | Every bit of the UI refresh is local-only so far. |

## Modal container — migrate the rest onto `Sheet`

`src/components/ui/Sheet.tsx` is now the one modal primitive (portal, backdrop,
Escape, scroll lock, phone bottom sheet with swipe-to-dismiss + keyboard inset,
centred card at lg). Edit profile, the avatar picker and both onboarding steps
use it. Still hand-rolled and worth moving over one at a time, checking each
visually: SendGModal, WalletModal, BadgeViewer, ProfileDrawer, LocationPickerSheet,
ClaimSheet, ReportDropSheet, ShopSheet, LandmarkManageSheet.

## Avatars

Twelve 3D faces live in `public/avatars/` (Fluent Emoji, MIT — see LICENSE.md
there) and are listed in `AVATAR_IMAGES` (`src/lib/avatarPresets.ts`). To swap
or add art: drop a 256px+ transparent PNG in that folder and add a row. Never
reuse an id. The old emoji presets stay valid for people who already chose one.
