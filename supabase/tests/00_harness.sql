-- Test harness: every assertion writes one row to test.results instead of aborting, so a run
-- reports all the failures at once. run.sh reads the table and sets the exit code.

create schema test;

create table test.results (
  id bigint generated always as identity primary key,
  file text not null default current_setting('test.file', true),
  ok boolean not null,
  label text not null,
  detail text
);

-- Values of the `as const` arrays of packages/shared/src/domain.ts, loaded by run.sh.
create table test.domain_enums (
  name text not null,
  val text not null,
  primary key (name, val)
);

create function test.ok(cond boolean, label text, detail text default null) returns void
language plpgsql as $$
begin
  insert into test.results (ok, label, detail)
  values (coalesce(cond, false), label, case when coalesce(cond, false) then null else detail end);
end;
$$;

-- The statement must fail with one of `states`, and on `con` when a constraint name is given.
-- With `as_role`, it runs as that role.
create function test.throws(
  stmt text,
  states text[],
  label text,
  con text default null,
  as_role text default null
) returns void
language plpgsql as $$
declare
  got_state text;
  got_con text;
  got_msg text;
begin
  begin
    if as_role is not null then
      execute format('set local role %I', as_role);
    end if;
    execute stmt;
    -- Reached only when the statement succeeded: undo it and the role change.
    raise exception using errcode = 'T0001', message = 'no error';
  exception
    when others then
      get stacked diagnostics
        got_state = returned_sqlstate,
        got_con = constraint_name,
        got_msg = message_text;
  end;

  if got_state = 'T0001' then
    perform test.ok(false, label, 'expected an error, the statement succeeded');
  elsif not (got_state = any (states)) then
    perform test.ok(false, label, format('expected sqlstate %s, got %s: %s', states, got_state, got_msg));
  elsif con is not null and got_con is distinct from con then
    perform test.ok(false, label, format('expected constraint %s, got %s: %s', con, got_con, got_msg));
  else
    perform test.ok(true, label);
  end if;
end;
$$;

-- The statement must succeed. Its effects are kept.
create function test.lives(stmt text, label text, as_role text default null) returns void
language plpgsql as $$
declare
  got_state text;
  got_msg text;
begin
  begin
    if as_role is not null then
      execute format('set local role %I', as_role);
    end if;
    execute stmt;
    if as_role is not null then
      reset role;
    end if;
  exception
    when others then
      get stacked diagnostics got_state = returned_sqlstate, got_msg = message_text;
  end;
  perform test.ok(got_state is null, label, format('%s: %s', got_state, got_msg));
end;
$$;

-- `query` must return one bigint equal to `expected`.
create function test.count_is(
  query text,
  expected bigint,
  label text,
  as_role text default null
) returns void
language plpgsql as $$
declare
  got bigint;
  got_state text;
  got_msg text;
begin
  begin
    if as_role is not null then
      execute format('set local role %I', as_role);
    end if;
    execute query into got;
    if as_role is not null then
      reset role;
    end if;
  exception
    when others then
      get stacked diagnostics got_state = returned_sqlstate, got_msg = message_text;
  end;

  if got_state is not null then
    perform test.ok(false, label, format('%s: %s', got_state, got_msg));
  else
    perform test.ok(got = expected, label, format('expected %s, got %s', expected, got));
  end if;
end;
$$;

-- The quoted values of a check constraint, sorted: {'a','b'} for `check (col in ('a', 'b'))`.
create function test.check_values(con text) returns text[]
language sql as $$
  select coalesce(array_agg(m[1] order by m[1]), '{}')
  from pg_constraint c
  cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''::text', 'g') as m
  where c.conname = con and c.connamespace = 'public'::regnamespace;
$$;

create function test.domain_values(const_name text) returns text[]
language sql as $$
  select coalesce(array_agg(val order by val), '{}') from test.domain_enums where name = const_name;
$$;

-- The tables that only the service role may read.
create view test.private_tables as
select unnest(array[
  'users', 'merchants', 'events', 'instruments', 'campaigns', 'payments', 'tickets',
  'chain_events', 'chain_cursor', 'chain_txs', 'lots', 'positions', 'orders', 'fills',
  'lot_fills', 'engine_pnl', 'engine_params', 'demo_overrides', 'venue_checks',
  'push_subscriptions', 'jobs', 'book_cache', 'tracked_instruments'
]) as name;

create view test.live_tables as
select unnest(array['live_instruments', 'live_campaigns', 'live_hedge_desk']) as name;
