-- Check constraints: a bad enum value, a negative amount, an out-of-range rate and a malformed
-- address or hash are rejected (sqlstate 23514), by the intended constraint.

-- Enums.
select test.throws(
  $$update public.users set roles = array['admin'] where email = 'maya@example.com'$$,
  '{23514}', 'users rejects an unknown role', 'users_roles_known'
);
select test.throws(
  $$update public.merchants set category = 'cafe'$$,
  '{23514}', 'merchants rejects an unknown category', 'merchants_category_known'
);
select test.throws(
  $$update public.events set sport = 'cricket'$$,
  '{23514}', 'events rejects an unknown sport', 'events_sport_known'
);
select test.throws(
  $$update public.events set status = 'postponed'$$,
  '{23514}', 'events rejects an unknown status', 'events_status_known'
);
select test.lives(
  format('update public.events set status = %L', x.status),
  format('events accepts the status %s', x.status)
)
from (values ('upcoming'), ('closed'), ('settled'), ('void'), ('active')) as x (status);
select test.throws(
  $$update public.events set status = 'approved'$$,
  '{23514}', 'events rejects Gemini''s raw status, which belongs in gemini_status',
  'events_status_known'
);
select test.lives(
  $$update public.events set gemini_status = 'approved', synced_at = now()$$,
  'events accepts any gemini_status'
);
select test.throws(
  $$update public.events set result = 'maybe'$$,
  '{23514}', 'events rejects an unknown result', 'events_result_known'
);
select test.throws(
  $$update public.instruments set type = 'parlay'$$,
  '{23514}', 'instruments rejects an unknown type', 'instruments_type_known'
);
select test.throws(
  $$update public.instruments set side = 'draw'$$,
  '{23514}', 'instruments rejects an unknown side', 'instruments_side_known'
);
select test.throws(
  $$update public.instruments set outcome = 'won', settled_at = now()$$,
  '{23514}', 'instruments rejects an unknown outcome', 'instruments_outcome_known'
);
select test.throws(
  $$update public.campaigns set status = 'Live'$$,
  '{23514}', 'campaigns rejects an unknown status', 'campaigns_status_known'
);
select test.throws(
  $$update public.campaigns set sale_state = 'paused'$$,
  '{23514}', 'campaigns rejects an unknown sale_state', 'campaigns_sale_state_known'
);
select test.throws(
  $$update public.campaigns set outcome = 'YES'$$,
  '{23514}', 'campaigns rejects an unknown outcome', 'campaigns_outcome_known'
);
select test.throws(
  $$update public.payments set status = 'captured'$$,
  '{23514}', 'payments rejects an unknown status', 'payments_status_known'
);
select test.throws(
  $$update public.tickets set status = 'lost'$$,
  '{23514}', 'tickets rejects an unknown status', 'tickets_status_known'
);
select test.throws(
  $$update public.chain_events set source = 'webhook'$$,
  '{23514}', 'chain_events rejects an unknown source', 'chain_events_source_known'
);
select test.throws(
  $$update public.chain_txs set signer = 'treasury'$$,
  '{23514}', 'chain_txs rejects an unknown signer', 'chain_txs_signer_known'
);
select test.throws(
  $$update public.chain_txs set status = 'pending'$$,
  '{23514}', 'chain_txs rejects an unknown status', 'chain_txs_status_known'
);
select test.throws(
  $$update public.positions set venue = 'kalshi'$$,
  '{23514}', 'positions rejects an unknown venue', 'positions_venue_known'
);
select test.throws(
  $$update public.orders set side = 'short'$$,
  '{23514}', 'orders rejects an unknown side', 'orders_side_known'
);
select test.throws(
  $$update public.orders set kind = 'market'$$,
  '{23514}', 'orders rejects an unknown kind', 'orders_kind_known'
);
select test.throws(
  $$update public.orders set status = 'open'$$,
  '{23514}', 'orders rejects an unknown status', 'orders_status_known'
);
select test.throws(
  $$update public.orders set venue = 'kalshi'$$,
  '{23514}', 'orders rejects an unknown venue', 'orders_venue_known'
);
select test.throws(
  $$update public.demo_overrides set forced_result = 'draw'$$,
  '{23514}', 'demo_overrides rejects an unknown forced_result', 'demo_overrides_forced_result_known'
);
select test.throws(
  $$update public.venue_checks set action = 'amended'$$,
  '{23514}', 'venue_checks rejects an unknown action', 'venue_checks_action_known'
);
select test.throws(
  $$update public.jobs set status = 'pending'$$,
  '{23514}', 'jobs rejects an unknown status', 'jobs_status_known'
);
select test.throws(
  $$update public.live_campaigns set sale_state = 'paused'$$,
  '{23514}', 'live_campaigns rejects an unknown sale_state', 'live_campaigns_sale_state_known'
);
select test.throws(
  $$update public.live_campaigns set outcome = 'draw'$$,
  '{23514}', 'live_campaigns rejects an unknown outcome', 'live_campaigns_outcome_known'
);

