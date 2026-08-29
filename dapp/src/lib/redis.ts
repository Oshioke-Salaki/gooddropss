import { Redis } from "@upstash/redis";

// Returns null if Upstash is not configured — all callers handle this gracefully.
export function getRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({
    url,
    token,
    // Fail fast: the default (5 retries, exponential backoff) makes API routes
    // hang for 20–30s when the network blips. One quick retry, then callers'
    // graceful fallbacks kick in.
    retry: { retries: 1, backoff: () => 300 },
  });
}

// ── Key helpers ───────────────────────────────────────────────────────────────
export const keys = {
  subscription:     (address: string) => `sub:${address.toLowerCase()}`,
  // Index of every push-subscribed address — lets background jobs enumerate
  // subscribers (nearby-drop broadcast, re-verify reminders).
  subscribersIndex: ()                => `gd:subs:index`,
  // Opt-in coarse hunter locations for "drop near you" alerts. Hash addr→"lat,lng,ts".
  huntersLoc:       ()                => `gd:hunters:loc`,
  // Per-hunter cooldowns so we never spam.
  hunterNearbyCd:   (address: string) => `gd:hunter:nearbycd:${address.toLowerCase()}`,
  reverifyReminded: (address: string) => `gd:reverify:reminded:${address.toLowerCase()}`,
  reverifyCursor:   ()                => `gd:reverify:cursor`,
  // Cross-instance cache of wallet → GoodDollar identity root. Roots change only
  // on connect/disconnect, so this is safe to cache for a day and saves an RPC
  // read on nearly every stats API call (a big Active-CPU saver on Vercel).
  identityRoot:     (addr: string)    => `gd:idroot:${addr.toLowerCase()}`,
  // Presence ledger — GPS-verified claims per identity root (the badge/set/API substrate)
  presence:         (root: string)    => `gd:presence:${root.toLowerCase()}`,
  // Presence badges — custom defs + sets (hashes), earned (zset: id→earnedAt), holder counts
  badgeDefs:        ()                => `gd:badge:defs`,
  badgeSets:        ()                => `gd:badge:sets`,
  badgesOf:         (root: string)    => `gd:badges:${root.toLowerCase()}`,
  badgeHolders:     (badgeId: string) => `gd:badge:holders:${badgeId}`,
  badgeMinted:      (root: string)    => `gd:badge:minted:${root.toLowerCase()}`,   // Set of on-chain-minted badgeIds
  badgeMintLock:    (root: string, badgeId: string) => `gd:badge:mintlock:${root.toLowerCase()}:${badgeId}`,
  // Anti-spoof shadow log — flagged (not necessarily blocked) claim attempts
  spoofFlags:       ()                => `gd:spoof:flags`,
  // Gas top-up faucet — layered anti-drain limits
  gasCooldown:      (root: string)    => `gd:gas:cd:${root.toLowerCase()}`,      // min gap between top-ups
  gasMonthly:       (root: string)    => `gd:gas:month:${root.toLowerCase()}`,   // rolling 30d counter
  gasDaily:         (date: string)    => `gd:gas:day:${date}`,                   // global circuit breaker
  gasIpDaily:       (ip: string, date: string) => `gd:gas:ip:${ip}:${date}`,     // per-IP secondary cap
  gasLock:          (root: string)    => `gd:gas:lock:${root.toLowerCase()}`,    // double-send guard
  gasLog:           ()                => `gd:gas:log`,                           // audit trail (list)
  comments:         (dropId: string)  => `comments:${dropId}`,
  campaign:         (id: string)      => `gd:campaign:${id}`,
  campaignsByOwner: (addr: string)    => `gd:campaigns:owner:${addr.toLowerCase()}`,
  campaignClaims:   (id: string)      => `gd:campaign:claims:${id}`,
  streak:           (address: string) => `gd:streak:${address.toLowerCase()}`,
  privateDrop:      (token: string)   => `gd:privdrop:${token}`,
  velocity:         (address: string) => `gd:velocity:${address.toLowerCase()}`,
  // Riddle-locked drops
  riddle:           (dropId: string)  => `gd:riddle:${dropId}`,
  // Pending riddle held under a client token between "store" (signed, pre-drop)
  // and "bind" (token → dropId, post-drop). Short-lived; bound within seconds.
  riddleToken:      (token: string)   => `gd:riddle:token:${token}`,
  riddleLock:       (dropId: string)  => `gd:riddle:lock:${dropId}`,
  riddleTries:      (dropId: string, address: string) =>
    `gd:riddle:tries:${dropId}:${address.toLowerCase()}`,
  // GoodSpots — merchants that accept G$ at a physical location
  spot:             (id: string)      => `gd:spot:${id}`,
  spotsAll:         ()                => `gd:spots:all`,
  spotsByOwner:     (addr: string)    => `gd:spots:owner:${addr.toLowerCase()}`,
  spotPayments:     (id: string)      => `gd:spot:payments:${id}`,

  // ── Merchant task-locked drops (Phase 3) ──────────────────────────────────
  // A task drop is [T:spotId] on-chain; the task text lives here. The hunter mints
  // a single-use QR nonce; the merchant (spot owner) scans + approves it, which
  // writes a short-lived approval that /api/claim-proof requires before signing.
  taskDrop:          (dropId: string)              => `gd:task:drop:${dropId}`,           // { spotId, task, createdAt }
  taskQr:            (nonce: string)               => `gd:task:qr:${nonce}`,              // { dropId, root, spotId } · single-use · TTL 300s
  taskQrCooldown:    (root: string)                => `gd:task:qrcd:${root.toLowerCase()}`, // anti-spam on nonce minting
  taskApproval:      (dropId: string, root: string) => `gd:task:appr:${dropId}:${root.toLowerCase()}`, // TTL 10m; claim-proof requires it
  taskApprovalsDaily:(spotId: string, date: string) => `gd:task:apprday:${spotId}:${date}`,           // per-merchant daily cap
  taskApprovalLog:   ()                            => `gd:task:log`,                       // audit list (moderation surface)
  taskDropsBySpot:   (spotId: string)              => `gd:task:byspot:${spotId}`,          // list of a spot's reward dropIds (newest first)
  // Admin-curated map landmarks
  landmark:         (id: string)      => `gd:landmark:${id}`,
  landmarksIndex:   ()                => `gd:landmarks:index`, // Set of ids (idempotent)
  // Ids a wallet has PENDING review — caps how many suggestions one human can queue
  landmarksPendingByWallet: (addr: string) => `gd:landmarks:pending:${addr.toLowerCase()}`,
  // Referrals — identity-root scoped (Sybil-proof, one referrer per person)
  referredBy:        (inviteeRoot: string)  => `gd:ref:by:${inviteeRoot.toLowerCase()}`,   // string: referrer root
  referralsOf:       (referrerRoot: string) => `gd:ref:of:${referrerRoot.toLowerCase()}`,  // Set of invitee roots
  referralLeaders:   ()                      => `gd:ref:leaders`,                           // Sorted set: root → count
  // Per-referrer zset of invitee roots → creditedAt (unix s). Lets the referral
  // competition window referrals by time; also the badge/expand source.
  referralCredited:  (referrerRoot: string) => `gd:ref:credited:${referrerRoot.toLowerCase()}`,

  // ── Drop competition (reach) ──────────────────────────────────────────────
  compConfig:        ()                      => `gd:comp:config`,                  // JSON CompConfig (admin-editable)
  // The wallet a winner's prize is paid to — their CURRENT GoodDrops wallet (the
  // address their invite link was generated from), refreshed on each referral.
  compPayoutWallet:  (referrerRoot: string)  => `gd:comp:wallet:${referrerRoot.toLowerCase()}`,
  // Drop reports & moderation
  dropReport:        (dropId: string, reporter: string) =>
    `gd:report:${dropId}:${reporter.toLowerCase()}`,     // one report JSON per reporter+drop
  dropReporters:     (dropId: string) => `gd:reports:drop:${dropId}`,  // Set of reporter addrs
  reportedDropsIndex:()               => `gd:reports:index`,           // Set of reported dropIds
  hiddenDrops:       ()               => `gd:drops:hidden`,            // Set of admin-hidden dropIds
};
