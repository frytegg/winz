-- venue_check_runs, the venue_checks columns and venue_order_links (20261120000000_venue_checks.sql):
-- the real-order proof on Gemini's sandbox (HE-10) and the links of the real order adapter.
-- Private: no policy, no grant (asserted with every private table in 50_anon_access.sql).

-- A run: the sandbox only, a known trigger and outcome, a failure exactly when it failed.
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome)
    values ('gemini', 'command', now(), now(), 'proven')$$,
  '{23514}', 'venue_check_runs refuses Gemini production', 'venue_check_runs_venue_known'
);
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome)
    values ('gemini-sandbox', 'cron', now(), now(), 'proven')$$,
  '{23514}', 'venue_check_runs refuses an unknown trigger', 'venue_check_runs_trigger_known'
);
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome)
    values ('gemini-sandbox', 'command', now(), now(), 'partial')$$,
  '{23514}', 'venue_check_runs refuses an unknown outcome', 'venue_check_runs_outcome_known'
);
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome)
    values ('gemini-sandbox', 'boot', now(), now(), 'failed')$$,
  '{23514}', 'venue_check_runs refuses a failed run without its step and reason',
  'venue_check_runs_failure_consistent'
);
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome,
                                         failed_step, failure)
    values ('gemini-sandbox', 'boot', now(), now(), 'proven', 'filled', 'x')$$,
  '{23514}', 'venue_check_runs refuses a proven run that carries a failure',
  'venue_check_runs_failure_consistent'
);
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome,
                                         failed_step, failure)
    values ('gemini-sandbox', 'boot', now(), now(), 'failed', 'settle', 'x')$$,
  '{23514}', 'venue_check_runs refuses an unknown step', 'venue_check_runs_failed_step_known'
);
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome,
                                         failed_step, failure)
    values ('gemini-sandbox', 'boot', now(), now(), 'failed', 'preflight', repeat('x', 601))$$,
  '{23514}', 'venue_check_runs refuses a reason over 600 characters',
  'venue_check_runs_failure_length'
);
select test.throws(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome)
    values ('gemini-sandbox', 'command', now(), now() - interval '1 second', 'proven')$$,
  '{23514}', 'venue_check_runs refuses a run that finished before it started',
  'venue_check_runs_times_ordered'
);
select test.lives(
  $$insert into public.venue_check_runs (venue, trigger, started_at, finished_at, outcome,
                                         failed_step, failure)
    values ('gemini-sandbox', 'boot', now(), now(), 'failed', 'preflight',
            'GEMINI_SANDBOX_API_KEY and GEMINI_SANDBOX_API_SECRET are not both set')$$,
  'venue_check_runs takes a failed run with its step and reason'
);

-- The orders of a run, with what was read back from Gemini.
select test.lives(
  $$insert into public.venue_checks (venue_order_id, instrument, action, run_id, side, kind,
                                     price_bps, qty, filled_qty, status)
    values ('73797746498585286', 'GEMI-BTC2611202200-HI91000', 'placed_maker',
            '50000000-0000-4000-8000-000000000001', 'buy', 'maker', 3600, 1000000, 0, 'open')$$,
  'venue_checks takes an order of a run with what was read back'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action, side)
    values ('o-2', 'GEMI-X', 'filled', 'short')$$,
  '{23514}', 'venue_checks refuses an unknown side', 'venue_checks_side_known'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action, kind)
    values ('o-2', 'GEMI-X', 'filled', 'market')$$,
  '{23514}', 'venue_checks refuses an unknown kind', 'venue_checks_kind_known'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action, price_bps)
    values ('o-2', 'GEMI-X', 'filled', 10001)$$,
  '{23514}', 'venue_checks refuses a price above one dollar', 'venue_checks_price_range'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action, qty, filled_qty)
    values ('o-2', 'GEMI-X', 'filled', 1000000, 2000000)$$,
  '{23514}', 'venue_checks refuses more filled than ordered', 'venue_checks_filled_range'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action, qty)
    values ('o-2', 'GEMI-X', 'filled', 0)$$,
  '{23514}', 'venue_checks refuses a zero quantity', 'venue_checks_qty_positive'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action, status)
    values ('o-2', 'GEMI-X', 'filled', 'pending')$$,
  '{23514}', 'venue_checks refuses a status Gemini does not use', 'venue_checks_status_known'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action, run_id)
    values ('o-2', 'GEMI-X', 'filled', '50000000-0000-4000-8000-0000000000ff')$$,
  '{23503}', 'venue_checks refuses a run that does not exist', 'venue_checks_run_id_fkey'
);
-- Deleting a run deletes its orders.
select test.lives(
  $$delete from public.venue_check_runs where id = '50000000-0000-4000-8000-000000000001'$$,
  'a run can be deleted'
);
select test.count_is(
  $$select count(*) from public.venue_checks where venue_order_id = '73797746498585286'$$, 0,
  'deleting a run deletes its orders'
);

-- Order links: one per client order id, one per Gemini order id, placed only with an id.
select test.throws(
  $$insert into public.venue_order_links (client_order_id, venue, instrument, side, kind,
                                          limit_price_bps, qty, placed_at, venue_order_id, state)
    values ('vc-1-maker', 'gemini-sandbox', 'GEMI-X', 'buy', 'maker', 3600, 1000000, now(),
            null, 'pending')$$,
  '{23505}', 'venue_order_links refuses a second link of a client order id',
  'venue_order_links_pkey'
);
select test.throws(
  $$insert into public.venue_order_links (client_order_id, venue, instrument, side, kind,
                                          limit_price_bps, qty, placed_at, venue_order_id, state)
    values ('vc-2', 'gemini-sandbox', 'GEMI-X', 'buy', 'maker', 3600, 1000000, now(),
            '73797746498585286', 'placed')$$,
  '{23505}', 'venue_order_links refuses a Gemini order id linked twice',
  'venue_order_links_venue_order_key'
);
select test.throws(
  $$insert into public.venue_order_links (client_order_id, venue, instrument, side, kind,
                                          limit_price_bps, qty, placed_at, venue_order_id, state)
    values ('vc-3', 'gemini-sandbox', 'GEMI-X', 'buy', 'maker', 3600, 1000000, now(),
            null, 'placed')$$,
  '{23514}', 'venue_order_links refuses a placed order without its Gemini id',
  'venue_order_links_placed_has_id'
);
select test.throws(
  $$insert into public.venue_order_links (client_order_id, venue, instrument, side, kind,
                                          limit_price_bps, qty, placed_at, venue_order_id, state)
    values ('vc-4', 'gemini', 'GEMI-X', 'buy', 'maker', 3600, 1000000, now(), null, 'pending')$$,
  '{23514}', 'venue_order_links refuses Gemini production', 'venue_order_links_venue_known'
);
select test.throws(
  $$insert into public.venue_order_links (client_order_id, venue, instrument, side, kind,
                                          limit_price_bps, qty, placed_at, venue_order_id, state)
    values ('vc-5', 'gemini-sandbox', 'GEMI-X', 'buy', 'maker', 3600, 1000000, now(), null,
            'lost')$$,
  '{23514}', 'venue_order_links refuses an unknown state', 'venue_order_links_state_known'
);
select test.lives(
  $$insert into public.venue_order_links (client_order_id, venue, instrument, side, kind,
                                          limit_price_bps, qty, placed_at, venue_order_id, state)
    values ('vc-6', 'gemini-sandbox', 'GEMI-X', 'buy', 'taker', 5700, 1000000, now(), null,
            'pending')$$,
  'venue_order_links takes a pending placement without a Gemini id'
);
