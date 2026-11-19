-- engine_identity: which chain and escrow this database belongs to (apps/engine/src/chain/
-- engine-identity.ts). One row under the name 'engine', a positive chain id, a lowercase address,
-- the record time on the database's clock. The record is decided by the database: of two inserts
-- `on conflict do nothing`, only the first writes. Private: no policy, no grant.

-- The fixture's row is the one row.
select test.count_is(
  $$select count(*) from public.engine_identity$$, 1, 'engine_identity holds the fixture''s row'
);

-- One row only: a second insert for the name is refused, and "on conflict do nothing" writes
-- nothing (the engine's record statement).
select test.throws(
  $$insert into public.engine_identity (chain_id, escrow_address)
    values (31337, '0x00000000000000000000000000000000000000aa')$$,
  '{23505}', 'engine_identity rejects a second row', 'engine_identity_pkey'
);
select test.lives(
  $$insert into public.engine_identity (chain_id, escrow_address)
    values (31337, '0x00000000000000000000000000000000000000aa')
    on conflict (name) do nothing$$,
  'engine_identity: a second record on conflict do nothing runs'
);
select test.ok(
  (select chain_id = 5042002 and escrow_address = '0x81d2d4050e617184b2b832c30be68f8811b37d2c'
   from public.engine_identity),
  'engine_identity: the second record wrote nothing, the first pair stands',
  (select chain_id::text || ' ' || escrow_address from public.engine_identity)
);
select test.throws(
  $$insert into public.engine_identity (name, chain_id, escrow_address)
    values ('engine-2', 31337, '0x00000000000000000000000000000000000000aa')$$,
  '{23514}', 'engine_identity rejects any other name', 'engine_identity_name_known'
);

-- The pair is well formed.
select test.throws(
  $$update public.engine_identity set chain_id = 0$$,
  '{23514}', 'engine_identity rejects a chain id of 0', 'engine_identity_chain_id_range'
);
select test.throws(
  $$update public.engine_identity set chain_id = null$$,
  '{23502}', 'engine_identity rejects a missing chain id'
);
select test.throws(
  $$update public.engine_identity
    set escrow_address = '0x81D2D4050E617184B2B832C30BE68F8811B37D2C'$$,
  '{23514}', 'engine_identity rejects a checksummed (not lowercase) address',
  'engine_identity_escrow_address_format'
);
select test.throws(
  $$update public.engine_identity set escrow_address = '0x81d2'$$,
  '{23514}', 'engine_identity rejects a short address', 'engine_identity_escrow_address_format'
);
select test.throws(
  $$update public.engine_identity set escrow_address = null$$,
  '{23502}', 'engine_identity rejects a missing address'
);
select test.ok(
  (select recorded_at is not null and recorded_at <= clock_timestamp() from public.engine_identity),
  'engine_identity: recorded_at is set by the database'
);

-- Exactly these columns.
select test.ok(
  (
    select array_agg(column_name::text || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'engine_identity'
  ) = array[
    'name:text', 'chain_id:integer', 'escrow_address:text',
    'recorded_at:timestamp with time zone'
  ],
  'engine_identity has exactly the expected columns and types',
  (
    select string_agg(column_name || ':' || data_type, ', ' order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'engine_identity'
  )
);

-- Private: row level security on and no policy. That the browser roles can neither read nor write
-- it is asserted with every private table (test.private_tables lists it): 50_anon_access.sql
-- without any grant, 60_supabase_like.sql with every grant handed back.
select test.ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'engine_identity'),
  'engine_identity has row level security enabled'
);
select test.count_is(
  $$select count(*) from pg_policies where schemaname = 'public' and tablename = 'engine_identity'$$,
  0, 'engine_identity has no policy'
);
select test.ok(
  'engine_identity' in (select name from test.private_tables),
  'engine_identity is checked as a private table'
);
