# Winz engine

The engine is the one process that talks to Gemini and the only sender of on-chain transactions.
The web app never does either: it writes rows and enqueues jobs, and the engine does the work.

## What runs

`src/index.ts` reads the environment, builds the production parts and calls `startEngine`
(`src/app.ts`), which starts these services in this order and stops them through one signal:

| Service       | What it does                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `tx-sender`   | The outbox `chain_txs`: nonces, fees, broadcast, receipts. One serial queue per key (relayer, oracle).     |
| `book-feed`   | Order books of the instruments in use: Gemini WebSocket, REST as fallback, or a book driven by demo mode.  |
| `chain-ingest`| Reads the escrow's events and projects them into tickets, lots and exposure.                               |
| `hedging`     | One policy runner per instrument: orders, fills, allocation to sales, `chargeHedge`, the Hedge desk rows.  |
| `sale-states` | Decides every second whether each campaign can sell, and why not.                                          |
| `settlement`  | Once a game is decided: final hedge charges, `settle`, refunds in batches of 50, payout, release.          |
| `jobs`        | The work the web app enqueues: create a campaign, sell a ticket, pause, close sales.                       |
| `catalog-sync`| Gemini's catalogue of games and their results, every minute.                                               |

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
