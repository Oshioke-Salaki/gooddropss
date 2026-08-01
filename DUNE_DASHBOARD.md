# GoodDrops — Dune Analytics Dashboard

A step-by-step to build an on-chain analytics dashboard for GoodDrops on Dune,
plus every query you need.

- **Contract (proxy):** `0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131`
- **Chain:** Celo (42220)
- **Token:** G$ — 18 decimals (so `amount / 1e18` = G$)
- **Coordinates:** `lat` / `lng` are `int32`, degrees × 1e6

---

## The shape of the work

1. **Decode the contract** → turns raw logs into clean tables you can `SELECT` from.
2. **Write one query per chart**, run + save each.
3. **Add a visualization** to each query.
4. **Assemble the dashboard** from those visualizations.

---

## Step 1 — Decode the contract (do this first)

Dune needs decoded event tables. You have two paths:

**A) Auto (easiest):** Because the contract is a proxy, decoding works best if the
**implementation is verified on Celoscan**. Search Dune for the address first —
if `gooddrops_celo.*` tables already exist, skip to Step 2.

**B) Submit for decoding:**
1. On Dune: your avatar → **Submit a contract for decoding** (also under **Data → Decoded contracts → Submit**).
2. Fill in:
   - **Address:** `0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131` (the **proxy** — events are emitted here)
   - **Blockchain:** Celo
   - **Contract name:** `GoodDrops`
   - **Project / namespace:** `gooddrops`
   - **ABI:** paste the `abi` array from
     `contracts/artifacts/contracts/GoodDrops.sol/GoodDrops.json`
     (or copy it from the verified contract on Celoscan).
3. Submit and wait (usually minutes). You'll get these tables:
   - `gooddrops_celo.gooddrops_evt_dropcreated`
   - `gooddrops_celo.gooddrops_evt_dropclaimed`
   - `gooddrops_celo.gooddrops_evt_dropreclaimed`
   - `gooddrops_celo.gooddrops_evt_dropextended`

> **Table naming:** `<namespace>_<chain>.<ContractName>_evt_<EventName>`. If you
> chose a different namespace/name, adjust the table names in every query below.
> Confirm the exact names in Dune's **Data** explorer.

**Decoded columns you'll use:** the event params (`dropId`, `dropper`, `claimer`,
`amount`, `lat`, `lng`, `expiry`, `hint`, `claimedAt`) **plus** metadata:
`evt_block_time`, `evt_block_number`, `evt_tx_hash`, `evt_index`.

---

## Step 2 — Create the queries

For each block below: **New query** → paste SQL → **Run** → **Save** with the given
name. Then add the suggested visualization (Step 3).

### Q1 · Overview KPIs  → *Counter* widgets
One query, many numbers. Make several **Counter** visualizations from it, each
pointing at a different column.

```sql
SELECT
  (SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropcreated)                          AS drops_created,
  (SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropclaimed)                          AS drops_claimed,
  (SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropreclaimed)                        AS drops_reclaimed,
  (SELECT cast(sum(amount) AS double)/1e18 FROM gooddrops_celo.gooddrops_evt_dropcreated)  AS gd_dropped,
  (SELECT cast(sum(amount) AS double)/1e18 FROM gooddrops_celo.gooddrops_evt_dropclaimed)  AS gd_claimed,
  (SELECT count(DISTINCT dropper) FROM gooddrops_celo.gooddrops_evt_dropcreated)           AS unique_droppers,
  (SELECT count(DISTINCT claimer) FROM gooddrops_celo.gooddrops_evt_dropclaimed)           AS unique_hunters,
  round(100.0 * (SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropclaimed)
        / nullif((SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropcreated), 0), 1)   AS claim_rate_pct
```

### Q2 · Daily activity: created vs claimed  → *Bar* (or *Area*) chart
X = `day`; Y = `drops_created`, `drops_claimed` (and/or the G$ columns).

