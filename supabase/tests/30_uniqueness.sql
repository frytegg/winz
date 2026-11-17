-- Idempotency: every uniqueness constraint rejects a duplicate (sqlstate 23505), and it is the
-- intended constraint that fires. Each statement differs from the fixture in everything but the
-- column under test.

-- users: e-mail, Privy id, wallet.
select test.throws(
  $$insert into public.users (email) values ('maya@example.com')$$,
  '{23505}', 'users rejects a duplicate email', 'users_email_key'
);
select test.throws(
  $$insert into public.users (email, privy_id) values ('other@example.com', 'did:privy:maya')$$,
  '{23505}', 'users rejects a duplicate privy_id', 'users_privy_id_key'
);
select test.throws(
  $$insert into public.users (email, wallet)
    values ('other@example.com', '0x2222222222222222222222222222222222222222')$$,
  '{23505}', 'users rejects a duplicate wallet', 'users_wallet_key'
);
select test.throws(
  $$insert into public.users (email) values ('Maya@Example.com')$$,
  '{23514}', 'users rejects an email that is not lowercase', 'users_email_normalised'
);

-- merchants: one business per user.
select test.throws(
  $$insert into public.merchants (user_id, name, category)
    values ('00000000-0000-4000-8000-000000000001', 'Joe''s Bar', 'bar')$$,
  '{23505}', 'merchants rejects a second business for one user', 'merchants_user_id_key'
);

-- events, instruments: natural keys.
select test.throws(
  $$insert into public.events (
      ticker, title, sport, league, home_name, home_abbreviation, away_name, away_abbreviation,
      starts_at, sales_close_at
    ) values (
      'NCAAF-2611212030-ARK-TEX-M', 'Copy', 'football', 'NCAAF', 'A', 'A', 'B', 'B',
      '2026-11-22T20:30:00Z', '2026-11-22T20:25:00Z'
    )$$,
  '{23505}', 'events rejects a duplicate ticker', 'events_pkey'
);
select test.throws(
  $$insert into public.instruments (symbol, event_ticker, label, type, onchain_id)
    values (
      'GEMI-NCAAF-2611212030-ARK-TEX-M-TEX', 'NCAAF-2611212030-ARK-TEX-M', 'Copy', 'moneyline',
      '0x' || repeat('00', 32)
    )$$,
  '{23505}', 'instruments rejects a duplicate symbol', 'instruments_pkey'
);
select test.throws(
  $$insert into public.instruments (symbol, event_ticker, label, type, onchain_id)
    values (
      'GEMI-OTHER', 'NCAAF-2611212030-ARK-TEX-M', 'Copy', 'moneyline',
      '0x8678dbb9a92e72e47ca9fdd2f06501129215ca70e19ea506c3abc845fb70b16f'
    )$$,
  '{23505}', 'instruments rejects a duplicate onchain_id', 'instruments_onchain_id_key'
);

-- campaigns: slug, on-chain id, budget payment.
create function test.campaign_insert(onchain bigint, slug text, budget_pi text) returns text
language sql as $$
  select format(
    $f$insert into public.campaigns (
      onchain_id, merchant_id, instrument, event_ticker, product, condition_label, promise,
      unit_price, refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget,
      sales_close, slug, budget_pi
    ) values (
      %L, '00000000-0000-4000-8000-000000000002', 'GEMI-NCAAF-2611212030-ARK-TEX-M-TEX',
      'NCAAF-2611212030-ARK-TEX-M', 'Slice', 'Texas wins', '50%% back if Texas wins',
      5000000, 5000, 6500, 4700, 9000, 100000000, '2026-11-21T20:25:00Z', %L, %L
    )$f$,
    onchain, slug, budget_pi
  );
$$;

