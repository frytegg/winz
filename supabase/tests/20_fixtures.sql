-- One valid row in every table, on top of the seed. Proves that well-formed data is accepted, and
-- gives the later files something to duplicate and something for `anon` not to see.
-- A statement that fails here stops the file: run.sh reports it as a failure.

insert into public.users (id, email, privy_id, wallet, roles)
values (
  '10000000-0000-4000-8000-000000000001', 'maya@example.com', 'did:privy:maya',
  '0x2222222222222222222222222222222222222222', array['fan']
);

insert into public.campaigns (
  id, onchain_id, merchant_id, instrument, event_ticker, product, condition_label, promise,
  unit_price, refund_bps, usual_margin_bps, min_margin_bps, pause_threshold_bps, budget,
  sales_close, status, sale_state, slug, budget_pi, live_at
)
values (
  '20000000-0000-4000-8000-000000000001', 1, '00000000-0000-4000-8000-000000000002',
  'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 'NCAAF-2611212030-ARK-TEX-M', 'Large pizza',
  'Texas wins by 14+', '100% back if Texas wins by 14+',
  20000000, 10000, 6500, 4700, 1800, 500000000,
  '2026-11-21T20:25:00Z', 'live', 'open', 'joes-tex13', 'pi_budget_1', now()
);

insert into public.payments (stripe_pi, campaign_id, email, buyer, qty, amount, status)
values (
  'pi_test_1', '20000000-0000-4000-8000-000000000001', 'maya@example.com',
  '0x2222222222222222222222222222222222222222', 1, 20000000, 'processing'
);

insert into public.tickets (
  id, onchain_id, campaign_id, buyer, qty, paid, refundable, max_hedge_cost, quote_nonce,
  access_token, tx_hash, payment_pi
)
values (
  '30000000-0000-4000-8000-000000000001', 1, '20000000-0000-4000-8000-000000000001',
  '0x2222222222222222222222222222222222222222', 1, 20000000, 20000000, 2750000,
  115792089237316195423570985008687907853269984665640564039457584007913129639935,
  'tok_0123456789abcdef0123', '0x' || repeat('ab', 32), 'pi_test_1'
);

update public.payments
set status = 'ticketed', ticket_id = '30000000-0000-4000-8000-000000000001'
where stripe_pi = 'pi_test_1';

insert into public.chain_events (tx_hash, log_index, block_number, block_time, name, args, source)
values (
  '0x' || repeat('ab', 32), 3, 1200, now(), 'TicketPurchased',
  '{"ticketId": "1", "id": "1"}', 'receipt'
);

insert into public.chain_cursor (name, block_number) values ('winz-escrow', 1200);

insert into public.chain_txs (
  id, idempotency_key, signer, kind, to_address, data, nonce, signer_address, chain_id, tx_hash,
  status, sent_at
)
values (
  '40000000-0000-4000-8000-000000000001', 'buy:pi_test_1', 'relayer', 'buyFor',
  '0x3333333333333333333333333333333333333333', '0xdeadbeef', 7,
  '0x4444444444444444444444444444444444444444', 5042002, '0x' || repeat('ab', 32), 'sent', now()
);

insert into public.lots (id, ticket_id, campaign_id, instrument, qty, max_hedge_cost)
values (
  '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13',
  20000000, 2750000
);

insert into public.positions (instrument, exposure, held, working, venue)
values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 20000000, 0, 20000000, 'paper');

insert into public.orders (id, instrument, side, kind, price_bps, qty, status, venue, venue_order_id)
values (
  '60000000-0000-4000-8000-000000000001', 'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13',
  'buy', 'maker', 1200, 20000000, 'working', 'paper', 'paper-1'
);

insert into public.fills (id, order_id, price_bps, qty, fee, book_ref, venue_fill_id)
values (
  '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
  1200, 10000000, 1000, '{"bids": [], "asks": [], "observedAtMs": 0}', 'paper-fill-1'
);

insert into public.lot_fills (lot_id, fill_id, qty, cost)
values (
  '50000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  10000000, 1201000
);

insert into public.engine_pnl (event_ticker, maker_savings)
values ('NCAAF-2611212030-ARK-TEX-M', 5000);

insert into public.engine_params (key, value) values ('uMaxMicroUsdc', '"300000000"');

insert into public.demo_overrides (instrument, book, forced_result)
values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX20', '{"bids": [], "asks": []}', null);

insert into public.venue_checks (venue_order_id, instrument, action)
values ('sbx-1', 'btcusd', 'placed_maker');

insert into public.push_subscriptions (user_id, endpoint, keys)
values (
  '10000000-0000-4000-8000-000000000001', 'https://push.example.com/sub/1',
  '{"p256dh": "x", "auth": "y"}'
);

insert into public.jobs (kind, payload, idempotency_key)
values ('purchase', '{"pi": "pi_test_1"}', 'purchase:pi_test_1');

insert into public.live_instruments (symbol, bid_bps, ask_bps, mid_bps, stale)
values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', 1150, 1250, 1200, false);

insert into public.live_campaigns (slug, sale_state, sales, exposure, hedged_bps)
values ('joes-tex13', 'open', 1, 20000000, 5000);

insert into public.live_hedge_desk (instrument, payload)
values ('GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13', '{"exposure": "20000000"}');

insert into public.book_cache (symbol, bids, asks, observed_at, source)
values (
  'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13',
  '[{"priceBps": 1100, "qty": "100000000"}]'::jsonb,
  '[{"priceBps": 1300, "qty": "250000000"}]'::jsonb,
  now(), 'rest'
);

insert into public.tracked_instruments (symbol, expires_at)
values ('GEMI-NCAAF-2611212030-ARK-TEX-M-TEX', now() + interval '10 minutes');

-- A top-up of the campaign's budget, credited on-chain (CA-6).
insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount, status, tx_hash)
values (
  '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'pi_top_up_1', 250000000, 'credited', '0x' || repeat('cd', 32)
);

-- The engine lease, held by one engine process (apps/engine/src/leader).
insert into public.engine_lease (name, holder, acquired_at, renewed_at, expires_at)
values ('engine', 'eng-0123456789ab', now(), now(), now() + interval '15 seconds');

-- The chain and escrow this database belongs to, recorded by the first engine on it
-- (apps/engine/src/chain/engine-identity.ts).
insert into public.engine_identity (chain_id, escrow_address)
values (5042002, '0x81d2d4050e617184b2b832c30be68f8811b37d2c');

-- The seed and the fixtures together put at least one row in every table.
select test.count_is(
  format('select count(*) from (select 1 from public.%I limit 1) t', t.name),
  1,
  format('%s holds at least one row', t.name)
)
from (select name from test.private_tables union all select name from test.live_tables) t;
