# Shared sign-in with GoodDrops

**For:** the engineer (or AI agent) integrating on the partner side.
**Outcome:** a GoodDrops user can sign into your app with the wallet they already have — and your user can do the same on GoodDrops. No re-verification, no linking transaction, no key export. Both sides keep full control of their own Magic app and can revoke in one click.

Total work on your side: **two dashboard entries and one extra login button.** Nothing else in your app changes.

---

## Why it works (read this first — it shapes every decision below)

A Magic Dedicated Wallet belongs to the **Magic app (publishable key) that created it**. The same email in two apps is two different wallets. That's why a GoodDrops user can't simply "sign up" on your app and reuse their verified identity — they'd get a brand-new, unverified wallet, and GoodDollar's face-dedup would then block them from verifying it.

Magic also rejects any request from a domain that isn't on the app's **domain allowlist**.

Put those together and the fix is small: **your app initialises a second Magic instance with GoodDrops' publishable key**, and GoodDrops adds your domain to its allowlist. A GoodDrops user then logs in on your site, against GoodDrops' Magic app, and receives their existing GoodDrops wallet — already GoodDollar-verified, G$ balance intact. Your own Magic app is never touched.

The user still enters an email OTP on your domain. Nobody gets silent access to anyone's wallet.

---

## Part 1 — Your Magic dashboard (5 minutes)

Dashboard → your app → **Settings → Allowed Origins & Redirects**.

Add both GoodDrops domains:

```
https://gooddrops.xyz
https://www.gooddrops.xyz
```

That's it. Nothing else changes in your dashboard.

**What this permits:** GoodDrops' site can initialise Magic with *your* publishable key, so *your* users can log into GoodDrops with their existing wallet. It does not let GoodDrops see any key, session or user data — the user still completes an OTP, on GoodDrops' domain, each time.

**To revoke:** remove the two lines. Takes effect immediately.

---

## Part 2 — Your code (one login button)

You'll add a "Continue with GoodDrops" option that runs against GoodDrops' key. Two rules that matter:

