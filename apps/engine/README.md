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
| `catalog-sync`| Gemini's catalogue of games and their results, every minute.                                               |

The budget top-up job (`campaign.top_up`, one per paid top-up, SPEC CA-6) sends
`topUpBudgetFor` (key `topUpBudget:<payment id>`, a barrier) and projects its `BudgetToppedUp`,
or, when the campaign can no longer take it, refunds the merchant's card once: never both.

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
| `DB_URL`                                              | yes       | Postgres. Works through Supabase's transaction pooler.                                |
| `APP_ADMIN_DEMO_KEY`                                  | yes       | At least 16 characters. Same value as the web app.                                    |
| `ARC_RPC_URL`, `ARC_ESCROW_ADDRESS`, `ARC_ESCROW_DEPLOY_BLOCK` | yes | See `docs/arc-testnet.md` and `packages/contracts/deployments/`.                   |
| `ARC_RELAYER_PRIVATE_KEY`, `ARC_ORACLE_PRIVATE_KEY`   | yes       | Two different keys. Testnet only. Never logged.                                       |
| `STRIPE_SECRET_KEY`                                   | no        | Test keys only (`sk_test_`). Without it only demo sales can be sold.                  |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`        | together  | Buyers' embedded wallets. Without them `APP_DEMO_WALLET_SEED` is required.            |
| `APP_DEMO_WALLET_SEED`                                | see above | 32-byte hex secret from which demo wallets are derived.                               |
| `APP_EXECUTION_VENUE`                                 | no        | `paper` (default): fills simulated against the live Gemini book.                      |
| `DB_POOL_MAX`                                         | no        | Default 20.                                                                           |
| `ARC_RPC_MAX_REQUESTS_PER_SECOND`                     | no        | Requests the engine starts in any one second, every method counted. Default 10.       |
| `ARC_RPC_MAX_HEAVY_REQUESTS_PER_SECOND`               | no        | Of those, requests of the heavy methods. Default 4.                                   |
| `ARC_RPC_HEAVY_METHODS`                               | no        | Comma-separated JSON-RPC methods counted as heavy. Default `eth_getLogs`.             |
| `ARC_TX_MAX_IN_FLIGHT`                                | no        | Transactions of one key broadcast and not mined yet at once. 1 to 64, default 8.      |
| `PORT`                                                | no        | Port of the health listener (`GET /healthz`). Unset: no listener. Railway sets it.    |
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

## Deploy

The engine runs as one container on Railway: `apps/engine/Dockerfile`, built from the repository
root, and `railway.json` at the root. The step-by-step page, with the command that proves each
step, is [`docs/deploy.md`](../../docs/deploy.md) (in French).

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
  lease: { holder, heldForS, renewedAgoMs } }`. A leader (`role: "leader"`) answers 200 when the
  database (the event reader's `chain_cursor` row, read within 2 s) and the node
  (`eth_blockNumber`, within 2 s) both answer and the sender and the job worker run; 503
  otherwise, including while the engine starts or stops. A standby (`role: "standby"`, `sender`
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
  after every service has stopped and the lease is released, before the database pool. Without
  `PORT`, nothing listens (local runs and tests are unchanged).
- **One replica.** `railway.json` keeps `numReplicas: 1`. A second replica would now be harmless
  (it waits as a standby and runs no service) but would only waste a container: see the lease
  below and [`docs/deploy.md`](../../docs/deploy.md), section 2.

```bash
docker build -f apps/engine/Dockerfile -t winz-engine .
docker run --rm --env-file engine.env -e PORT=8080 -p 8080:8080 winz-engine
curl -s localhost:8080/healthz
```

## One engine per database: the lease

Every engine process holds the transaction sender's keys, a job worker, a hedger per instrument,
the hedge charger and the settlement watcher, and several of them are serialised only inside one
process (the charger's lock, each hedging runner's working orders). So only one process works on
a database at a time. A Railway redeploy starts the new container before it stops the old one:
without this, both ran every service for the start-up window.

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

The real process's stop is dominated by the Gemini catalogue sync, whose request in flight is not
aborted (10 s timeout per attempt); in that test Gemini points at a closed port. A stop can
outlast the margin: a job handler that ignores its abort keeps the job worker up to its 10 s
grace, and a service waiting on a database that has gone silent (it accepts connections and
answers nothing) waits for an answer that never comes (`leader.e2e.test.ts` shows it).
So a fenced stop still running 1 s before the lease can expire (`ttl - min(1 s, margin / 4)`
after the last renewal) is declared stuck: the leader logs it at fatal level and `src/index.ts`
ends the process with exit code 1, before another engine can take the lease; Railway starts it
again as a standby (`ON_FAILURE`, at most 10 restarts in a row).

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
