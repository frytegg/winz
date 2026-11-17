-- Access of the browser roles (SPEC section 7): `anon` and `authenticated` read the three live_*
-- tables and nothing else, and write nowhere. The service role reads everything.

-- live_*: readable, and the row of the fixtures is visible.
select test.count_is(
  format('select count(*) from public.%I', t.name), 1,
  format('%s reads %s', r.name, t.name), r.name
)
from test.live_tables t
cross join (values ('anon'), ('authenticated')) as r (name);

-- live_*: read-only.
select test.throws(
  format('insert into public.%I default values', t.name),
  '{42501}', format('%s cannot insert into %s', r.name, t.name), null, r.name
)
from test.live_tables t
cross join (values ('anon'), ('authenticated')) as r (name);

select test.throws(
  format('update public.%I set updated_at = now()', t.name),
  '{42501}', format('%s cannot update %s', r.name, t.name), null, r.name
)
from (select name from test.live_tables where name <> 'live_instruments') t
cross join (values ('anon'), ('authenticated')) as r (name);

select test.throws(
  $$update public.live_instruments set stale = true$$,
  '{42501}', format('%s cannot update live_instruments', r.name), null, r.name
)
from (values ('anon'), ('authenticated')) as r (name);

select test.throws(
  format('delete from public.%I', t.name),
  '{42501}', format('%s cannot delete from %s', r.name, t.name), null, r.name
)
from test.live_tables t
cross join (values ('anon'), ('authenticated')) as r (name);

-- Every other table: permission denied, for each kind of statement.
select test.throws(
  format('select count(*) from public.%I', t.name),
  '{42501}', format('%s cannot read %s', r.name, t.name), null, r.name
)
from test.private_tables t
cross join (values ('anon'), ('authenticated')) as r (name);

select test.throws(
  format('insert into public.%I default values', t.name),
  '{42501}', format('anon cannot insert into %s', t.name), null, 'anon'
)
from test.private_tables t;

select test.throws(
  format('delete from public.%I', t.name),
  '{42501}', format('anon cannot delete from %s', t.name), null, 'anon'
)
from test.private_tables t;

-- No grant at all is left to the browser roles outside select on live_*.
select test.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated', 'PUBLIC')
      and not (g.privilege_type = 'SELECT' and g.table_name in (select name from test.live_tables))
  ),
  'the browser roles hold no privilege besides select on live_*',
  (
    select string_agg(g.grantee || ':' || g.privilege_type || ':' || g.table_name, ', ')
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated', 'PUBLIC')
      and not (g.privilege_type = 'SELECT' and g.table_name in (select name from test.live_tables))
  )
);