```sql
WITH created AS (
  SELECT date_trunc('day', evt_block_time) AS day,
         count(*) AS drops_created,
         cast(sum(amount) AS double)/1e18 AS gd_dropped
  FROM gooddrops_celo.gooddrops_evt_dropcreated
  GROUP BY 1
),
claimed AS (
  SELECT date_trunc('day', evt_block_time) AS day,
         count(*) AS drops_claimed,
         cast(sum(amount) AS double)/1e18 AS gd_claimed
  FROM gooddrops_celo.gooddrops_evt_dropclaimed
  GROUP BY 1
)
SELECT
  coalesce(c.day, x.day)          AS day,
  coalesce(c.drops_created, 0)    AS drops_created,
  coalesce(x.drops_claimed, 0)    AS drops_claimed,
  coalesce(c.gd_dropped, 0)       AS gd_dropped,
  coalesce(x.gd_claimed, 0)       AS gd_claimed
FROM created c
FULL OUTER JOIN claimed x ON c.day = x.day
ORDER BY 1
```

### Q3 · Cumulative G$ claimed  → *Area* chart
X = `day`; Y = `cumulative_gd_claimed`.

```sql
SELECT day, sum(gd_claimed) OVER (ORDER BY day) AS cumulative_gd_claimed
FROM (
  SELECT date_trunc('day', evt_block_time) AS day,
         cast(sum(amount) AS double)/1e18 AS gd_claimed
  FROM gooddrops_celo.gooddrops_evt_dropclaimed
  GROUP BY 1
) t
ORDER BY day
```

### Q4 · Top droppers  → *Table* (or horizontal *Bar*)
```sql
SELECT dropper,
       count(*)                          AS drops,
       cast(sum(amount) AS double)/1e18  AS gd_dropped
FROM gooddrops_celo.gooddrops_evt_dropcreated
GROUP BY 1
ORDER BY gd_dropped DESC
LIMIT 20
```

### Q5 · Top hunters  → *Table* (or horizontal *Bar*)
```sql
SELECT claimer,
       count(*)                          AS claims,
       cast(sum(amount) AS double)/1e18  AS gd_claimed
FROM gooddrops_celo.gooddrops_evt_dropclaimed
GROUP BY 1
ORDER BY gd_claimed DESC
LIMIT 20
```

### Q6 · Time-to-claim  → *Counter*
Join each claim to its creation on `dropId`.

```sql
SELECT
  round(avg(date_diff('minute', cr.evt_block_time, cl.evt_block_time)), 1)          AS avg_minutes,
  approx_percentile(date_diff('minute', cr.evt_block_time, cl.evt_block_time), 0.5) AS median_minutes
FROM gooddrops_celo.gooddrops_evt_dropclaimed cl
JOIN gooddrops_celo.gooddrops_evt_dropcreated cr ON cr.dropId = cl.dropId
```

### Q7 · Outcome breakdown  → *Pie*
```sql
SELECT 'Claimed' AS status, count(*) AS drops
FROM gooddrops_celo.gooddrops_evt_dropclaimed
UNION ALL
SELECT 'Reclaimed', count(*)
FROM gooddrops_celo.gooddrops_evt_dropreclaimed
UNION ALL
SELECT 'Active / expired-unclaimed',
       (SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropcreated)
     - (SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropclaimed)
     - (SELECT count(*) FROM gooddrops_celo.gooddrops_evt_dropreclaimed)
```

### Q8 · Drop-size distribution  → *Bar*
```sql
SELECT
  CASE WHEN a < 10  THEN '01. <10 G$'
       WHEN a < 50  THEN '02. 10–49 G$'
       WHEN a < 100 THEN '03. 50–99 G$'
       WHEN a < 200 THEN '04. 100–199 G$'
       ELSE              '05. 200+ G$' END AS bucket,
  count(*) AS drops
FROM (SELECT cast(amount AS double)/1e18 AS a FROM gooddrops_celo.gooddrops_evt_dropcreated) t
GROUP BY 1
ORDER BY 1
```

### Q9 · New hunters over time  → *Bar*
First-ever claim per wallet = a new hunter that day.

```sql
SELECT date_trunc('day', first_claim) AS day, count(*) AS new_hunters
FROM (
  SELECT claimer, min(evt_block_time) AS first_claim
  FROM gooddrops_celo.gooddrops_evt_dropclaimed
  GROUP BY 1
) t
GROUP BY 1
ORDER BY 1
```

### Q10 · Transactions KPIs (total / 24h / 7d)  → *Counters*
"Transaction" = any GoodDrops interaction (create, claim, reclaim, extend).

