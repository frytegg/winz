# supabase

The Postgres schema of Winz. Postgres is the off-chain source of truth; the
escrow contract stays the source of truth for money.

```
migrations/20261117000000_init.sql     every table, constraint, index, RLS policy
migrations/20261117010000_catalog.sql  what the Gemini catalogue sync stores on events and instruments
migrations/20261117020000_books.sql    order books shared by the engine and the web app
migrations/20261117030000_chain_txs_signer.sql  chain_txs nonces per signing key and chain; unit_price > 0
seed.sql                               demo merchant, one event and its four instruments
tests/run.sh                           local test script
tests/*.sql                            the assertions it runs
```

## Apply

The project must be linked first (`supabase link --project-ref <ref>`).

```bash
supabase db push                 # applies migrations/ to the linked project (pnpm db:migrate)
supabase db push --include-seed  # same, then runs seed.sql
```

A migration that has been applied is never edited: a change is a new file.

The first migration expects the roles `anon` and `authenticated`, which every Supabase project has. On
a plain Postgres, create them first (the test script does).

The seed can be run more than once. It creates no campaign: campaigns are created on-chain by
the app.

## Test

```bash
bash supabase/tests/run.sh
VERBOSE=1 bash supabase/tests/run.sh   # prints every assertion
```

It needs the Postgres 16 server binaries (`initdb`, `pg_ctl`, `psql`), looked up in
`/usr/lib/postgresql/16/bin`, then through `pg_config`; set `PG_BIN` to point elsewhere. Nothing
else: no Docker, no Supabase CLI, no network.

The script starts a throwaway server in a temp directory, reachable only through a socket in
that directory, and always stops and deletes it. Run as root, it starts the server as the
`postgres` user (`PG_OS_USER`), since Postgres refuses to run as root.

It applies the migrations and the seed to two fresh databases:

| Database | What it imitates |
| --- | --- |
| `winz_plain` | a vanilla Postgres with the three Supabase roles |
| `winz_supabase` | a Supabase project: every privilege on new public tables granted to `anon` and `authenticated` by default, and the `supabase_realtime` publication |

and checks, on both:

- the migrations and the seed apply, the seed twice;
- the public schema holds exactly the expected tables, RLS is on for each, and there are exactly
  three policies, all `select` on `live_*`;
- `live_instruments` and `live_campaigns` have exactly the columns of `liveInstrumentRowSchema`
  and `liveCampaignRowSchema`;
- every enum check lists exactly the values of the matching array in
  `packages/shared/src/domain.ts`, which the script reads;
- `events.status` and `instruments.side` list exactly the values of the catalogue section below,
  and the catalogue columns have the expected type and nullability;
- every uniqueness constraint rejects a duplicate, by name;
- check constraints reject bad enum values, negative amounts, a zero unit price, out-of-range
  basis points and malformed addresses, hashes and slugs, and a `chain_txs` nonce stored without
  its signing address and chain;
- `anon` and `authenticated` read the three `live_*` tables, get `permission denied` on every
  other table, and can write nowhere.

On `winz_supabase` it then grants everything back to the browser roles and checks that RLS alone
still returns zero private rows, that `service_role` reads and writes, and that the publication
holds exactly the three `live_*` tables.

The exit code is non-zero when one assertion fails.

## Conventions

| What | How |
| --- | --- |
| Money | `bigint`, micro-USDC (6 decimals), `check (x >= 0)`, or `> 0` where zero is refused (`campaigns.unit_price`). Never a float. |
| Contract quantities | `bigint`, micro-contracts, `check (x >= 0)`. 1 micro-USDC of exposure = 1 micro-contract. |
| Rates, probabilities, prices | `integer`, basis points, column name ends in `_bps`, range check. |
| Time | `timestamptz`. |
| Primary key | `uuid default gen_random_uuid()`, unless a natural key exists: `events.ticker`, `instruments.symbol`, `payments.stripe_pi`, `chain_events (tx_hash, log_index)`. |
| uint256 | `numeric(78,0)` (`tickets.quote_nonce`). |
| On-chain ids | `bigint` (`campaigns.onchain_id`, `tickets.onchain_id`). |
| Addresses, hashes | lowercase `text` with a format check. Lowercase the value before writing. |
| E-mail | stored lowercase and trimmed, enforced by a check. |
| Enums | `text` + `check (col in (...))`, same strings as `packages/shared/src/domain.ts`. Adding a value there needs a migration here; the test fails until both agree. |
| `updated_at` | set by a trigger on every update, whatever the writer sends. |
| FIFO of lots | `lots.seq`, an identity column the database assigns. Order by it, not by `created_at`. |

## Catalogue

`events` and `instruments` are written by the engine's Gemini sync (MD-1, MD-3;
`apps/engine/src/market-data/pg-catalog-store.ts`) with `insert ... on conflict ... do update`.
A row is never deleted: a campaign, a lot or an order may reference it.

`events.status` is ours; `events.gemini_status` keeps the string Gemini sent at the last sync.

