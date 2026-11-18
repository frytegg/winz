-- campaigns.request_id (F-05): POST /api/campaigns is idempotent on the merchant's requestId.
-- The column is a nullable uuid, unique per merchant where it is set, and nothing else changes.

select test.ok(
  (
    select format('%s %s', data_type, is_nullable) from information_schema.columns
    where table_schema = 'public' and table_name = 'campaigns' and column_name = 'request_id'
  ) = 'uuid YES',
  'campaigns.request_id is a nullable uuid',
  (
    select format('%s %s', data_type, is_nullable) from information_schema.columns
    where table_schema = 'public' and table_name = 'campaigns' and column_name = 'request_id'
  )
);

select test.ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'campaigns'
      and indexname = 'campaigns_merchant_id_request_id_key'
      and indexdef like 'CREATE UNIQUE INDEX%(merchant_id, request_id) WHERE (request_id IS NOT NULL)'
  ),
  'campaigns has a partial unique index on (merchant_id, request_id) where request_id is set',
  (
    select string_agg(indexdef, '; ') from pg_indexes
    where schemaname = 'public' and tablename = 'campaigns' and indexdef like '%request_id%'
  )
);

-- A second merchant, to show the uniqueness is per merchant.
insert into public.users (id, email, roles)
values ('10000000-0000-4000-8000-000000000080', 'ann@example.com', array['merchant']);
insert into public.merchants (id, user_id, name, category)
values (
  '00000000-0000-4000-8000-000000000080', '10000000-0000-4000-8000-000000000080', 'Ann''s Bar',
  'bar'
);

-- A funding campaign of `merchant` with `request`, as the route inserts it.
create function test.campaign_request(merchant uuid, request uuid) returns text
language sql as $$
  select format(
    $f$insert into public.campaigns (
      merchant_id, request_id, instrument, event_ticker, product, condition_label, promise,
      unit_price, refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget,
      sales_close, status, sale_state
    ) values (
      %L, %L, 'GEMI-NCAAF-2611212030-ARK-TEX-M-TEX', 'NCAAF-2611212030-ARK-TEX-M', 'Slice',
      'Texas wins', '50%% back if Texas wins', 5000000, 5000, 6500, 4700, 9000, 100000000,
      '2026-11-21T20:25:00Z', 'funding', 'closed'
    )$f$,
    merchant, request
  );
$$;

select test.lives(
  test.campaign_request(
    '00000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001'
  ),
  'campaigns accepts a campaign with a request id'
);
select test.throws(
  test.campaign_request(
    '00000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001'
  ),
  '{23505}', 'campaigns rejects a second campaign of one merchant for one request id',
  'campaigns_merchant_id_request_id_key'
);
select test.lives(
  test.campaign_request(
    '00000000-0000-4000-8000-000000000080', '80000000-0000-4000-8000-000000000001'
  ),
  'campaigns accepts the same request id from another merchant'
);
select test.lives(
  test.campaign_request(
    '00000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000002'
  ),
  'campaigns accepts another request id of the same merchant'
);
select test.lives(
  test.campaign_request('00000000-0000-4000-8000-000000000002', null),
  'campaigns accepts a campaign without a request id'
);
select test.lives(
  test.campaign_request('00000000-0000-4000-8000-000000000002', null),
  'campaigns accepts a second campaign without a request id: those are not protected'
);
select test.throws(
  $$update public.campaigns set request_id = 'not-a-uuid'
    where request_id = '80000000-0000-4000-8000-000000000002'$$,
  '{22P02}', 'campaigns.request_id refuses what is not a uuid'
);

-- The route's insert: the conflict target infers the partial index, and a repeat inserts nothing.
select test.count_is(
  $$with attempt as (
      insert into public.campaigns (
        merchant_id, request_id, instrument, event_ticker, product, condition_label, promise,
        unit_price, refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget,
        sales_close, status, sale_state
      ) values (
        '00000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001',
        'GEMI-NCAAF-2611212030-ARK-TEX-M-TEX', 'NCAAF-2611212030-ARK-TEX-M', 'Slice',
        'Texas wins', '50% back if Texas wins', 5000000, 5000, 6500, 4700, 9000, 100000000,
        '2026-11-21T20:25:00Z', 'funding', 'closed'
      )
      on conflict (merchant_id, request_id) where request_id is not null do nothing
      returning id
    )
    select count(*) from attempt$$,
  0, 'the insert on conflict of a known request id inserts nothing'
);
select test.count_is(
  $$select count(*) from public.campaigns
    where request_id = '80000000-0000-4000-8000-000000000001'$$,
  2, 'one campaign per merchant for the request id, two merchants'
);

-- Existing rows are untouched: the fixture campaign has no request id.
select test.count_is(
  $$select count(*) from public.campaigns
    where id = '20000000-0000-4000-8000-000000000001' and request_id is null$$,
  1, 'campaigns created before the column have no request id'
);

-- The browser roles read nothing of campaigns, request ids included: the column has no grant of its
-- own, so 50_anon_access.sql (permission denied) and 60_supabase_like.sql (row level security hides
-- every row even with every grant restored) cover it with the rest of the table.
select test.ok(
  not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'campaigns' and column_name = 'request_id'
      and grantee in ('anon', 'authenticated')
      and not exists (
        select 1 from information_schema.table_privileges tp
        where tp.table_schema = 'public' and tp.table_name = 'campaigns'
          and tp.grantee = column_privileges.grantee
          and tp.privilege_type = column_privileges.privilege_type
      )
  ),
  'campaigns.request_id has no grant to the browser roles beyond the table''s own'
);
