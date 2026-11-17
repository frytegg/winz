-- Runs only on the database that imitates a Supabase project (default privileges granted to the
-- browser roles before the migration, publication `supabase_realtime` present).
-- It then hands every privilege back to `anon` and `authenticated`, the worst case of a grant
-- made by mistake, to prove that row level security alone still hides every private row.

-- The service role is how the backend reads and writes: it must see the data.
select test.count_is(
  format('select count(*) from (select 1 from public.%I limit 1) t', t.name), 1,
  format('service_role reads %s', t.name), 'service_role'
)
from (select name from test.private_tables union all select name from test.live_tables) t;

select test.lives(
  $$insert into public.jobs (kind, idempotency_key) values ('purchase', 'purchase:pi_service')$$,
  'service_role writes a job', 'service_role'
);

-- Realtime: the three live tables are published, and only those.
select test.ok(
  (
    select array_agg(tablename::text order by tablename) from pg_publication_tables
    where pubname = 'supabase_realtime'
  ) = array['live_campaigns', 'live_hedge_desk', 'live_instruments'],
  'supabase_realtime publishes exactly the three live_* tables',
  (
    select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
    where pubname = 'supabase_realtime'
  )
);

grant all on all tables in schema public to anon, authenticated;

select test.count_is(
  format('select count(*) from public.%I', t.name), 0,
  format('with every grant restored, %s still sees no row of %s', r.name, t.name), r.name
)
from test.private_tables t
cross join (values ('anon'), ('authenticated')) as r (name);

select test.throws(
  x.stmt, '{42501}',
  format('with every grant restored, row level security refuses an anon insert into %s', x.tbl),
  null, 'anon'
)
from (
  values
    ('live_instruments', $$insert into public.live_instruments (symbol) values ('GEMI-ANON')$$),
    ('live_campaigns', $$insert into public.live_campaigns (slug, sale_state) values ('anon-promo', 'open')$$),
    ('live_hedge_desk', $$insert into public.live_hedge_desk (instrument, payload) values ('GEMI-ANON', '{}')$$)
) as x (tbl, stmt);

select test.throws(
  $$insert into public.jobs (kind) values ('purchase')$$,
  '{42501}', 'with every grant restored, row level security refuses an anon job', null, 'anon'
);

select test.lives(
  $$update public.live_instruments set stale = true$$,
  'with every grant restored, an anon update of live_instruments matches no row', 'anon'
);
select test.count_is(
  $$select count(*) from public.live_instruments where stale$$, 0,
  'live_instruments was not changed by anon'
);

select test.lives(
  $$delete from public.live_campaigns$$,
  'with every grant restored, an anon delete of live_campaigns matches no row', 'anon'
);
select test.count_is(
  $$select count(*) from public.live_campaigns$$, 1,
  'live_campaigns was not emptied by anon'
);

select test.count_is(
  format('select count(*) from public.%I', t.name), 1,
  format('with every grant restored, anon still reads %s', t.name), 'anon'
)
from test.live_tables t;