| Gemini status | `events.status` | Meaning |
| --- | --- | --- |
| `approved` | `upcoming` | listed, not trading yet |
| `active` | `active` | trading |
| `closed` | `closed` | trading over, result not published yet |
| `settled` | `settled` | every contract has a yes/no outcome |
| `invalid` | `void` | cancelled by Gemini, every contract is void |
| anything else | `closed` | unknown to us: nothing may be sold on it |

The settlement sync also writes `settled` and `void`, once every instrument of the event has an
outcome (`void` when all of them are void). A later catalogue sync never undoes those two.

| Column of `instruments` | Content |
| --- | --- |
| `onchain_id` | `keccak256(symbol)`, `instrumentId()` of `packages/shared` |
| `side` | `home`, `away`, `tie`, or null (totals, or unknown) |
| `best_bid_bps`, `best_ask_bps` | quote at the last catalogue sync, null when that side of the book was empty. Up to a minute old: live prices are in `live_instruments`. |
| `active` | false once Gemini no longer lists the contract as tradable, or once it settled |
| `outcome`, `settled_at` | set together by the settlement sync, never changed afterwards |
| `synced_at` | last catalogue sync that listed the row (also on `events`) |

## Idempotency

| Table | Constraint | What it guarantees |
| --- | --- | --- |
| `chain_events` | primary key `(tx_hash, log_index)` | a log seen by the receipt, Streams and the poller is stored once |
| `payments` | primary key `stripe_pi`, unique `ticket_id` | the webhook and the client confirmation meet on one row |
| `tickets` | unique `onchain_id`, `access_token`, `payment_pi`, `quote_nonce` | one Stripe payment creates at most one ticket |
| `jobs` | unique `idempotency_key` (nullable) | the same trigger enqueues one job |
| `chain_txs` | unique `idempotency_key`; unique `(signer_address, chain_id, nonce)` where `nonce` is set | no transaction sent twice, no nonce used twice per key and chain, whatever the role |
| `users` | unique `email`, `privy_id`, `wallet` | one e-mail, one wallet |
| `campaigns` | unique `slug`, `onchain_id`, `budget_pi` | one budget payment creates at most one campaign |
| `lots` | unique `ticket_id` | one lot per ticket |
| `events`, `instruments` | primary keys `ticker`, `symbol` | a catalogue sync replayed any number of times leaves one row per game and per contract |

Writers use `insert ... on conflict do nothing` on these keys; the catalogue sync uses
`on conflict ... do update`.

## Access

Row level security is enabled on every table. The backend and the engine use the service role,
which bypasses it. The browser reads three tables through Supabase Realtime and nothing else:

| Table | Key | Content |
| --- | --- | --- |
| `live_instruments` | `symbol` | best bid, ask and mid in basis points, `observed_at`, `stale` |
| `live_campaigns` | `slug` | `sale_state`, `sales`, `exposure`, `hedged_bps`, `outcome` |
| `live_hedge_desk` | `instrument` | `payload`: one instrument of `GET /api/hedge-desk` |

These tables hold no personal data and must keep it that way: no e-mail, no wallet, no ticket
token. Each has one `select` policy for `anon` and `authenticated`. Every other privilege of
those two roles is revoked on every table, so a policy added by mistake exposes nothing by
itself. A new table needs the same three lines: `enable row level security`, the `revoke`, and a
row in `tests/00_harness.sql`.

## Order books (third migration)

`book_cache` holds the latest order book of every instrument the engine follows, and
`tracked_instruments` lets the web app ask the engine to follow one more (a merchant previewing a
promo). The engine is the only process that talks to Gemini; the web app reads `book_cache`.
Both tables are private: service role only.

## Transaction outbox (fourth migration)

`chain_txs` is the outbox of the engine's transaction sender (`apps/engine/src/chain`).
`signer` is the role a request is addressed to (`relayer` or `oracle`); which key
serves that role is configuration. A nonce belongs to a key on a chain, so every row that holds a
nonce also records:

| Column | Content |
| --- | --- |
| `signer_address` | lowercase address of the key that signed the transaction |
| `chain_id` | EIP-155 chain id it was signed for, positive |

Both are set in the same statement as `nonce` (check `chain_txs_nonce_has_signer`), and the
unique index `chain_txs_address_chain_nonce_key` is on `(signer_address, chain_id, nonce)`. The
engine derives a key's next nonce from that key's rows on that chain only, so a key rotation or a
chain switch on the same database starts the new key at its own count instead of stalling it
behind the old key's nonces. The engine refuses to start while a role has a `sent` row of another
key or chain, since nothing would ever complete it (`SignerHistoryMismatchError`, whose message
says what to do).

The migration has no backfill: no deployed database existed when it was written. It refuses to
run on a table that already holds a nonce, and on a campaign whose `unit_price` is 0, rather than
guess. `campaigns.unit_price` must now be positive (`campaigns_unit_price_range`), as the escrow
contract requires.

## Engine result (fifth migration)

`engine_pnl.resale_result` holds what reselling a hedge surplus brought in, minus what those
contracts had cost. It is the only signed amount in the schema: a resale can lose money.