```sql
WITH tx AS (
  SELECT evt_block_time AS ts FROM gooddrops_celo.gooddrops_evt_dropcreated
  UNION ALL SELECT evt_block_time FROM gooddrops_celo.gooddrops_evt_dropclaimed
  UNION ALL SELECT evt_block_time FROM gooddrops_celo.gooddrops_evt_dropreclaimed
  UNION ALL SELECT evt_block_time FROM gooddrops_celo.gooddrops_evt_dropextended
)
SELECT
  count(*)                                                        AS total_transactions,
  count_if(ts >= now() - interval '1' day)                        AS daily_transactions,
  count_if(ts >= now() - interval '7' day)                        AS weekly_transactions
FROM tx
```

### Q11 · Users KPIs (total / DAU / WAU / MAU)  → *Counters*
"Active" = wallet that created or claimed a drop in the window.

```sql
WITH activity AS (
  SELECT dropper AS wallet, evt_block_time AS ts FROM gooddrops_celo.gooddrops_evt_dropcreated
  UNION ALL
  SELECT claimer, evt_block_time FROM gooddrops_celo.gooddrops_evt_dropclaimed
)
SELECT
  count(DISTINCT wallet)                                              AS total_users,
  count(DISTINCT IF(ts >= now() - interval '1'  day, wallet))         AS daily_active_users,
  count(DISTINCT IF(ts >= now() - interval '7'  day, wallet))         AS weekly_active_users,
  count(DISTINCT IF(ts >= now() - interval '30' day, wallet))         AS monthly_active_users
FROM activity
```

### Q12 · Daily active users trend (last 30 days)  → *Bar*
```sql
WITH activity AS (
  SELECT dropper AS wallet, evt_block_time AS ts FROM gooddrops_celo.gooddrops_evt_dropcreated
  UNION ALL
  SELECT claimer, evt_block_time FROM gooddrops_celo.gooddrops_evt_dropclaimed
)
SELECT date_trunc('day', ts) AS day, count(DISTINCT wallet) AS active_users
FROM activity
WHERE ts >= now() - interval '30' day
GROUP BY 1
ORDER BY 1
```

### Q13 · Weekly retention rate  → *Counter* (or line over weeks)
Share of each week's active users who come back the following week.

```sql
WITH activity AS (
  SELECT dropper AS wallet, evt_block_time AS ts FROM gooddrops_celo.gooddrops_evt_dropcreated
  UNION ALL
  SELECT claimer, evt_block_time FROM gooddrops_celo.gooddrops_evt_dropclaimed
),
weekly AS (
  SELECT date_trunc('week', ts) AS wk, wallet FROM activity GROUP BY 1, 2
)
SELECT
  prev.wk                                                            AS week,
  count(DISTINCT prev.wallet)                                        AS active_users,
  count(DISTINCT ret.wallet)                                         AS returned_next_week,
  round(100.0 * count(DISTINCT ret.wallet)
        / nullif(count(DISTINCT prev.wallet), 0), 1)                 AS retention_pct
FROM weekly prev
LEFT JOIN weekly ret
  ON ret.wallet = prev.wallet AND ret.wk = prev.wk + interval '7' day
WHERE prev.wk < date_trunc('week', now())   -- only complete weeks
GROUP BY 1
ORDER BY 1 DESC
```

---

## Brand styling — GoodDrops signature colors

Dune lets you set a **custom hex per series** in each visualization's settings
(and per counter). Palette below is validated for Dune's dark chart surface
(contrast + colorblind separation):

| Use | Hex | Where |
|---|---|---|
| **Hero lime** | `#BFFD00` | all counters; any single-series chart (Q3, Q9, Q12) |
| Lime (series) | `#72A300` | "created"/"dropped" series in multi-series charts (Q2, Q8) |
| Blue (series) | `#5B7FE6` | "claimed" series (Q2), 2nd series anywhere |
| Red (series) | `#E05C5C` | "reclaimed" / negative outcomes (Q7) |
| Teal (series) | `#2FA98C` | 3rd/4th series (Q7 "active") |

Rules: don't put full `#BFFD00` on multi-series charts (it shouts over everything);
text/labels stay in Dune's default ink, never colored. Add a **text widget** at the
top of the dashboard: `# 💰 GoodDrops — real G$, hidden in the real world` with the
link to gooddrops.xyz.