-- Negative money and quantities.
select test.throws(
  format('update public.%I set %I = -1', x.tbl, x.col),
  '{23514}', format('%s rejects a negative %s', x.tbl, x.col), x.con
)
from (
  values
    ('campaigns', 'unit_price', 'campaigns_unit_price_range'),
    ('campaigns', 'budget', 'campaigns_budget_range'),
    ('campaigns', 'onchain_id', 'campaigns_onchain_id_range'),
    ('payments', 'amount', 'payments_amount_range'),
    ('tickets', 'paid', 'tickets_paid_range'),
    ('tickets', 'refundable', 'tickets_refundable_range'),
    ('tickets', 'max_hedge_cost', 'tickets_max_hedge_cost_range'),
    ('tickets', 'onchain_id', 'tickets_onchain_id_range'),
    ('tickets', 'quote_nonce', 'tickets_quote_nonce_range'),
    ('chain_events', 'block_number', 'chain_events_block_number_range'),
    ('chain_events', 'log_index', 'chain_events_log_index_range'),
    ('chain_cursor', 'block_number', 'chain_cursor_block_number_range'),
    ('chain_txs', 'value', 'chain_txs_value_range'),
    ('chain_txs', 'nonce', 'chain_txs_nonce_range'),
    ('chain_txs', 'attempts', 'chain_txs_attempts_range'),
    -- A negative qty also breaks filled_qty <= qty, and Postgres reports that check first.
    ('lots', 'qty', null),
    ('lots', 'max_hedge_cost', 'lots_max_hedge_cost_range'),
    ('lots', 'filled_qty', 'lots_filled_qty_range'),
    ('lots', 'cost', 'lots_cost_range'),
    ('positions', 'exposure', 'positions_exposure_range'),
    ('positions', 'held', 'positions_held_range'),
    ('positions', 'working', 'positions_working_range'),
    ('orders', 'qty', null),
    ('orders', 'filled_qty', 'orders_filled_qty_range'),
    ('fills', 'qty', 'fills_qty_range'),
    ('fills', 'fee', 'fills_fee_range'),
    ('lot_fills', 'qty', 'lot_fills_qty_range'),
    ('lot_fills', 'cost', 'lot_fills_cost_range'),
    ('engine_pnl', 'maker_savings', 'engine_pnl_maker_savings_range'),
    ('engine_pnl', 'guarantee_losses', 'engine_pnl_guarantee_losses_range'),
    ('engine_pnl', 'crossing_gains', 'engine_pnl_crossing_gains_range'),
    ('jobs', 'attempts', 'jobs_attempts_range'),
    ('live_campaigns', 'sales', 'live_campaigns_sales_range'),
    ('live_campaigns', 'exposure', 'live_campaigns_exposure_range')
) as x (tbl, col, con);

select test.throws(
  $$update public.payments set qty = 0$$,
  '{23514}', 'payments rejects a quantity of zero', 'payments_qty_range'
);
select test.throws(
  $$update public.tickets set qty = 0$$,
  '{23514}', 'tickets rejects a quantity of zero', 'tickets_qty_range'
);

