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
before a crash is re-broadcast as it was, never signed twice. Run **one engine per database**.

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
  dependency): `{ status, startedAt, uptimeS, chain: { id, head, cursor }, db, sender, jobs }`.
  200 when the database (the event reader's `chain_cursor` row, read within 2 s) and the node
  (`eth_blockNumber`, within 2 s) both answer and the sender and the job worker run; 503 otherwise,
  including while the engine stops. It never answers a secret, a key's address or an e-mail. It
  opens once the engine runs and closes after every service has stopped, before the database
  pool. Without `PORT`, nothing listens (local runs and tests are unchanged).
- **One replica.** Never two engines on one database: see [`docs/deploy.md`](../../docs/deploy.md),
  section 2, for what the code guards (the nonce index, `skip locked`) and what it does not (there
  is no singleton lock).

```bash
docker build -f apps/engine/Dockerfile -t winz-engine .
docker run --rm --env-file engine.env -e PORT=8080 -p 8080:8080 winz-engine
curl -s localhost:8080/healthz
```

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
