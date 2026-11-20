# Winz engine

The engine is the one process that talks to Gemini and the only sender of on-chain transactions.
The web app never does either: it writes rows and enqueues jobs, and the engine does the work.

## What runs

`src/index.ts` reads the environment, builds the production parts and calls `startEngine`
(`src/app.ts`), which starts these services in this order and stops them through one signal:

| Service       | What it does                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `tx-sender`   | The outbox `chain_txs`: nonces, fees, broadcast, receipts. One queue per key (relayer, oracle), see below. |
| `book-feed`   | Order books of the instruments in use: Gemini WebSocket, REST as fallback, or a book driven by demo mode.  |
| `chain-ingest`| Reads the escrow's events and projects them into tickets, lots and exposure.                               |
| `hedging`     | One policy runner per instrument: orders, fills, allocation to sales, `chargeHedge`, the Hedge desk rows.  |
| `sale-states` | Decides every second whether each campaign can sell, and why not.                                          |
| `settlement`  | Once a game is decided: final hedge charges, `settle`, refunds in batches of 50, payout, release.          |
| `jobs`        | The work the web app enqueues: create a campaign, sell a ticket, pause, close sales, top up a budget.      |
| `catalog-sync`| Gemini's catalogue of games (one listing per league) and their results, every minute: see below.           |

The budget top-up job (`campaign.top_up`, one per paid top-up) sends
`topUpBudgetFor` (key `topUpBudget:<payment id>`, a barrier) and projects its `BudgetToppedUp`,
or, when the campaign can no longer take it, refunds the merchant's card once: never both.