-- Basis points out of range.
select test.throws(
  format('update public.%I set %I = %s', x.tbl, x.col, x.bad),
  '{23514}', format('%s rejects %s = %s', x.tbl, x.col, x.bad), x.con
)
from (
  values
    ('campaigns', 'refund_bps', 0, 'campaigns_refund_bps_range'),
    ('campaigns', 'refund_bps', 10001, 'campaigns_refund_bps_range'),
    ('campaigns', 'usual_margin_bps', 10001, 'campaigns_usual_margin_bps_range'),
    ('campaigns', 'min_margin_bps', -1, 'campaigns_min_margin_bps_range'),
    ('campaigns', 'pause_threshold_bps', 10001, 'campaigns_pause_threshold_bps_range'),
    ('orders', 'price_bps', 10001, 'orders_price_bps_range'),
    ('fills', 'price_bps', -1, 'fills_price_bps_range'),
    ('instruments', 'best_bid_bps', -1, 'instruments_best_bid_bps_range'),
    ('instruments', 'best_bid_bps', 10001, 'instruments_best_bid_bps_range'),
    ('instruments', 'best_ask_bps', -1, 'instruments_best_ask_bps_range'),
    ('instruments', 'best_ask_bps', 10001, 'instruments_best_ask_bps_range'),
    ('live_instruments', 'bid_bps', -1, 'live_instruments_bid_bps_range'),
    ('live_instruments', 'ask_bps', 10001, 'live_instruments_ask_bps_range'),
    ('live_instruments', 'mid_bps', 10001, 'live_instruments_mid_bps_range'),
    ('live_campaigns', 'hedged_bps', 10001, 'live_campaigns_hedged_bps_range')
) as x (tbl, col, bad, con);

-- Cross-column rules.
select test.throws(
  $$update public.instruments set outcome = 'yes'$$,
  '{23514}', 'instruments rejects an outcome without settled_at',
  'instruments_settled_at_with_outcome'
);
select test.throws(
  $$update public.instruments set settled_at = now()$$,
  '{23514}', 'instruments rejects settled_at without an outcome',
  'instruments_settled_at_with_outcome'
);
select test.throws(
  $$update public.campaigns set min_margin_bps = usual_margin_bps + 1 where slug = 'joes-tex13'$$,
  '{23514}', 'campaigns rejects a minimum margin above the usual margin', 'campaigns_margins_ordered'
);
select test.throws(
  $$update public.tickets set refundable = paid + 1$$,
  '{23514}', 'tickets rejects a refundable amount above the amount paid', 'tickets_refundable_range'
);
select test.throws(
  $$update public.lots set filled_qty = qty + 1$$,
  '{23514}', 'lots rejects a filled quantity above the lot', 'lots_filled_qty_range'
);
select test.throws(
  $$update public.lots set charged = true, charged_amount = max_hedge_cost + 1$$,
  '{23514}', 'lots rejects a charge above the guaranteed cost', 'lots_charged_amount_range'
);
select test.throws(
  $$update public.lots set charged = true$$,
  '{23514}', 'lots rejects charged without an amount', 'lots_charged_has_amount'
);
select test.throws(
  $$update public.orders set filled_qty = qty + 1$$,
  '{23514}', 'orders rejects a filled quantity above the order', 'orders_filled_qty_range'
);
select test.throws(
  $$update public.events set sales_close_at = starts_at + interval '1 minute'$$,
  '{23514}', 'events rejects sales closing after the start', 'events_sales_close_before_start'
);