---

## Step 3 — Add a visualization to each query

On a saved query, click **New visualization** and pick:

| Query | Visualization | Config |
|-------|---------------|--------|
| Q1 | **Counter** ×N | one per column (drops_created, gd_dropped, claim_rate_pct, …) |
| Q2 | **Bar chart** | X = day · Y = drops_created, drops_claimed |
| Q3 | **Area chart** | X = day · Y = cumulative_gd_claimed |
| Q4 | **Table** | dropper, drops, gd_dropped |
| Q5 | **Table** | claimer, claims, gd_claimed |
| Q6 | **Counter** | avg_minutes (and a 2nd for median) |
| Q7 | **Pie chart** | status · drops |
| Q8 | **Bar chart** | bucket · drops |
| Q9 | **Bar chart** | day · new_hunters |

---

## Step 4 — Assemble the dashboard

1. **New dashboard** (name it "GoodDrops Analytics").
2. **Add visualization** → search your saved queries → drop each onto the grid.
3. Add **Text widgets** as section headers: *Overview*, *Activity over time*,
   *Leaderboards*, *Health*.
4. Suggested layout:
   - Row 1: Q1 counters (drops created, drops claimed, G$ dropped, G$ claimed, unique droppers, unique hunters, claim rate)
   - Row 2: Q2 (daily activity) · Q3 (cumulative G$)
   - Row 3: Q4 (top droppers) · Q5 (top hunters)
   - Row 4: Q6 (time-to-claim) · Q7 (outcomes pie) · Q8 (size distribution) · Q9 (new hunters)
5. **Publish**.

---

## Gotchas / notes

- **Timestamps** on decoded tables are `evt_block_time` (not `block_time`).
- **G$ decimals:** always `cast(amount AS double)/1e18`. Raw `amount` is wei.
- **Namespace:** every query assumes `gooddrops_celo`. If yours differs, find-and-replace.
- **Proxy:** events log at the proxy `0x2615…5131`; decode that address (not the implementation).
- **Coordinates:** if you ever want them, `lat/1e6` and `lng/1e6` give degrees.
- **Refresh:** set each query's schedule (or the dashboard's) to refresh (e.g. hourly).
- **Fallback (no decoding):** you can query raw `celo.logs` filtered by
  `contract_address = 0x261565422E8ec1340F84d3AdadBF4aD5Fc7D5131` and a specific
  `topic0`, decoding fields with `bytearray_*` functions — but decoded tables are
  far simpler, so prefer Step 1.

---

## ✅ LIVE BUILD (2026-07-24)

**Dashboard:** https://dune.com/gooddrops7927/gooddrops-analytics

| Query | ID | Link |
|---|---|---|
| Overview KPIs (9 metrics + time-to-claim) | 8098650 | https://dune.com/queries/8098650 |
| Daily activity — created vs claimed | 8098659 | https://dune.com/queries/8098659 |
| Cumulative G$ claimed | 8098660 | https://dune.com/queries/8098660 |
| Top droppers | 8098663 | https://dune.com/queries/8098663 |
| Top hunters | 8098664 | https://dune.com/queries/8098664 |
| Drop outcomes (pie) | 8098670 | https://dune.com/queries/8098670 |
| Drop size distribution | 8098671 | https://dune.com/queries/8098671 |
| New hunters over time | 8098673 | https://dune.com/queries/8098673 |
| Transactions & Users KPIs (7 counters) | 8098677 | https://dune.com/queries/8098677 |
| Daily active users (30d) | 8098678 | https://dune.com/queries/8098678 |
| Weekly retention | 8098680 | https://dune.com/queries/8098680 |

Note: actual decoded tables are ALL-lowercase — `gooddrops_celo.gooddrops_evt_dropcreated`
(not `GoodDrops_evt_…`). Queries above use the correct names.

**Brand colors:** Dune's API doesn't expose per-series hex control, so charts use
Dune's defaults for now. To brand them: open a chart → Edit → click each series
color swatch → paste: hero `#BFFD00` (single-series/counters), multi-series
`#72A300` (created/lime) · `#5B7FE6` (claimed/blue) · `#E05C5C` (reclaimed/red)
· `#2FA98C` (teal). ~2 min for all charts.
