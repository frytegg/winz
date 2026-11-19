-- engine_identity: which chain and which escrow this database belongs to (SPEC section 7). One
-- row, under the well-known name 'engine', written by the first engine that works on the database
-- (apps/engine/src/chain/engine-identity.ts, called by startEngine before any service starts).
--
-- Two engines on one database take turns safely (engine_lease), but campaigns, tickets, chain
-- events and nonces of two different chains, or of two escrows, in the same tables cannot be told
-- apart afterwards. Every later start compares its configured pair (ARC_CHAIN_ID,
-- ARC_ESCROW_ADDRESS) with this row and, on a difference, refuses to start its services with a
-- configuration error naming both pairs.
--
-- The row is written by one statement, `insert ... on conflict (name) do nothing`: the database
-- decides, so of two engines starting together on an empty database exactly one records its pair.
-- The same statement records nothing on a database that already holds chain_txs or an event
-- reader cursor of another chain or escrow (one that predates this table).
--
--   chain_id        EIP-155 chain id the engine signs for (ARC_CHAIN_ID)
--   escrow_address  the WinzEscrow it works for, lowercase (ARC_ESCROW_ADDRESS)
--   recorded_at     when it was recorded, on the database's clock
--
-- Nothing updates the row. To move a database to another chain or escrow is not supported: start
-- from an empty database. The web app does not read it.
create table public.engine_identity (
  name text primary key default 'engine',
  chain_id integer not null,
  escrow_address text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint engine_identity_name_known check (name = 'engine'),
  constraint engine_identity_chain_id_range check (chain_id > 0),
  constraint engine_identity_escrow_address_format check (escrow_address ~ '^0x[0-9a-f]{40}$')
);

-- Private like every table but live_*: no policy, and no grant to the browser roles.
alter table public.engine_identity enable row level security;
revoke all on table public.engine_identity from anon, authenticated;