-- Addresses, hashes, slugs.
select test.throws(
  $$update public.users set wallet = '0x2222222222222222222222222222222222222222AA'
    where email = 'maya@example.com'$$,
  '{23514}', 'users rejects a malformed wallet', 'users_wallet_format'
);
select test.throws(
  $$update public.users set wallet = '0xABCDEF2222222222222222222222222222222222'
    where email = 'maya@example.com'$$,
  '{23514}', 'users rejects a wallet that is not lowercase', 'users_wallet_format'
);
select test.throws(
  $$update public.tickets set buyer = 'maya'$$,
  '{23514}', 'tickets rejects a malformed buyer', 'tickets_buyer_format'
);
select test.throws(
  $$update public.tickets set tx_hash = '0x1234'$$,
  '{23514}', 'tickets rejects a malformed tx_hash', 'tickets_tx_hash_format'
);
select test.throws(
  $$update public.payments set buyer = '0x123'$$,
  '{23514}', 'payments rejects a malformed buyer', 'payments_buyer_format'
);
select test.throws(
  $$update public.payments set email = 'Maya@Example.com'$$,
  '{23514}', 'payments rejects an email that is not lowercase', 'payments_email_normalised'
);
select test.throws(
  $$insert into public.chain_events (tx_hash, log_index, block_number, name, source)
    values ('0x' || repeat('AB', 32), 0, 1, 'TicketPurchased', 'logs')$$,
  '{23514}', 'chain_events rejects a tx_hash that is not lowercase', 'chain_events_tx_hash_format'
);
select test.throws(
  $$update public.chain_txs set to_address = '0x0'$$,
  '{23514}', 'chain_txs rejects a malformed to_address', 'chain_txs_to_address_format'
);
select test.throws(
  $$update public.chain_txs set data = '0xabc'$$,
  '{23514}', 'chain_txs rejects calldata with an odd number of digits', 'chain_txs_data_format'
);
select test.throws(
  $$update public.chain_txs set tx_hash = 'abc'$$,
  '{23514}', 'chain_txs rejects a malformed tx_hash', 'chain_txs_tx_hash_format'
);
select test.throws(
  $$update public.instruments set onchain_id = 'TEX13' where symbol = 'GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13'$$,
  '{23514}', 'instruments rejects a malformed onchain_id', 'instruments_onchain_id_format'
);
select test.throws(
  $$update public.campaigns set slug = 'Joes Pizza' where slug = 'joes-tex13'$$,
  '{23514}', 'campaigns rejects a malformed slug', 'campaigns_slug_format'
);
select test.throws(
  $$insert into public.live_campaigns (slug, sale_state) values ('-bad-', 'open')$$,
  '{23514}', 'live_campaigns rejects a malformed slug', 'live_campaigns_slug_format'
);

-- Foreign keys hold the money records together.
select test.throws(
  $$delete from public.campaigns where slug = 'joes-tex13'$$,
  '{23503,23001}', 'a campaign with payments and tickets cannot be deleted'
);
select test.throws(
  $$delete from public.tickets where onchain_id = 1$$,
  '{23503,23001}', 'a ticket with a lot cannot be deleted'
);
select test.throws(
  $$delete from public.events where ticker = 'NCAAF-2611212030-ARK-TEX-M'$$,
  '{23503,23001}', 'an event with campaigns cannot be deleted'
);
select test.throws(
  $$insert into public.instruments (symbol, event_ticker, label, type, onchain_id)
    values ('GEMI-ORPHAN', 'NO-SUCH-EVENT', 'Orphan', 'moneyline', '0x' || repeat('11', 32))$$,
  '{23503}', 'an instrument needs its event'
);

-- updated_at is set by the trigger, whatever the writer sends.
update public.campaigns set updated_at = '2000-01-01T00:00:00Z' where slug = 'joes-tex13';
select test.ok(
  (select updated_at > now() - interval '1 minute' from public.campaigns where slug = 'joes-tex13'),
  'campaigns.updated_at is set by the trigger on update'
);
update public.live_campaigns set updated_at = '2000-01-01T00:00:00Z' where slug = 'joes-tex13';
select test.ok(
  (select updated_at > now() - interval '1 minute' from public.live_campaigns where slug = 'joes-tex13'),
  'live_campaigns.updated_at is set by the trigger on update'
);

-- Catalogue sync (M-01): what the sync writes is accepted, and a delisted instrument stays.
select test.lives(
  $$update public.instruments
    set side = 'home', best_bid_bps = 0, best_ask_bps = 10000, active = false, synced_at = now()
    where symbol = 'GEMI-NCAAF-2611212030-ARK-TEX-M-TEX'$$,
  'instruments accepts a side, the two ends of the price range and active = false'
);
select test.lives(
  $$update public.instruments set outcome = 'void', settled_at = now()
    where symbol = 'GEMI-NCAAF-2611212030-ARK-TEX-M-ARK'$$,
  'instruments accepts an outcome with its settled_at'
);
select test.count_is(
  $$select count(*) from public.instruments where active$$, 3,
  'instruments are active by default'
);
