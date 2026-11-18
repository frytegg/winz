-- engine_lease: which engine process works on this database (apps/engine/src/leader). One row
-- under the name 'engine', a well-formed holder id, and times that follow each other: acquired,
-- renewed, expires; a release ends the lease at its own time. Private: no policy, no grant.

-- The fixture's row is the one row.
select test.count_is(
  $$select count(*) from public.engine_lease$$, 1, 'engine_lease holds the fixture''s lease'
);

-- One name only.
select test.throws(
  $$insert into public.engine_lease (name, holder, acquired_at, renewed_at, expires_at)
    values ('engine', 'eng-ba9876543210', now(), now(), now() + interval '15 seconds')$$,
  '{23505}', 'engine_lease rejects a second row for the name engine', 'engine_lease_pkey'
);
select test.throws(
  $$insert into public.engine_lease (name, holder, acquired_at, renewed_at, expires_at)
    values ('engine-2', 'eng-ba9876543210', now(), now(), now() + interval '15 seconds')$$,
  '{23514}', 'engine_lease rejects any other name', 'engine_lease_name_known'
);

-- The holder id: short, lowercase, no spaces, nothing secret-like.
select test.throws(
  $$update public.engine_lease set holder = 'Eng 01' where name = 'engine'$$,
  '{23514}', 'engine_lease rejects a malformed holder', 'engine_lease_holder_format'
);
select test.throws(
  $$update public.engine_lease set holder = 'eng' where name = 'engine'$$,
  '{23514}', 'engine_lease rejects a holder shorter than 8 characters', 'engine_lease_holder_format'
);
select test.throws(
  $$update public.engine_lease set holder = null where name = 'engine'$$,
  '{23502}', 'engine_lease rejects a missing holder'
);

-- The times follow each other.
select test.throws(
  $$update public.engine_lease set renewed_at = acquired_at - interval '1 second'
    where name = 'engine'$$,
  '{23514}', 'engine_lease rejects a renewal before the acquisition',
  'engine_lease_renewed_after_acquired'
);
select test.throws(
  $$update public.engine_lease set expires_at = renewed_at - interval '1 second'
    where name = 'engine'$$,
  '{23514}', 'engine_lease rejects an expiry before the renewal',
  'engine_lease_expires_after_renewed'
);
select test.throws(
  $$update public.engine_lease set released_at = renewed_at + interval '1 second'
    where name = 'engine'$$,
  '{23514}', 'engine_lease rejects a release that leaves the lease running after it',
  'engine_lease_released_in_lease'
);
select test.throws(
  $$update public.engine_lease set released_at = acquired_at - interval '1 second',
      expires_at = acquired_at, renewed_at = acquired_at
    where name = 'engine'$$,
  '{23514}', 'engine_lease rejects a release before the acquisition',
  'engine_lease_released_in_lease'
);
select test.lives(
  $$update public.engine_lease set released_at = renewed_at, expires_at = renewed_at
    where name = 'engine'$$,
  'engine_lease accepts a release that ends the lease at its own time'
);
select test.lives(
  $$update public.engine_lease set holder = 'eng-ba9876543210', acquired_at = now(),
      renewed_at = now(), expires_at = now() + interval '15 seconds', released_at = null
    where name = 'engine'$$,
  'engine_lease accepts a new holder taking the released lease'
);

-- Every time is a timestamptz: decisions are taken on the database's clock.
select test.ok(
  (
    select array_agg(column_name::text || ':' || data_type order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'engine_lease'
  ) = array[
    'name:text', 'holder:text', 'acquired_at:timestamp with time zone',
    'renewed_at:timestamp with time zone', 'expires_at:timestamp with time zone',
    'released_at:timestamp with time zone'
  ],
  'engine_lease has exactly the expected columns and types',
  (
    select string_agg(column_name || ':' || data_type, ', ' order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'engine_lease'
  )
);

-- Private: row level security on and no policy. That the browser roles can neither read nor write
-- it is asserted with every private table (test.private_tables lists it): 50_anon_access.sql
-- without any grant, 60_supabase_like.sql with every grant handed back.
select test.ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'engine_lease'),
  'engine_lease has row level security enabled'
);
select test.count_is(
  $$select count(*) from pg_policies where schemaname = 'public' and tablename = 'engine_lease'$$,
  0, 'engine_lease has no policy'
);
select test.ok(
  'engine_lease' in (select name from test.private_tables),
  'engine_lease is checked as a private table'
);