select test.throws(
  test.campaign_insert(2, 'joes-tex13', 'pi_budget_2'),
  '{23505}', 'campaigns rejects a duplicate slug', 'campaigns_slug_key'
);
select test.throws(
  test.campaign_insert(1, 'joes-other', 'pi_budget_2'),
  '{23505}', 'campaigns rejects a duplicate onchain_id', 'campaigns_onchain_id_key'
);
select test.throws(
  test.campaign_insert(2, 'joes-other', 'pi_budget_1'),
  '{23505}', 'campaigns rejects a duplicate budget_pi', 'campaigns_budget_pi_key'
);
select test.lives(
  test.campaign_insert(null, null, null),
  'campaigns accepts a draft without slug, onchain_id or budget_pi'
);
select test.lives(
  test.campaign_insert(null, null, null),
  'campaigns accepts a second draft without slug, onchain_id or budget_pi'
);

-- payments: one row per PaymentIntent, one ticket per payment (CO-3).
select test.throws(
  $$insert into public.payments (stripe_pi, campaign_id, qty, amount)
    values ('pi_test_1', '20000000-0000-4000-8000-000000000001', 2, 40000000)$$,
  '{23505}', 'payments rejects a duplicate stripe_pi', 'payments_pkey'
);
select test.throws(
  $$insert into public.payments (stripe_pi, campaign_id, qty, amount, ticket_id)
    values (
      'pi_test_2', '20000000-0000-4000-8000-000000000001', 1, 20000000,
      '30000000-0000-4000-8000-000000000001'
    )$$,
  '{23505}', 'payments rejects a second payment for one ticket', 'payments_ticket_id_key'
);

-- tickets: on-chain id, access token, payment, quote nonce.
create function test.ticket_insert(onchain bigint, token text, pi text, nonce numeric) returns text
language sql as $$
  select format(
    $f$insert into public.tickets (
      onchain_id, campaign_id, buyer, qty, paid, refundable, max_hedge_cost, access_token,
      payment_pi, quote_nonce
    ) values (
      %L, '20000000-0000-4000-8000-000000000001', '0x4444444444444444444444444444444444444444',
      2, 40000000, 40000000, 5500000, %L, %L, %L
    )$f$,
    onchain, token, pi, nonce
  );
$$;

select test.throws(
  test.ticket_insert(1, 'tok_ffffffffffffffffffff', null, 2),
  '{23505}', 'tickets rejects a duplicate onchain_id', 'tickets_onchain_id_key'
);
select test.throws(
  test.ticket_insert(2, 'tok_0123456789abcdef0123', null, 2),
  '{23505}', 'tickets rejects a duplicate access_token', 'tickets_access_token_key'
);
select test.throws(
  test.ticket_insert(2, 'tok_ffffffffffffffffffff', 'pi_test_1', 2),
  '{23505}', 'tickets rejects a second ticket for one payment', 'tickets_payment_pi_key'
);
select test.throws(
  test.ticket_insert(
    2, 'tok_ffffffffffffffffffff', null,
    115792089237316195423570985008687907853269984665640564039457584007913129639935
  ),
  '{23505}', 'tickets rejects a duplicate quote_nonce', 'tickets_quote_nonce_key'
);
select test.lives(
  test.ticket_insert(2, 'tok_ffffffffffffffffffff', null, 2),
  'tickets accepts a second ticket with its own ids (demo sale, no payment)'
);

-- chain_events: the same log seen by another source.
select test.throws(
  $$insert into public.chain_events (tx_hash, log_index, block_number, name, source)
    values ('0x' || repeat('ab', 32), 3, 1200, 'TicketPurchased', 'streams')$$,
  '{23505}', 'chain_events rejects a duplicate (tx_hash, log_index)', 'chain_events_pkey'
);
select test.count_is(
  $$with ins as (
      insert into public.chain_events (tx_hash, log_index, block_number, name, source)
      values ('0x' || repeat('ab', 32), 3, 1200, 'TicketPurchased', 'logs')
      on conflict (tx_hash, log_index) do nothing
      returning 1
    )
    select count(*) from ins$$,
  0, 'chain_events: on conflict do nothing inserts no second row'
);
select test.lives(
  $$insert into public.chain_events (tx_hash, log_index, block_number, name, source)
    values ('0x' || repeat('ab', 32), 4, 1200, 'HedgeCharged', 'logs')$$,
  'chain_events accepts another log of the same transaction'
);
select test.throws(
  $$insert into public.chain_cursor (name, block_number) values ('winz-escrow', 1)$$,
  '{23505}', 'chain_cursor rejects a duplicate name', 'chain_cursor_pkey'
);