1. **Keep it a separate `Magic` instance.** Do not reuse or reconfigure your own. `magic-sdk` isolates instances by publishable key — separate iframe, separate session — so the two never interfere. (You'll see a harmless "duplicate iframe" console warning only if you accidentally create two instances with the *same* key.)
2. **Email OTP only on this path.** Google/social login via GoodDrops' key would require GoodDrops to register *your* callback URL on *their* redirect allowlist and enable the provider — needless coupling. Email is what these users have anyway.

Settings to use:

| | Value |
|---|---|
| Publishable key | `<GOODDROPS_PUBLISHABLE_KEY — Oshioke will send this>` |
| Chain | Celo mainnet, chainId `42220` |
| RPC | `https://forno.celo.org` |
| Login method | `loginWithEmailOTP` |

### If you use plain `magic-sdk`

```ts
import { Magic } from "magic-sdk";

// A SECOND instance, alongside your own. Different key → different iframe,
// different session. Never call login on both for the same user.
export const magicGoodDrops = new Magic(GOODDROPS_PUBLISHABLE_KEY, {
  network: { rpcUrl: "https://forno.celo.org", chainId: 42220 },
});

async function continueWithGoodDrops(email: string) {
  await magicGoodDrops.auth.loginWithEmailOTP({ email, showUI: true });
  // From here, use exactly what you use for your own users:
  const provider = magicGoodDrops.rpcProvider;           // EIP-1193
  const [address] = await provider.request({ method: "eth_accounts" });
  // address is the user's GoodDrops wallet — pass it into your existing
  // wallet plumbing (viem/ethers/wagmi) as you would any Magic wallet.
}

async function logout() {
  // Log out whichever instance is logged in.
  if (await magicGoodDrops.user.isLoggedIn()) await magicGoodDrops.user.logout();
  else await magicOwn.user.logout();
}
```

### If you use wagmi + `@magiclabs/wagmi-connector`

The connector hardcodes `id: "magic"`, so a second one would collide with yours in wagmi's connector lookups and reconnect storage. Wrap the factory and override `id`/`name`:

```ts
import { dedicatedWalletConnector } from "@magiclabs/wagmi-connector";
import type { CreateConnectorFn } from "wagmi";
import { celo } from "viem/chains";

export const GOODDROPS_CONNECTOR_ID = "magic-gooddrops";

const base = dedicatedWalletConnector({
  chains: [celo],
  options: {
    apiKey: GOODDROPS_PUBLISHABLE_KEY,
    magicSdkConfiguration: { network: { rpcUrl: "https://forno.celo.org", chainId: celo.id } },
    enableEmailLogin: true,
    // No oauthOptions — email only on this path (see rule 2).
  },
}) as unknown as (config: Parameters<CreateConnectorFn>[0]) => Record<string, unknown>;

export const goodDropsConnector: CreateConnectorFn = (config) =>
  ({ ...base(config), id: GOODDROPS_CONNECTOR_ID, name: "GoodDrops" }) as unknown as ReturnType<CreateConnectorFn>;

// Add it to your createConfig({ connectors: [...] }) next to your own Magic connector.
```

Then, to log in headlessly with your own email field (so Magic only shows its code screen):

```ts
const connector = connectors.find((c) => c.id === GOODDROPS_CONNECTOR_ID);
const sdk = (connector as any).magic;            // the connector's own Magic instance
await sdk.auth.loginWithEmailOTP({ email, showUI: true });
await connectAsync({ connector, chainId: celo.id });
```

**Anywhere your code does `connectors.find(c => c.id === "magic")`**, make sure it still means *your* connector and that any list of "external wallets" excludes `GOODDROPS_CONNECTOR_ID` too.

### UI

- Add a **"Continue with GoodDrops"** row to your sign-in screen. Tapping it shows an email field whose placeholder reads *"Your GoodDrops email"*, then triggers the OTP.
- Remember the choice (e.g. `localStorage`) so a GoodDrops user lands on that path on return visits instead of hunting for it.
- Logo: `https://www.gooddrops.xyz/logo-mark.svg` (or ask for a PNG).

---

## Part 3 — Identity: nothing to do

A user arriving through this path is signed in with the wallet GoodDollar verified **directly**. So whichever check your app makes — `isWhitelisted(address)` or `getWhitelistedRoot(address)` — returns true / the address itself. There is no linked-wallet edge case to handle, because nothing was linked.

Their G$ balance is in that same wallet. UBI claims, drops, whatever your app does with a verified user — it just works.

---

## Part 4 — Counting shared users

Worth agreeing on before launch, because the obvious number is wrong.

**Magic's dashboard will never show shared users.** It counts wallets the app *created*: a GoodDrops user on your site is counted on GoodDrops' Magic app, not yours, and vice versa. So if either of us reports users off the Magic dashboard, the collaboration is invisible on both sides.

**Count on-chain activity instead.** GoodDrops already does: a user is a unique **GoodDollar identity root** that created or claimed at least one drop in the GoodDrops contract, read from its indexer. If you define a user the same way for your contract, then 500 people active in both apps show as 500 on *both* dashboards — which is the truth.

Please count by identity root (`getWhitelistedRoot`), not raw address, or one human with two wallets inflates your number and it won't be comparable to ours.

---

## Part 5 — Billing: nothing changes for either side

Magic bills **Monthly Active Wallets**, defined as *any wallet that performs at least one transaction or authentication event within a 30-day period*. A wallet belongs to exactly one Magic app, and billing follows the app. So:

- A GoodDrops user logging into your site is a GoodDrops wallet → counts on **GoodDrops'** plan, not yours.
- Your user logging into GoodDrops → counts on **yours**, not GoodDrops'.
- The same wallet used on both sites in a month is **one** MAW, not two.

Each app pays only for the wallets it created, wherever they're used.

---

## Part 6 — Smoke test (before announcing)

1. Have a GoodDrops team member open your site, choose "Continue with GoodDrops", enter their GoodDrops email, complete the OTP.
2. Confirm the address shown is their **GoodDrops** wallet (not a new one) and that your app treats them as verified.
3. Confirm your own login still works unchanged, and that logging out of one doesn't break the other.
4. Confirm your Magic dashboard user count did **not** go up.
5. Then the mirror: a user of yours signs into gooddrops.xyz via "Continue with *[your app]*".

Local testing: Magic's allowlist accepts `localhost` with a port, so for cross-key testing on your machine, GoodDrops can temporarily add `http://localhost:<port>` to its allowlist — ask.

---

## What to send back to GoodDrops

So the mirror can be switched on (it's already built and waiting on these):

1. Your Magic **publishable** key (`pk_live_…`). Publishable keys are safe to share — they're already in your site's JavaScript.
2. Your production domain(s), exactly as they appear in the browser (with/without `www`).
3. Your app's display name, and a logo URL for the "Continue with …" row.
4. Confirmation that `gooddrops.xyz` and `www.gooddrops.xyz` are on your allowlist.

---

## FAQ

**Can GoodDrops access our users' wallets with this?**
No. The allowlist lets GoodDrops' *domain* initialise Magic with your key; every login still requires the user to complete an OTP on that domain. It's the same trust you extend to your own frontend, and it's revocable instantly.

**What about a user who already signed up to both apps separately?**
They have two wallets, one per app. They pick whichever they want to use on either site. If it ever matters, GoodDollar's `connectAccount` can link them — but it's not needed for this to work and most users won't be in that situation.

**Does this move or copy the identity?**
Neither. Nothing is created or linked. The user simply uses their existing wallet from a second domain.

**Why not key export, or GoodDollar's "connect account" linking?**
Key export teaches users to paste private keys into websites — the behaviour drainers rely on. `connectAccount` requires the verified wallet to send a gas-paying transaction and leaves the identity dependent on the original wallet re-verifying every 180 days. The allowlist route has neither problem.
