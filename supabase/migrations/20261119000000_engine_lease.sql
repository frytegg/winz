-- engine_lease: which engine process works on this database (SPEC section 7, "one sender per
-- database"). One row, under the well-known name 'engine'. An engine process starts as a standby
-- and starts its services (transaction sender, job worker, hedging, settlement, readers) only once
-- it holds this lease; it renews it every few seconds and stops its services by itself when it can
-- no longer renew it (apps/engine/src/leader).
--
-- Every statement on this table is a single statement, its own transaction, and every decision in
-- it is taken on the database's clock (`clock_timestamp()`), never on a process's: the engine
-- connects through Supabase's transaction pooler, where no session state (advisory lock, LISTEN)
-- survives between statements.
--
--   holder       random id the engine process drew at start (not a secret: no key, no host name)
--   acquired_at  when this holder took the lease
--   renewed_at   its latest renewal
--   expires_at   the lease is free from this time on, unless renewed before
--   released_at  set when the holder gave the lease up at stop (expires_at is then that time too)
--
-- The row stays after a release, holder included: the last holder is what a standby, the health
-- report and an operator read. An acquisition overwrites it.
create table public.engine_lease (
  name text primary key,
  holder text not null,
  acquired_at timestamptz not null,
  renewed_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  constraint engine_lease_name_known check (name = 'engine'),
  constraint engine_lease_holder_format check (holder ~ '^[a-z0-9-]{8,64}$'),
  constraint engine_lease_renewed_after_acquired check (renewed_at >= acquired_at),
  constraint engine_lease_expires_after_renewed check (expires_at >= renewed_at),
  constraint engine_lease_released_in_lease check (
    released_at is null or (released_at >= acquired_at and expires_at <= released_at)
  )
);

-- Private like every table but live_*: no policy, and no grant to the browser roles.
alter table public.engine_lease enable row level security;
revoke all on table public.engine_lease from anon, authenticated;