-- chain_txs: idempotency key, and one nonce per signing key and chain. The fixture row holds
-- nonce 7 of 0x4444... on chain 5042002, for the relayer role.
select test.throws(
  $$insert into public.chain_txs (idempotency_key, signer, kind, to_address, data)
    values ('buy:pi_test_1', 'oracle', 'settle', '0x3333333333333333333333333333333333333333', '0x')$$,
  '{23505}', 'chain_txs rejects a duplicate idempotency_key', 'chain_txs_idempotency_key_key'
);
select test.throws(
  $$insert into public.chain_txs (idempotency_key, signer, kind, to_address, data, nonce, signer_address, chain_id)
    values ('buy:pi_test_2', 'relayer', 'buyFor', '0x3333333333333333333333333333333333333333', '0x', 7,
            '0x4444444444444444444444444444444444444444', 5042002)$$,
  '{23505}', 'chain_txs rejects a duplicate (signer_address, chain_id, nonce)',
  'chain_txs_address_chain_nonce_key'
);
select test.throws(
  $$insert into public.chain_txs (idempotency_key, signer, kind, to_address, data, nonce, signer_address, chain_id)
    values ('settle:0', 'oracle', 'settle', '0x3333333333333333333333333333333333333333', '0x', 7,
            '0x4444444444444444444444444444444444444444', 5042002)$$,
  '{23505}', 'chain_txs rejects the same nonce of the same key and chain for the other role',
  'chain_txs_address_chain_nonce_key'
);
select test.lives(
  $$insert into public.chain_txs (idempotency_key, signer, kind, to_address, data, nonce, signer_address, chain_id)
    values ('buy:pi_test_5', 'relayer', 'buyFor', '0x3333333333333333333333333333333333333333', '0x', 7,
            '0x5555555555555555555555555555555555555555', 5042002)$$,
  'chain_txs accepts the same nonce for another address, in the same role (key rotation)'
);
select test.lives(
  $$insert into public.chain_txs (idempotency_key, signer, kind, to_address, data, nonce, signer_address, chain_id)
    values ('settle:1', 'oracle', 'settle', '0x3333333333333333333333333333333333333333', '0x', 7,
            '0x6666666666666666666666666666666666666666', 5042002)$$,
  'chain_txs accepts the same nonce for another address in the other role'
);
select test.lives(
  $$insert into public.chain_txs (idempotency_key, signer, kind, to_address, data, nonce, signer_address, chain_id)
    values ('buy:pi_test_6', 'relayer', 'buyFor', '0x3333333333333333333333333333333333333333', '0x', 7,
            '0x4444444444444444444444444444444444444444', 1)$$,
  'chain_txs accepts the same nonce of the same key on another chain'
);
select test.lives(
  $$insert into public.chain_txs (idempotency_key, signer, kind, to_address, data)
    values
      ('buy:pi_test_3', 'relayer', 'buyFor', '0x3333333333333333333333333333333333333333', '0x'),
      ('buy:pi_test_4', 'relayer', 'buyFor', '0x3333333333333333333333333333333333333333', '0x')$$,
  'chain_txs accepts several queued rows without a nonce'
);

-- jobs: idempotency key, nullable.
select test.throws(
  $$insert into public.jobs (kind, idempotency_key) values ('purchase', 'purchase:pi_test_1')$$,
  '{23505}', 'jobs rejects a duplicate idempotency_key', 'jobs_idempotency_key_key'
);
select test.lives(
  $$insert into public.jobs (kind) values ('reconcile'), ('reconcile')$$,
  'jobs accepts several rows without an idempotency_key'
);
select test.count_is(
  $$with taken as (
      select id from public.jobs
      where status = 'queued' and run_at <= now()
      order by run_at
      limit 1
      for update skip locked
    ),
    upd as (
      update public.jobs j
      set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = 'worker-1'
      from taken
      where j.id = taken.id
      returning 1
    )
    select count(*) from upd$$,
  1, 'jobs: a worker claims one queued job with for update skip locked'
);

