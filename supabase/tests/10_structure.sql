-- Structure: the tables of SPEC section 10 exist, RLS is on everywhere, the only policies are the
-- public reads of live_*, the realtime rows have the columns of the shared schemas, and every enum
-- check lists exactly the values of packages/shared/src/domain.ts.

select test.ok(
  (select array_agg(tablename::text order by tablename) from pg_tables where schemaname = 'public')
  = (
    select array_agg(name order by name)
    from (select name from test.private_tables union all select name from test.live_tables) t
  ),
  'public schema holds exactly the expected tables',
  (select string_agg(tablename, ', ' order by tablename) from pg_tables where schemaname = 'public')
);

select test.ok(
  not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity),
  'row level security is enabled on every table',
  (select string_agg(tablename, ', ') from pg_tables where schemaname = 'public' and not rowsecurity)
);

select test.ok(
  (select count(*) from pg_policies where schemaname = 'public') = 3,
  'there are exactly three policies',
  (select string_agg(tablename || '.' || policyname, ', ') from pg_policies where schemaname = 'public')
);

select test.ok(
  (
    select count(*) from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = t.name
      and p.cmd = 'SELECT'
      and p.permissive = 'PERMISSIVE'
      and (select array_agg(r::text order by r::text) from unnest(p.roles) r) = array['anon', 'authenticated']
  ) = 1,
  format('%s has one select policy for anon and authenticated', t.name)
)
from test.live_tables t;

-- Realtime rows: exact column names.
select test.ok(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = x.tbl
  ) = x.cols,
  format('%s has exactly the expected columns', x.tbl),
  (
    select string_agg(column_name, ', ' order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = x.tbl
  )
)
from (
  values
    ('live_instruments', array['symbol', 'bid_bps', 'ask_bps', 'mid_bps', 'observed_at', 'stale']),
    (
      'live_campaigns',
      array['slug', 'sale_state', 'sales', 'exposure', 'hedged_bps', 'outcome', 'updated_at']
    ),
    ('live_hedge_desk', array['instrument', 'payload', 'updated_at'])
) as x (tbl, cols);

-- Enum checks against domain.ts.
select test.ok(
  cardinality(test.domain_values(x.const_name)) > 0,
  format('%s was read from domain.ts', x.const_name)
)
from (
  select distinct const_name
  from (
    values
      ('MERCHANT_CATEGORIES'), ('SPORTS'), ('INSTRUMENT_TYPES'), ('CAMPAIGN_STATUSES'),
      ('SALE_STATES'), ('OUTCOMES'), ('CHECKOUT_STATUSES'), ('USER_ROLES'),
      ('EXECUTION_VENUES'), ('ORDER_KINDS'), ('ORDER_STATUSES')
  ) as v (const_name)
) x;

select test.ok(
  test.check_values(x.con) = test.domain_values(x.const_name),
  format('%s lists exactly %s', x.con, x.const_name),
  format('constraint %s, domain.ts %s', test.check_values(x.con), test.domain_values(x.const_name))
)
from (
  values
    ('users_roles_known', 'USER_ROLES'),
    ('merchants_category_known', 'MERCHANT_CATEGORIES'),
    ('events_sport_known', 'SPORTS'),
    ('events_result_known', 'OUTCOMES'),
    ('instruments_type_known', 'INSTRUMENT_TYPES'),
    ('campaigns_status_known', 'CAMPAIGN_STATUSES'),
    ('campaigns_sale_state_known', 'SALE_STATES'),
    ('campaigns_outcome_known', 'OUTCOMES'),
    ('payments_status_known', 'CHECKOUT_STATUSES'),
    ('positions_venue_known', 'EXECUTION_VENUES'),
    ('orders_venue_known', 'EXECUTION_VENUES'),
    ('orders_kind_known', 'ORDER_KINDS'),
    ('orders_status_known', 'ORDER_STATUSES'),
    ('demo_overrides_forced_result_known', 'OUTCOMES'),
    ('live_campaigns_sale_state_known', 'SALE_STATES'),
    ('live_campaigns_outcome_known', 'OUTCOMES')
) as x (con, const_name);

-- Money and quantity columns are bigint, basis points are integer.
select test.ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name like '%\_bps' and data_type <> 'integer'
  ),
  'every _bps column is an integer'
);

select test.ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and data_type in ('real', 'double precision', 'money', 'timestamp without time zone')
  ),
  'no float, money or naive timestamp column',
  (
    select string_agg(table_name || '.' || column_name, ', ')
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('real', 'double precision', 'money', 'timestamp without time zone')
  )
);

select test.ok(
  (
    select data_type = 'bigint' from information_schema.columns
    where table_schema = 'public' and table_name = x.tbl and column_name = x.col
  ),
  format('%s.%s is a bigint', x.tbl, x.col)
)
from (
  values
    ('campaigns', 'unit_price'), ('campaigns', 'budget'), ('campaigns', 'onchain_id'),
    ('payments', 'amount'),
    ('tickets', 'paid'), ('tickets', 'refundable'), ('tickets', 'max_hedge_cost'),
    ('tickets', 'onchain_id'),
    ('chain_txs', 'value'), ('chain_txs', 'nonce'),
    ('lots', 'qty'), ('lots', 'max_hedge_cost'), ('lots', 'filled_qty'), ('lots', 'cost'),
    ('lots', 'charged_amount'),
    ('positions', 'exposure'), ('positions', 'held'), ('positions', 'working'),
    ('orders', 'qty'), ('orders', 'filled_qty'),
    ('fills', 'qty'), ('fills', 'fee'),
    ('lot_fills', 'qty'), ('lot_fills', 'cost'),
    ('engine_pnl', 'maker_savings'), ('engine_pnl', 'guarantee_losses'),
    ('engine_pnl', 'crossing_gains'),
    ('live_campaigns', 'exposure')
) as x (tbl, col);

select test.ok(
  (
    select numeric_precision = 78 and numeric_scale = 0 from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets' and column_name = 'quote_nonce'
  ),
  'tickets.quote_nonce is numeric(78,0)'
);

select test.ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'jobs' and indexdef like '%(status, run_at)%'
  ),
  'jobs has an index on (status, run_at)'
);