Before the first of them starts, `startEngine` runs two start checks (the escrow's roles, the
database's chain and escrow) and refuses to start on either: see
[Start-up checks](#start-up-checks).

Every service resumes from the database and the chain after a restart: a transaction signed
before a crash is re-broadcast as it was, never signed twice. Only **one engine works on a
database at a time**: a second engine process waits as a standby and takes over when the first
stops (see [One engine per database: the lease](#one-engine-per-database-the-lease)).

## Run it

```bash
pnpm --filter @winz/engine dev
```

`dev` loads the `.env` at the repository root when it exists. `start` loads nothing: in production
the platform provides the variables. `.env.example` lists every variable; the engine refuses to
start, naming each problem, when one is missing or malformed.

| Variable                                              | Needed    | Notes                                                                                 |
| ----------------------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| `DB_URL`                                              | yes       | Postgres. Works through Supabase's transaction pooler. TLS is required for any host that is not local (`sslmode=require`: encrypted, certificate not verified); `sslmode=` in the URL overrides it. |
| `APP_ADMIN_DEMO_KEY`                                  | yes       | At least 16 characters. Same value as the web app.                                    |
| `ARC_RPC_URL`, `ARC_ESCROW_ADDRESS`, `ARC_ESCROW_DEPLOY_BLOCK` | yes | See `docs/arc-testnet.md` and `packages/contracts/deployments/`.                   |
| `ARC_RELAYER_PRIVATE_KEY`, `ARC_ORACLE_PRIVATE_KEY`   | yes       | Two different keys. Testnet only. Never logged.                                       |
| `STRIPE_SECRET_KEY`                                   | no        | Test keys only (`sk_test_`). Without it only demo sales can be sold.                  |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`        | together  | Buyers' embedded wallets. Without them `APP_DEMO_WALLET_SEED` is required.            |
| `APP_DEMO_WALLET_SEED`                                | see above | 32-byte hex secret from which demo wallets are derived.                               |
| `APP_EXECUTION_VENUE`                                 | no        | `paper` (default): fills simulated against the live Gemini book.                      |
| `APP_VENUE_CHECK_ON_BOOT`                             | no        | `true`: the real-order proof on the Gemini sandbox once at boot (see below).          |
| `GEMINI_SANDBOX_API_KEY`, `GEMINI_SANDBOX_API_SECRET` | see below | The sandbox key (Trader role). Required with `APP_EXECUTION_VENUE=gemini-sandbox`.   |
| `GEMINI_SANDBOX_NONCE_MODE`                           | no        | `incremental` (default, epoch ms) or `time` (epoch s), as the key was created.        |
| `APP_VENUE_CHECK_ACCEPT_TERMS`, `GEMINI_SANDBOX_CHECK_SYMBOL` | no | Let the check accept the Prediction Markets terms; impose its contract.          |
| `DB_POOL_MAX`                                         | no        | Default 20.                                                                           |
| `ARC_RPC_MAX_REQUESTS_PER_SECOND`                     | no        | Requests the engine starts in any one second, every method counted. Default 10.       |
| `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND`               | no        | Of those, requests of the heavy methods. Default 4.                                   |
| `ARC_RPC_HEAVY_METHODS`                               | no        | Comma-separated JSON-RPC methods counted as heavy. Default `eth_getLogs`.             |
| `ARC_TX_MAX_IN_FLIGHT`                                | no        | Transactions of one key broadcast and not mined yet at once. 1 to 64, default 8.      |
| `PORT`                                                | no        | Port of the health listener (`GET /healthz`). Unset: no listener. Render sets it.     |
| `ENGINE_LEASE_TTL_MS`                                 | no        | How long a renewal holds the engine lease. 10 000 to 300 000, default 15 000.         |
| `ENGINE_LEASE_RENEW_MS`                               | no        | Renewal interval of the leader. At most (ttl - 5 000) / 3. Default 3 000.             |
| `ENGINE_LEASE_STANDBY_POLL_MS`                        | no        | How often a standby asks for the lease. 100 to the ttl, default 1 000.                |

Every request the engine makes to its node goes through one limiter shared by all its services:
the limits above, kept under what Arc's public RPC accepts (it refuses the 13th `eth_getLogs`
within 1.4 s). When the node still answers "rate limited", every request waits a cool-down
(1 s, doubled while it lasts, at most 16 s, one warning each) and the refused one is sent
again. On a first start far behind the head, the event reader catches up in ranges of 2 000
blocks, four a second: 60 000 blocks take about 30 requests and 8 s. On shutdown, requests
still waiting for their turn after 9 s are released unsent, so the engine stops within its
15 s grace period.

## Gemini catalogue and results

**One listing per league.** Gemini's events listing stops at about 1 000 events whatever the
filter (`LISTING_CAP`): on 19 Nov 2026 the single Sports listing the engine read reported 1003,
sorted by start time, and held 193 games, without Saturday's Arkansas at Texas. The catalogue is
now the union of one listing per league, `sport=<sport>&search=<league>`, each far under the cap.
The leagues, each with its reason, are the list `CATALOG_LEAGUES`
(`src/market-data/catalog-leagues.ts`): NCAAF, NFL, NCAAM, NBA, NHL, UCL, EPL, MLS, LALIGA,
LIGAMX, MLB. Pages of 100 overlap by 10, and each page must contain one of the previous page's last
tickers, so an event that slid between two requests is noticed rather than skipped.

**When a league's read is complete.** Only when nothing can have been skipped
(`readActiveListing`). An empty page proves the end only as the first page (offset 0: the league
lists nothing, as MLB today). Every later page is asked 10 events before the end of the previous
one, which ended before the total it reported, so an unchanged listing gives it at least 11
events: an empty one means more than the overlap left the listing between two requests (one
finished game removes 10 to 15 events, and on Saturday many end together), and events not read
yet may have slid into positions already read. Such a read is not complete, whatever the total now
says; nor is one whose page does not contain one of the previous page's last 10 tickers. A
listing that ends on a page boundary never asks an empty page, so the ordinary case stays quiet.
Not complete only means none of that league's games is deactivated this run (logged at WARN); the
read is not repeated at once, which would download the league again (about 50 MB for NCAAF), and
the next run, a minute later, reads it again.

- A league whose listing reaches the cap is logged at ERROR with its name (`gemini league listing
  at the cap`); a league whose read fails, too. Neither counts as read.
- Each sport's own listing total is compared with the sum of its leagues' (one `limit=1` request
  per sport); a sport with more events is logged at WARN: a league is missing from the list.
- **A game is deactivated only by a complete read of its own league that no longer lists it**
  (`events.league`). A league cut at the cap, failed or not read keeps its games as they are; an
  empty catalogue deactivates nothing.
- So a league that is not (or no longer) in `CATALOG_LEAGUES` is never deactivated: its
  instruments stay active until they settle. Rows left by an older catalogue (the single Sports
  listing stored games of every league, tennis and WNBA included) are listed by
  `select e.league, count(*) from instruments i join events e on e.ticker = i.event_ticker where
  i.active and e.league not in ('NCAAF', 'NFL', 'NCAAM', 'NBA', 'NHL', 'UCL', 'EPL', 'MLS',
  'LALIGA', 'LIGAMX', 'MLB') group by 1`; once checked, deactivate the ones no campaign uses:

  ```sql
  update instruments i set active = false
  from events e
  where e.ticker = i.event_ticker
    and i.active
    and e.league not in ('NCAAF', 'NFL', 'NCAAM', 'NBA', 'NHL', 'UCL', 'EPL', 'MLS',
                         'LALIGA', 'LIGAMX', 'MLB')
    and not exists (select 1 from campaigns c where c.instrument = i.symbol);
  ```

  Removing a league from the list has the same effect on its games: run the same statement then.

Measured against api.gemini.com on 19 Nov 2026 with the engine's own loader:

| | Requests | Duration | Games | Instruments | Saturday's game |
| --- | --- | --- | --- | --- | --- |
| Before (07:24 UTC, one Sports listing) | 21 | 5.7 s | 193 (8 NCAAF) | 1 683 | absent |
| After (07:23 UTC, 11 leagues + 5 sports) | 26 | 21 s | 298 (65 NCAAF) | 5 280 | present, Texas 0.91 / 0.92 |
| Before again (12:32 UTC) | 21 | 10.9 s | 187 (6 NCAAF) | 1 344 | absent |
| After again (12:31 UTC, NCAAF 673 events) | 27 | 43 s | 298 (65 NCAAF) | 5 283 | present, Texas 0.91 / 0.92 |

**What a run costs.** The duration is the download: a page of 100 NCAAF events is about 7 MB
(7 042 796 bytes at 14:07 UTC: 2.4 s, 1.5 s to the first byte; 5.4 s at 12:33 UTC), and one
catalogue is about 1 400 events. One catalogue load with the engine's own loader, measured with
the process's own counters:

| When (19 Nov 2026, UTC) | Duration | CPU (user + system) | Peak resident memory | Longest event-loop block |
| --- | --- | --- | --- | --- |
| 14:00, listing timeout 10 s (first run) | 30.9 s | 2.8 s | 190 MB | 102 ms |
| 14:22, listing timeout 30 s (stdout only, not kept) | 24.3 s | 2.6 + 0.3 s | 206 MB | 105 ms |
| 15:03, listing timeout 30 s, the stop passed down (output kept) | 81.1 s | 4.2 + 0.6 s | 214 MB | 393 ms |

The 15:03 load read the 11 leagues complete (298 games, 5 283 instruments, 27 requests), but two
first NCAAF and NFL pages were cut mid-body (`terminated: other side closed`) and downloaded
again: a link that cuts a 7 MB page costs the whole page again, and a run can then last longer
than its 60 s period. These loads went through an HTTPS proxy, not from the deployed host.

The timeout is per attempt and covers the whole body: 30 s for a listing request (the events of
a league, the settled list: `LISTING_TIMEOUT_MS`), which accepts a link about five times slower
than the slowest page measured before the page is given up and downloaded again; 10 s, as before,
for the small ones (an order book, one game's own page: `REQUEST_TIMEOUT_MS`). A failed attempt
is retried up to four in all; a league whose page still fails contributes nothing that run.

A run (catalogue, results, direct reads) fits its 60 s period, but not by much on a slow link;
when one takes longer, the next starts as soon as it ends and `catalogue sync run took longer than
its interval` is logged. Runs never overlap (the next starts when the last ends).

**A stop does not wait for a download.** The stop (SIGTERM at a deploy, or the lease lost) is
passed to the request in flight: its download is aborted at once, a retry wait or a rate-limiter
wait is abandoned, and nothing more is asked. The aborted request is neither retried nor logged
as a failure (`SyncAbortedError`): a catalogue stopped part-way is not written (`catalogue sync
stopped part-way by the stop: nothing written`), results read so far are. What is left of the run
after a stop is that database write; the tests stop a run 20 ms into a page download held open
for its 30 s timeout and see it end within the second. A stop during the per-sport coverage
check (after every league is read) ends the run the same way: nothing written, nothing logged
above INFO. Each attempt links the stop to its own timeout by hand and unlinks it when the
attempt ends: `AbortSignal.any([timeout, stop])` kept every attempt's signal referenced by the
stop, which lives as long as the leadership (Node 22.23.4, 60 000 requests to a local server,
heap after GC: 32.6 to 45.7 MB, about 0.9 MB per 5 000 requests; by hand: flat at 25.8 MB).

**The seed's demo game.** `supabase/seed.sql` seeds `NCAAF-2611212030-ARK-TEX-M` with
`…-M-TEX`, `…-M-ARK`, `…-S-TEX13` and `…-S-TEX20`: the four are real Gemini tickers of
Saturday's game (checked 19 Nov 2026). Before this change the first sync set all four inactive,
the cut listing not holding them; now the complete NCAAF read lists them and keeps them active,
the moneylines with their quotes (the two spreads had no quote at 07:23 UTC).

**Results are never missed.** Each run reads the recently-settled list (newest first, sorted by
`resolvedAt`) page after page until it has read a result resolved before the start of the last
complete run minus 10 minutes, the end of the list, or 20 pages (1 000 results). The first run of
a service reads the whole list (Gemini keeps about a day of it: 280 results on 19 Nov 2026), so a
deploy, a sleep or a lost lease is caught up by the next leader. A failed read is logged, records
what it read, and leaves the span to the next run. Then, for each game a campaign past its sales
close still waits on (no outcome, no forced demo result), the run asks that game's own page
(`GET /v1/prediction-markets/events/{ticker}`, which carries its spreads and totals): at most 5
games a run, the least recently asked first, none when the settled list could not be read. Only a
contract's `resolutionSide` and Gemini's documented `invalid` status (all void) are results; a game
over in any other way is logged at WARN with its symbols. A result is applied once whichever path
brings it, and a game whose result contradicts a recorded one is logged at ERROR and left out
without holding back the others.

## Start-up checks

Each a configuration error that stops the start, as a wrong chain id already did. `startEngine`
runs them before any service; `src/index.ts` runs them read-only at boot too, so a standby with
the wrong configuration exits at once instead of failing at a failover. Messages name addresses
and chain ids, never a key.

- **The escrow's roles** (`src/chain/escrow-roles.ts`): the node serves `ARC_CHAIN_ID`,
  `ARC_ESCROW_ADDRESS` holds code there, and the escrow's `relayer()` and `oracle()` are the
  addresses of `ARC_RELAYER_PRIVATE_KEY` and `ARC_ORACLE_PRIVATE_KEY`. `EscrowRolesMismatchError`
  names the escrow's address and the configured one for each role, and says when the two keys are
  swapped; `EscrowNotFoundError`: no code at the address on that chain; `EscrowRolesUnreadableError`:
  the contract there is not a WinzEscrow. At boot, a node that does not answer is only a warning.
- **The database's chain and escrow** (`src/chain/engine-identity.ts`, table `engine_identity`,
  migration `20261119020000_engine_identity.sql`): the first engine on a database records its
  chain id and escrow address, in one statement the database decides (of two engines starting
  together, one records, the other compares); every later start compares.
  `EngineIdentityMismatchError` names the recorded pair and the configured one: use the database
  of that chain and escrow, or start from an empty one. A database from before the table that
  already holds `chain_txs` or an event reader cursor of another chain or escrow is refused too
  (`EngineIdentityForeignHistoryError`) instead of being recorded.

The event reader's node: when `ARC_RPC_URL` does not serve an `eth_getLogs` (QuickNode's Free plan
limits it to 5 blocks) and viem's fallback sends it to `ARC_RPC_FALLBACK_URL`, the `rpc` logger
warns `ARC_RPC_URL did not serve eth_getLogs`, with the host of each node (never the URL's path),
once and then at most every 10 minutes with the count since.

## Deploy

The engine runs as one Docker web service on Render: `apps/engine/Dockerfile`, built from the
repository root (Root Directory empty, Docker Build Context Directory `.`), health check path
`/healthz`. Its settings are made in Render's dashboard; there is no `render.yaml` (the page below
says why). The step-by-step page, with the command that proves each step, is
[`docs/deploy.md`](../../docs/deploy.md) (in French).

- **No build step.** The image runs the TypeScript sources: `node --import tsx src/index.ts`, in
  exec form, so node is PID 1 and receives SIGTERM itself (no shell, no package manager in
  between; the tsx CLI would fork a child). The stop below runs and the process exits 0.
- **Install.** `pnpm install --frozen-lockfile --filter "@winz/engine..." --filter "winz"`: the
  engine, `@winz/shared`, `@winz/pricing`, and the root package, because `tsx` is declared there.
  That brings the root's dev tools along (TypeScript, Turbo, Vitest, ESLint): `node_modules` is
  about 360 MB, the image about 800 MB unpacked, 170 MB compressed. Declaring `tsx` in this
  package's own dependencies would allow `--prod` and drop most of it.
- **User.** The image's `node` user (uid 1000), never root.
- **Health.** With `PORT` set, `src/health/server.ts` answers `GET /healthz` (node:http, no
  dependency): `{ status, role, startedAt, uptimeS, chain: { id, head, cursor }, db, sender, jobs,
  lease: { holder, heldForS, renewedAgoMs }, loops, staleLoops }`. A leader (`role: "leader"`)
  answers 200 when the database (the event reader's `chain_cursor` row, read within 2 s) and the
  node (`eth_blockNumber`, within 2 s) both answer, the sender and the job worker run, and every
  loop of the engine has completed a pass within its bound (see
  [Frozen loops](#frozen-loops-healthz-and-the-database-bounds)); 503 otherwise, including while
  the engine starts or stops. A standby (`role: "standby"`, `sender`
  and `jobs` `"stopped"`) answers 200 when the database and the node answer AND its latest ask
  for the lease was answered, no more than a ttl ago: that is what lets a redeploy hand over
  (below). A standby whose asks fail (the `engine_lease` table missing because the engine was
  deployed before its migration, no rights on it, or the asks hanging) answers 503: it could never
  take over, and a 200 would let the platform stop the engine that works and leave none. The log
  line `health check failed` names each failed condition (`problems`); the body does not. `lease` says, for a leader, its own holder id, how long it has held
  the lease and how long ago it last renewed it; for a standby, the holder it saw last (null when
  the lease is free) and the same two durations. A holder id is a random `eng-` and 12 hex
  characters drawn at the process's start: it names a process, it opens nothing. The URL is
  public: one probe (one query, one `eth_blockNumber`) serves every request that arrives while it
  runs, and its answer serves every request for 2 s. Only that I/O is cached: the role, the
  services and the lease are read from the process on every request, so a leader that begins to
  stop or fences itself answers 503 at once. It never answers a secret, a key's address or
  an e-mail. The listener opens as soon as the database answers (a standby has it too) and closes
  after every service has stopped and the lease is released, before the database pool. It
  listens on every interface (`server.listen(PORT)` with no host: `0.0.0.0`, or `::` which takes
  IPv4 too), which is what Render asks of a web service. Without `PORT`, nothing listens (local
  runs and tests are unchanged).
- **One instance.** Render runs one instance of a service unless it is scaled (a Free instance
  cannot be). A second one would now be harmless (it waits as a standby and runs no service) but
  would only cost an instance: see the lease below and [`docs/deploy.md`](../../docs/deploy.md),
  section 2.

```bash
docker build -f apps/engine/Dockerfile -t winz-engine .
docker run --rm --env-file engine.env -e PORT=8080 -p 8080:8080 winz-engine
curl -s localhost:8080/healthz
```

### Frozen loops, `/healthz` and the database bounds

**What happened (19-20 November 2026).** The instance started at 22:51:54 UTC kept hedging and
running jobs, and its `/healthz` answered 200, but its sale states stopped moving: their last
write was at 23:23:45, and promo 15 (sales close 23:55) and promos 16 to 19 (00:55) stayed `live`
until a redeploy at 01:02:49 closed all five in its first pass. Nothing was sold late (the web's
checkout refuses a sale after the sales close on its own), but a frozen sale-state loop also means
no automatic pause: no breaker pause, no budget pause, no price pause.

**Why it could freeze.** A sale-state pass awaits nothing but the database: one read
(`loadCampaignSaleRows`, `src/sales/store.ts`) and one short transaction per campaign whose state
changes (`writeSaleState`). Passes never overlap, so one call that never settles freezes every
sale state. The statement timeout those transactions set (5 s, server side) only ends a statement
the server is running; Postgres.js 4.1.1 has no client bound by default (`query_timeout` and
`queue_timeout` 0), so a query sent on a connection that goes silent (a pooler that stops answering
on one connection, a path that drops packets without a reset) waited for as long as TCP takes to
notice, and for good when the peer kept acknowledging at the TCP level, while the pool's other
connections served the rest of the engine. The pass's watchdog only logged it (`sale state pass is
overrunning`). Render's logs of that instance are gone, so which call hung is not known; the tests
below reproduce both shapes (a silent connection, a promise that never settles) and show the code
of the incident waiting forever on each (`src/sales/service.freeze.test.ts`).

**What bounds it now.**

| Bound | Value | Where | Why this value |
| --- | --- | --- | --- |
| One sale-state pass | 15 s (`DEFAULT_PASS_TIMEOUT_MS`) | `startSaleStates` | A pass is milliseconds; three statements at their 5 s cap make 15 s. Past it the pass is ended: its database call is cancelled through an `AbortSignal`, it writes and remembers nothing more, `sale state pass timed out` is logged at error level with what it was waiting on (`waitingOn`: the read, or the write of one campaign), and the next pass runs 2 s later. A stop ends the pass in flight too. |
| One query, `begin` and `commit` included | 30 s (`query_timeout`) | `createDb`, every pool of the engine | The longest legitimate statement is seconds (DB-only transactions, catalogue upserts by 1 000 rows); 30 s is six times the sale states' own server-side cap. The client asks the server to cancel and rejects with `QUERY_TIMEOUT`. |
| Waiting for a connection | 30 s (`queue_timeout`) | `createDb` | The job worker keeps connections free by construction; a longer wait is a pool held by stuck work. Rejected unsent (`QUEUE_TIMEOUT`), so retrying is safe. |
| An unanswered cancel | 5 s (`cancel_timeout`) | `createDb` | The connection is then closed and the pool opens another: what gets rid of a silent connection (30 + 5 s). |
| An idle connection | 120 s (`idle_timeout`) | `createDb` | Not reused after sitting long enough for a NAT or the pooler to have dropped it silently. |
| Sale-state statements, server side | 5 s (`statement_timeout`, `lock_timeout`, per transaction) | `src/sales/store.ts` | Unchanged: ends a statement the server runs or a lock it waits for. |

Every loop also guards its own iteration: an exception or a rejected promise costs one pass,
logged, and the loop goes on. A service whose `stopped` settles while the engine runs has stopped
by itself: `a service stopped by itself while the engine runs` is logged at error level and its
loops are reported `stopped` at once.

No server-side `statement_timeout` is set for the whole pool: the engine reaches Supabase through
its session pooler, and a startup parameter the pooler does not accept would stop the engine from
connecting at all, which was not tried against the hosted pooler. A server-side bound for every statement of
the engine belongs on its database role (`alter role … set statement_timeout`), a migration.

**What `/healthz` says about the loops.** Each long-running loop tells `src/health/loops.ts` when
it completes a pass (a pass that fails does not count: a loop that keeps failing does no work).
`loops` lists them by name, each with `state` (`running`, `stale`, `stopped`), `sinceS` (seconds
since its last completed pass, or since it started) and `boundS`; `staleLoops` names those that
are not `running`. A leader with any of them answers **503**, and the log says
`health check failed: a loop of the engine no longer completes its passes` at error level. Every
loop gets its whole bound to complete its first pass (no 503 during start-up), and a standby runs
no loop and reports none.

| Loop | Bound | Its pace, and why the bound |
| --- | --- | --- |
| `sale-states` | 60 s | A pass every second, ended after 15 s; retries 2, 4, 8 s: 60 s is three stuck passes in a row. |
| `jobs` | 120 s | The worker polls every 0.5 s; a poll is two queries, each ended within 35 s. |
| `settlement` | 15 min | A pass every 15 s, but backs off up to 10 min after failures in a row. |
| `chain-logs` | 5 min | Every 5 s, backoff up to 30 s, rate-limit pauses up to 30 s; beats for every range stored. |
| `chain-projector` | 3 min | Every 1 s, backoff up to 30 s; beats for every batch. |
| `hedging-exposure`, `hedging-tick`, `hedging-charge` | 3 min | Every 1 s or 2 s, backoff up to 30 s. |
| `feed-refresh` | 120 s | The book feed reads the instruments to follow every 3 s. (Books themselves are watched by the sale states: a book older than 10 s pauses its sales.) |

```text
HTTP/1.1 503
{"status":"unavailable","role":"leader",…,"db":"ok","sender":"running","jobs":"running",…,
 "loops":{"chain-logs":{"state":"running","sinceS":2,"boundS":300},…,
          "sale-states":{"state":"stale","sinceS":61,"boundS":60},…},
 "staleLoops":["sale-states"]}
```

**What the operator sets and sees.**

- **Render: Settings → Health Check Path = `/healthz`** (the service's settings, "Health Checks").
  Render checks it every few seconds; an instance that fails for 60 s is restarted, which is the
  last resort for a loop the bounds above could not unfreeze: the new process starts as a standby,
  takes the lease and starts fresh loops on fresh connections. Without the path, Render only
  checks that the port accepts a TCP connection and never sees a frozen loop.
- **UptimeRobot.** A 503 for a stale loop still carries `"db":"ok"`: a keyword monitor looking
  for the bare word `ok` would call it up (unless it also fails on the status code, which was not
  checked here). The keyword that only a healthy answer carries is **`"status":"ok"`** (quotes
  included); `/healthz` keeps the letters `ok` out of every loop name and state for that reason.
- **The logs**, in the order an operator meets them: `sale state pass is overrunning` (10 s,
  error), then `sale state pass timed out` with `waitingOn` (15 s, error), then
  `sale states recovered` once a pass completes. If they keep timing out, `health check failed: a
  loop of the engine no longer completes its passes` with `staleLoops`, and after 60 s of that a
  restart in Render's **Events** page.

## One engine per database: the lease

Every engine process holds the transaction sender's keys, a job worker, a hedger per instrument,
the hedge charger and the settlement watcher, and several of them are serialised only inside one
process (the charger's lock, each hedging runner's working orders). So only one process works on
a database at a time. A Render deploy starts the new instance, switches traffic to it once it
passes its health check, and sends SIGTERM to the old one 60 s later: without this, both ran
every service for that window.

**The lease** is one row of `engine_lease` (migration `20261119000000_engine_lease.sql`): the
holder (a random id drawn at the process's start), when it was acquired, last renewed, when it
expires, and when it was released. `src/leader/lease.ts` reads and writes it with single
statements, each its own transaction, so it works through Supabase's transaction pooler (no
advisory lock, no LISTEN), and every decision is taken on the database's clock
(`clock_timestamp()`), never on a process's:

- **acquire** succeeds when the row is absent, expired, released, or already this holder's, in
  one statement: two engines racing cannot both win (`lease.test.ts` races 24 holders, round after
  round, and shows that a read-then-write version of the same lease lets several win);
- **renew**, every `ENGINE_LEASE_RENEW_MS`, only while the row is this holder's, not released and
  not expired, extends the expiry to now + `ENGINE_LEASE_TTL_MS`; the answer says whether this
  holder still has it, and otherwise who has;
- **release**, at stop, gives this holder's lease up at once, so a standby takes over at its next
  look instead of waiting for the expiry.

**Standby.** `src/index.ts` validates its settings, checks that the database answers, opens the
health listener and becomes a standby (`src/leader/leader.ts`): it starts none of the services of
`startEngine` (no sender, no job worker, no hedging, no settlement, no readers) and asks for the
lease at once, then every `ENGINE_LEASE_STANDBY_POLL_MS`. When it gets it, it calls `startEngine`
exactly as before and renews the lease from then on. On SIGTERM a leader stops as before, keeps
renewing while its services stop, then releases the lease; a standby stops at once.

**Self-fencing.** When a renewal fails (the database unreachable, a timeout, or an answer that
the lease is no longer this holder's live lease) the leader keeps trying, every renewal interval.
Once it has not renewed for `ttl - 5 s` (10 s with the defaults), counted on its own monotonic
clock from the moment it SENT its last successful renewal (the database stamped it later, so the
lease on the database's clock always ends after that point), it stops its services with the
engine's normal stop, logs an error saying why, and goes back to standby, where it may take the
lease again. If a renewal answers that ANOTHER holder has the lease, which must never happen, it
stops its services at once and logs both holders' ids at error level. If a renewal answers that
this holder's own lease is already free on the database (expired at the statement's time,
released, or the row deleted by hand), it stops at once too, without waiting for its fence
deadline: no later renewal can succeed, and a standby may take the lease at its next look. A late
answer to an older renewal cannot trigger it once a newer renewal has succeeded.

**The 5 s margin** is the time the normal stop has before the lease can expire. Measured:

| What stopped                                                                       | Stop time      |
| ---------------------------------------------------------------------------------- | -------------- |
| Every service of `startEngine` on a local chain, a purchase in flight (e2e test)   | 3 to 70 ms     |
| The same, fenced (renewals failing, or the database refusing connections)          | 0 to 31 ms     |
| The real process (`node --import tsx src/index.ts`), SIGTERM to `engine stopped`   | 0.5 to 3.1 s   |

The real process's stop was dominated by the Gemini catalogue sync, whose request in flight was not
aborted then (10 s timeout per attempt); in that test Gemini points at a closed port. (Measured
before the sync read one listing per league; the stop now aborts the request in flight, see
[Gemini catalogue and results](#gemini-catalogue-and-results); not measured again.) A stop can
outlast the margin: a job handler that ignores its abort keeps the job worker up to its 10 s
grace, and a service waiting on a database that has gone silent (it accepts connections and
answers nothing) waits for an answer that never comes (`leader.e2e.test.ts` shows it).
So a fenced stop still running 1 s before the lease can expire (`ttl - min(1 s, margin / 4)`
after the last renewal) is declared stuck: the leader logs it at fatal level and `src/index.ts`
ends the process with exit code 1, before another engine can take the lease, and the restarted
process comes back as a standby. Render's documentation does not give a restart delay for a
process that exits: it records an `Instance Failed` event with the exit code, and it restarts an
instance whose health checks have failed for 60 s, as they do once the process has exited; it
suspends a service that keeps failing to start and become healthy over 24 hours.

**A frozen process cannot fence itself.** A process paused longer than the ttl (a frozen VM, a
debugger, a stop-the-world pause) runs no timer: meanwhile its lease expires and a standby takes
over. When it resumes, its fence deadline has long passed, so the first timer turn stops its
services; but whatever each service was doing when it froze finishes first, beside the new
leader. What still protects each money path then:

- **Transactions.** A row of `chain_txs` goes `queued` to `sent` under `where status = 'queued'`
  (one sender only sends it), its signed bytes are stored before they are broadcast (sending them
  again is the same transaction, same hash), and the unique `(signer_address, chain_id, nonce)`
  index refuses a second transaction on a nonce: no transaction is signed twice, no nonce is used
  by two. The two senders can still trip each other (one fails its preparation and retries).
- **Jobs.** A job is claimed `for update skip locked` and owned by its worker (`locked_by`); it
  is given to another worker only after `visibilityTimeoutMs` (30 s) without a refresh of its
  lock. Every handler runs under a transaction-scoped advisory lock on its subject
  (`withExclusiveLock`: one purchase, one campaign), so a second run of the same job waits for the
  first; and their transactions carry idempotency keys (`buyFor:<payment>:<attempt>`), the Stripe
  capture `capture:<payment>`, the job rows their own keys: a purchase is never bought or captured
  twice.
- **Hedge charges.** The charger's lock is in-process only. Two chargers that build the same
  batch build the same idempotency key (a hash of its lots), which the outbox keeps once; two
  different batches holding one ticket are refused by the escrow (`HedgeAlreadyCharged`: in
  simulation, no gas; if both are in flight, the second reverts and costs its gas). No ticket is
  charged twice.
- **Hedge allocation.** Fills are allocated to lots under a per-instrument advisory lock with the
  lots locked (`for update`): no lot is covered twice.
- **Settlement.** Its steps derive their idempotency keys from the outbox's history (two passes
  compute the same key), and the escrow refuses a second `settle` and a second refund of a ticket.
- **Not protected: hedge orders.** Each hedging runner sizes its orders from its own memory of
  what it has working. Two runners on one instrument can each place an order for the same
  exposure: on the paper venue a simulated over-hedge, on `gemini-sandbox` real sandbox orders
  (fills beyond the exposure stay held, unallocated, and the desk shows them). The same holds for
  any order a frozen leader's runner had already decided on when it froze.

**What the lease does not wrap.** `startEngine` is unchanged and takes no lease: the lease wraps
the process (`src/index.ts` and `src/leader`). An engine started directly, by a test, the e2e
harness (`apps/web/e2e/support/world.ts`) or the rehearsal runner, takes no lease. Tests and the
e2e harness are safe because each creates its own fresh test database, where no other engine
runs. The rehearsal is safe only as it is meant to be run: its CLI takes the database from
`--db-url` or `DB_URL` (`apps/web/e2e/rehearsal/cli.ts`) and nothing stops it from being pointed at
a database where a deployed engine works. There it would run a second engine beside the lease's
holder, without asking for the lease: two senders on the same keys, two hedgers. Never point the
rehearsal at the deployed database (the "never" list of `docs/deploy.md` says so too).

**Rolling this change out.** The migration comes first: apply `20261119000000_engine_lease.sql`
(`pnpm db:migrate`) and check that `select 1 from engine_lease` runs on the deployed database
before the engine with the lease is deployed. An engine deployed before it is a standby whose
asks fail: its `/healthz` answers 503, so the platform keeps the old engine and fails the deploy.
The engine running before this change takes no lease: the first deploy of this change still runs
both for the start-up window, as every redeploy did before. From the next deploy on, the old
container holds the lease and hands over.

**Tests.** `src/leader/lease.test.ts` (the statements on Postgres: races of 24 holders with a
read-then-write positive control, and a seeded property over acquisitions, renewals, releases
and expiries, checked against a model that reads only the database's times);
`leader.property.test.ts` (a seeded property over three leaders, each with its own injected
process clock stepped forward and held still, mixed with database waits, cuts, stalls, clean
stops and replacements: never two engines working, and every stop of services before the expiry
of the lease the database had granted, on the database's clock; a held clock past the margin is
the positive control, and a fence without margin fails every seed); `leader.test.ts` (the leader
with services that only record when they run: standby, handover, crash, a stalled connection, a
late renewal answer counted from its sending, a stolen lease, its own lease found expired or
deleted, no stop listener left behind, a standby whose asks fail, a failed start);
`leader.e2e.test.ts` (two real `startEngine` compositions on one database and one local chain:
a handover with a purchase in flight, a crash, the database cut both ways, a stolen lease, a
redeploy with both health listeners, and the handover and the redeploy run without the lease,
where the same service log shows two engines working: that control shows the overlap of the
two engines' services, not a duplicated effect; which effects two engines can duplicate is the
list above); `process.test.ts` (the real process
spawned twice: alone, then a redeploy, SIGTERM, exit codes, the stop logged in order, the lease
row released, the port free).

## Transaction sender

Every transaction of the engine goes through `src/chain/tx-sender.ts`, one queue per key. It
used to send one transaction per key at a time: simulate, estimate gas and fees, sign, store,
broadcast, wait for the receipt, then the next. On Arc testnet (a block every 0.46 s) one such
cycle took 1.0 to 2.2 s. The rehearsal of 18 November (`docs/rehearsals/20261118T090924Z-5042002-yes.md`)
showed what that costs: its three refund batches, enqueued together, went out one after the
other and the last one was mined 10 blocks (5 s) after `settle`; the six batches of 300 tickets
(criterion 6: refunded within 10 s of `settle`) would have taken about 10 s. With three buyers
at once a sale was ticketed in 3.5 s (median) instead of 1.9 s, and in 4.4 s over a run of 140
sales: every `buyFor` waited for the relayer's previous transaction to be mined.

Now a key's independent transactions travel together. Up to `ARC_TX_MAX_IN_FLIGHT` of them are
broadcast and not mined yet at the same time, with consecutive nonces given in the outbox's order
(oldest first), the order the one-at-a-time sender used. What travels together is declared in one
place, `src/chain/tx-kinds.ts`, with the reason it is safe:

- `buyFor`: a ticket of a live campaign. The engine checks the budget and the sale state before
  every quote, and a purchase that reverts on-chain (two purchases together over the budget) ends
  the payment exactly as a purchase refused in simulation does.
- `chargeHedge`: tickets already mined, never the same ticket in two charges in flight. Once the
  hedge finalizer has failed, the settlement's safety net first waits (up to its transaction wait)
  for every `chargeHedge` still queued or sent that holds one of the campaign's uncharged tickets,
  the hedging lane's included, then reads the tickets again: a ticket the lane charged meanwhile
  is left out instead of being charged a second time, which with a window passes its simulation
  and reverts on-chain with `HedgeAlreadyCharged`, gas paid. The lane's rows name no campaign: the
  tickets are decoded from their call data. Only a lane charge still not final after that wait can
  still overlap.
- `refundBatch`: disjoint tickets of a campaign already settled YES; a batch skips a ticket already
  paid and never reverts because of another batch.

Everything else is a barrier, any kind the file does not name included: `createCampaignFor`,
`setPaused`, `closeSales`, `settle`, `payMerchant`, `release`. A barrier is simulated only once
nothing of its key is in flight, it travels alone, and nothing queued after it is signed until it
is mined. A pause therefore always comes after every sale queued before it, and no sale queued
after it is ever signed while it is in flight; `settle` comes after every charge.

What does not change:

- A call that reverts in simulation is `failed` and uses no nonce: the next one takes it.
- Nonce n + 1 is signed only once a node has taken nonce n. A broadcast refused (rate limit,
  outage, full pool) holds the queue behind it and is sent again, the same bytes, after a pause;
  it never leaves a gap that later nonces would wait behind.
- The signed bytes are stored before they are broadcast. After a restart, every `sent` row is
  resumed in nonce order from its stored bytes (mined ones are recorded, pending ones followed,
  ones the node lost broadcast again): nothing is signed twice, no nonce is skipped or reused.
- Receipts are recorded in nonce order, and only the earliest unmined transaction is looked up and
  watched. 15 s after a node took its latest attempt it is replaced with a higher fee and the same
  nonce (at most 3 times, then the error log and the row say the queue is blocked); the later ones
  are never signed again. With more than one in flight, the node's pending count is also asked
  every 3 s meanwhile: what it does not show goes out again from its stored bytes. Such a re-send
  never restarts the 15 s, so a node whose count never shows the transaction (one that answers
  `pending` as `latest`, a load-balanced RPC, a node that keeps evicting it and taking it back)
  cannot hold off the fee bump and the alert. A nonce taken by a transaction the engine did not
  sign fails that one transaction; the later ones are judged on their own nonces.
- A transaction cannot be mined before the one before it, so the time it waited behind a stalled
  earliest one does not count in full: when it becomes the earliest (the one before it recorded
  mined, reverted or failed), its replacement timer is moved so that at least `resendCheckMs`
  (3 s) remain before it can be replaced; with `resendCheckMs` at or above `replaceAfterMs` the
  timer simply restarts. A window that waited behind a stalled transaction is then mined one per
  block without a fee bump each (and without spending one of each one's 3 bumps), and under a
  real fee spike it recovers one transaction per 3 s, not one per 15 s.
- At `start()` every `sent` row is broadcast again from its stored bytes in the worker's first
  pass, in nonce order, before any receipt or count is read, whatever the window: nothing waits
  for the pending-count check or, with one in flight, for a fee bump 15 s later.
- `ARC_TX_MAX_IN_FLIGHT=1` is the one-at-a-time sender, request for request: the simulation, the
  gas estimate and a fresh fee suggestion are read one after the other for every transaction (a
  call that reverts costs its simulation only), and the pending count is never asked.
- On stop nothing new is signed; what is in flight stays `sent` and resumes at the next start.

**What it costs the node.** One transaction costs four requests of its own: the simulation
(`eth_call`), the gas estimate, the broadcast and its receipt. A burst shares the rest: one fee
suggestion (two requests with viem, read again at most once a second), one block time per block
that mined something, one nonce read per start. While transactions wait, a key polls the receipt of
its earliest one every 300 ms and asks the pending count every 3 s: about 3.7 requests a second
whatever the number in flight (`src/chain/tx-sender.fake-chain.test.ts` checks that 8 in flight
cost what 2 do; 1 in flight asks no pending count). So a burst of 8 costs about 27 requests to send
and 9 to record once mined: about 3.6 s of the limiter's 10 requests a second if nothing else asks.
Re-sends add to this only when the pending count misses something: at most the window (8) every
3 s while the node really loses transactions, and, while it answers "already known" to everything
re-sent (its count, not its pool, is wrong), a check that slows down, doubling up to once every
15 s: 8 re-sends per 15 s. A stuck earliest transaction is re-sent once per 15 s, as before.

**Why 8.** A refund batch of 50 tickets uses 1.1 to 2.1 M gas, so eight fit in one 30 M gas block
and a full window can be mined in a single block; the six batches of a 300-ticket campaign go in
one window with room for two sales. Nodes cap the pending transactions of one account (geth keeps
16 executable per account by default; Arc's public RPC does not say). When a node refuses a
transaction for want of room, it is not taken: the sender sends the same bytes again after a pause
(250 ms, doubling up to 10 s), signs nothing after it meanwhile, and the earlier ones are mined and
make room; five refusals in a row are logged at error level and noted on the row, as for any
refused broadcast. If a node keeps refusing, set `ARC_TX_MAX_IN_FLIGHT` under its cap. 1 sends one
transaction at a time.

## Real orders on the Gemini sandbox

`src/venues/gemini` is the real order adapter, `GeminiOrderVenue`, behind the same
`ExecutionVenue` as the paper venue (HE-10): signed requests (HMAC-SHA384, a strictly
increasing nonce, one request at a time), maker orders as `makerOrCancel`, takers as
`immediate-or-cancel`, every state read back from Gemini's active orders and history, typed errors
(key refused, nonce, funds, terms, 429 with backoff, no answer), answers validated with zod, and
logs that never carry the key, the secret, a payload or a signature. Production stays on `paper`:
`APP_EXECUTION_VENUE=gemini-sandbox` sends hedge orders to the sandbox, which lists no sports
contract, and `gemini` (real money) is refused.

The proof, three orders on a crypto contract of the sandbox (a maker that rests, its cancel, one
filled order), recorded in `venue_check_runs` / `venue_checks` and shown on the Hedge desk:

```bash
GEMINI_SANDBOX_API_KEY=… GEMINI_SANDBOX_API_SECRET=… DB_URL=postgres://… \
  pnpm --filter engine venue:check [--symbol <instrumentSymbol>] [--accept-terms] [--no-record]
```

or once at boot with `APP_VENUE_CHECK_ON_BOOT=true` and the two keys (Render has no shell): it
runs beside the services, never blocks them, logs `venue check at boot PROVEN` or `… FAILED` with
the step and the reason, and records the run either way. Account, key, Render steps and how to
read a failure: [`docs/gemini-sandbox.md`](../../docs/gemini-sandbox.md). Without a sandbox account,
the adapter is proven against the simulated Gemini of the tests only (`src/venues/gemini/sim-server.ts`),
and that is all that may be claimed.

## Demo mode

The web app's admin routes write rows; the engine honours them.

- **A driven book.** While `demo_overrides` holds a book for an instrument, that book replaces
  Gemini's for pricing, sale states and hedging, and is stored with source `demo`.
- **A forced result.** The settlement watcher settles on `demo_overrides.forced_result` when set.
- **A sale without a card.** A payment whose id starts with `pi_demo_` never reaches Stripe.
- Every campaign a demo action touches is marked `demo` for good.

Without Privy, each buyer's wallet is derived from `APP_DEMO_WALLET_SEED` and their e-mail. These
are **not customers' wallets**: the engine can re-derive their keys, which is what lets test funds
refunded to them be swept back. Never change the seed for a given database: a returning buyer's
wallet would no longer match the one recorded for their e-mail, and their purchases would fail.

```bash
APP_DEMO_WALLET_SEED=0x… DB_URL=postgres://… pnpm --filter @winz/engine exec tsx src/identity/sweep-demo-wallets.ts --rpc https://rpc.testnet.arc.io --to 0xTREASURY --from-users
```

## Tests

```bash
pnpm --filter @winz/engine test
```

The suite starts its own throwaway Postgres (it needs the Postgres server binaries: set `PG_BIN`
if they are not found) and its own local chain (Anvil, installed from npm). It never calls Gemini,
Stripe or a real network.