-- Hedging engine.
select test.throws(
  $$insert into public.lots (ticket_id, campaign_id, instrument, qty, max_hedge_cost)
    values (
      '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 1, 1
    )$$,
  '{23505}', 'lots rejects a second lot for one ticket', 'lots_ticket_id_key'
);
select test.throws(
  $$insert into public.positions (instrument) values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13')$$,
  '{23505}', 'positions rejects a second row for one instrument', 'positions_pkey'
);
select test.throws(
  $$insert into public.orders (instrument, side, kind, price_bps, qty, venue, venue_order_id)
    values ('GEMI-NCAAF-2611212030-ARK-TEX-M-TEX', 'buy', 'taker', 9100, 1, 'paper', 'paper-1')$$,
  '{23505}', 'orders rejects a duplicate (venue, venue_order_id)', 'orders_venue_order_id_key'
);
select test.throws(
  $$insert into public.fills (order_id, price_bps, qty, venue_fill_id)
    values ('60000000-0000-4000-8000-000000000001', 1200, 1, 'paper-fill-1')$$,
  '{23505}', 'fills rejects a duplicate venue fill of one order', 'fills_venue_fill_id_key'
);
select test.throws(
  $$insert into public.lot_fills (lot_id, fill_id, qty, cost)
    values (
      '50000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 1, 1
    )$$,
  '{23505}', 'lot_fills rejects a second allocation of one fill to one lot', 'lot_fills_lot_fill_key'
);
select test.throws(
  $$insert into public.engine_pnl (event_ticker) values ('NCAAF-2611212030-ARK-TEX-M')$$,
  '{23505}', 'engine_pnl rejects a second row for one event', 'engine_pnl_pkey'
);
select test.throws(
  $$insert into public.engine_params (key, value) values ('uMaxMicroUsdc', '"1"')$$,
  '{23505}', 'engine_params rejects a duplicate key', 'engine_params_pkey'
);
select test.throws(
  $$insert into public.demo_overrides (instrument) values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX20')$$,
  '{23505}', 'demo_overrides rejects a second row for one instrument', 'demo_overrides_pkey'
);
select test.throws(
  $$insert into public.venue_checks (venue_order_id, instrument, action)
    values ('sbx-1', 'btcusd', 'placed_maker')$$,
  '{23505}', 'venue_checks rejects a duplicate (venue_order_id, action)', 'venue_checks_order_action_key'
);
select test.throws(
  $$insert into public.push_subscriptions (user_id, endpoint, keys)
    values ('00000000-0000-4000-8000-000000000001', 'https://push.example.com/sub/1', '{}')$$,
  '{23505}', 'push_subscriptions rejects a duplicate endpoint', 'push_subscriptions_endpoint_key'
);

-- Public tables.
select test.throws(
  $$insert into public.live_instruments (symbol) values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13')$$,
  '{23505}', 'live_instruments rejects a duplicate symbol', 'live_instruments_pkey'
);
select test.throws(
  $$insert into public.live_campaigns (slug, sale_state) values ('joes-tex13', 'closed')$$,
  '{23505}', 'live_campaigns rejects a duplicate slug', 'live_campaigns_pkey'
);
select test.throws(
  $$insert into public.live_hedge_desk (instrument, payload)
    values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', '{}')$$,
  '{23505}', 'live_hedge_desk rejects a duplicate instrument', 'live_hedge_desk_pkey'
);

-- FIFO order of lots follows insertion.
insert into public.lots (ticket_id, campaign_id, instrument, qty, max_hedge_cost)
select id, campaign_id, 'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 40000000, 5500000
from public.tickets where access_token = 'tok_ffffffffffffffffffff';

select test.ok(
  (
    select array_agg(ticket_id order by seq) from public.lots
    where instrument = 'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13'
  ) = array[
    '30000000-0000-4000-8000-000000000001'::uuid,
    (select id from public.tickets where access_token = 'tok_ffffffffffffffffffff')
  ],
  'lots are ordered by seq in arrival order'
);
select test.throws(
  $$insert into public.lots (seq, ticket_id, campaign_id, instrument, qty, max_hedge_cost)
    select 1, id, campaign_id, 'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 1, 1 from public.tickets limit 1$$,
  '{428C9}', 'lots.seq cannot be chosen by the writer'
);
