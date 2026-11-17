# supabase

The Postgres schema of Winz (SPEC section 10). Postgres is the off-chain source of truth; the
escrow contract stays the source of truth for money.

```
migrations/20261117000000_init.sql   every table, constraint, index, RLS policy
seed.sql                             demo merchant, one event and its four instruments
tests/run.sh                         local test script
tests/*.sql                          the assertions it runs
```

## Apply

The project must be linked first (`supabase link --project-ref <ref>`).

```bash
supabase db push                 # applies migrations/ to the linked project (pnpm db:migrate)
supabase db push --include-seed  # same, then runs seed.sql
```

The migration expects the roles `anon` and `authenticated`, which every Supabase project has. On
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

It applies the migration and the seed to two fresh databases:

| Database | What it imitates |
| --- | --- |
| `winz_plain` | a vanilla Postgres with the three Supabase roles |
| `winz_supabase` | a Supabase project: every privilege on new public tables granted to `anon` and `authenticated` by default, and the `supabase_realtime` publication |

and checks, on both:

- the migration and the seed apply, the seed twice;
- the public schema holds exactly the expected tables, RLS is on for each, and there are exactly
  three policies, all `select` on `live_*`;
- `live_instruments` and `live_campaigns` have exactly the columns of `liveInstrumentRowSchema`
  and `liveCampaignRowSchema`;
- every enum check lists exactly the values of the matching array in
  `packages/shared/src/domain.ts`, which the script reads;
- every uniqueness constraint rejects a duplicate, by name;
- check constraints reject bad enum values, negative amounts, out-of-range basis points and
  malformed addresses, hashes and slugs;
- `anon` and `authenticated` read the three `live_*` tables, get `permission denied` on every
  other table, and can write nowhere.

On `winz_supabase` it then grants everything back to the browser roles and checks that RLS alone
still returns zero private rows, that `service_role` reads and writes, and that the publication
holds exactly the three `live_*` tables.

The exit code is non-zero when one assertion fails.

## Conventions

| What | How |
| --- | --- |
| Money | `bigint`, micro-USDC (6 decimals), `check (x >= 0)`. Never a float. |
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

## Idempotency

| Table | Constraint | What it guarantees |
| --- | --- | --- |
| `chain_events` | primary key `(tx_hash, log_index)` | a log seen by the receipt, Streams and the poller is stored once |
| `payments` | primary key `stripe_pi`, unique `ticket_id` | the webhook and the client confirmation meet on one row |
| `tickets` | unique `onchain_id`, `access_token`, `payment_pi`, `quote_nonce` | one Stripe payment creates at most one ticket |
| `jobs` | unique `idempotency_key` (nullable) | the same trigger enqueues one job |
| `chain_txs` | unique `idempotency_key`; unique `(signer, nonce)` where `nonce` is set | no transaction sent twice, no nonce used twice per key |
| `users` | unique `email`, `privy_id`, `wallet` | one e-mail, one wallet |
| `campaigns` | unique `slug`, `onchain_id`, `budget_pi` | one budget payment creates at most one campaign |
| `lots` | unique `ticket_id` | one lot per ticket |

Writers use `insert ... on conflict do nothing` on these keys.

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
