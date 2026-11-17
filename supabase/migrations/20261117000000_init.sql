-- Winz: initial schema (task D-01, SPEC section 10).
--
-- Conventions, valid for every table of this file:
--   money              bigint, micro-USDC (6 decimals), check (x >= 0)
--   contract quantity  bigint, micro-contracts, check (x >= 0)
--   rates and prices   integer, basis points, column name ends in _bps, range check
--   time               timestamptz (UTC)
--   primary key        uuid default gen_random_uuid(), unless a natural key exists
--   uint256            numeric(78,0)
--   on-chain ids       bigint
--   addresses, hashes  lowercase text with a format check
--   enums              text + check (col in (...)), same strings as packages/shared/src/domain.ts
--
-- Access model (SPEC section 7): the backend and the engine connect with the service role, which
-- bypasses row level security. RLS is enabled on every table and the only policies are `select`
-- on the three public live_* tables, which the browser reads through Supabase Realtime.
-- Roles `anon` and `authenticated` exist on every Supabase project.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Keeps updated_at truthful whoever writes the row.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------

-- users: one row per e-mail (ID-1, ID-2). The e-mail is normalised (lowercase, trimmed) before it
-- gets here; the wallet is the Privy embedded wallet, pre-generated at the first purchase for a fan.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  privy_id text,
  wallet text,
  roles text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_key unique (email),
  constraint users_privy_id_key unique (privy_id),
  constraint users_wallet_key unique (wallet),
  constraint users_email_normalised check (email = lower(btrim(email)) and email <> ''),
  constraint users_wallet_format check (wallet ~ '^0x[0-9a-f]{40}$'),
  constraint users_roles_known check (roles <@ array['merchant', 'fan']::text[])
);

create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- merchants: the business of a merchant user (screen M2). One business per user.
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  name text not null,
  category text not null,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchants_user_id_key unique (user_id),
  constraint merchants_name_length check (char_length(name) between 1 and 80),
  constraint merchants_category_known check (category in ('bar', 'pizza', 'burger', 'retail', 'other'))
);

create trigger merchants_set_updated_at before update on public.merchants
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Market catalogue (synchronised from Gemini, MD-1 and MD-3)
-- ---------------------------------------------------------------------------------------------

-- events: one Gemini event (a game). `result` is set when Gemini settles it.
create table public.events (
  ticker text primary key,
  title text not null,
  sport text not null,
  league text not null,
  home_name text not null,
  home_abbreviation text not null,
  home_logo_url text,
  away_name text not null,
  away_abbreviation text not null,
  away_logo_url text,
  starts_at timestamptz not null,
  sales_close_at timestamptz not null,
  status text not null default 'active',
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_sport_known
    check (sport in ('football', 'basketball', 'hockey', 'baseball', 'soccer', 'other')),
  constraint events_status_known check (status in ('active', 'closed', 'settled')),
  constraint events_result_known check (result in ('yes', 'no', 'void')),
  constraint events_sales_close_before_start check (sales_close_at <= starts_at)
);

create index events_starts_at_idx on public.events (starts_at);
create index events_sport_idx on public.events (sport, starts_at);

create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- instruments: one tradable Gemini contract of an event (moneyline, spread, total).
-- `onchain_id` is keccak256(symbol), the bytes32 the escrow contract stores for a campaign.
create table public.instruments (
  symbol text primary key,
  event_ticker text not null references public.events (ticker) on delete cascade,
  label text not null,
  type text not null,
  strike numeric(10, 2),
  onchain_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instruments_onchain_id_key unique (onchain_id),
  constraint instruments_type_known check (type in ('moneyline', 'spread', 'total')),
  constraint instruments_onchain_id_format check (onchain_id ~ '^0x[0-9a-f]{64}$')
);

create index instruments_event_ticker_idx on public.instruments (event_ticker);

create trigger instruments_set_updated_at before update on public.instruments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Campaigns, payments, tickets
-- ---------------------------------------------------------------------------------------------

-- campaigns: the off-chain record of a promo (CA-2, CA-4). `onchain_id` and `slug` are null until
-- the creation job has written the campaign on-chain; `budget_pi` is the Stripe payment of the
-- budget, which is what makes the creation job idempotent.
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  onchain_id bigint,
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  instrument text not null references public.instruments (symbol) on delete restrict,
  event_ticker text not null references public.events (ticker) on delete restrict,
  product text not null,
  condition_label text not null,
  promise text not null,
  unit_price bigint not null,
  refund_bps integer not null,
  usual_margin_bps integer not null,
  min_margin_bps integer not null,
  pause_threshold_bps integer not null,
  budget bigint not null,
  sales_close timestamptz not null,
  status text not null default 'draft',
  sale_state text not null default 'closed',
  slug text,
  outcome text,
  budget_pi text,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  live_at timestamptz,
  constraint campaigns_onchain_id_key unique (onchain_id),
  constraint campaigns_slug_key unique (slug),
  constraint campaigns_budget_pi_key unique (budget_pi),
  constraint campaigns_onchain_id_range check (onchain_id >= 0),
  constraint campaigns_product_length check (char_length(product) between 1 and 80),
  constraint campaigns_unit_price_range check (unit_price >= 0),
  constraint campaigns_budget_range check (budget >= 0),
  constraint campaigns_refund_bps_range check (refund_bps between 1 and 10000),
  constraint campaigns_usual_margin_bps_range check (usual_margin_bps between 0 and 10000),
  constraint campaigns_min_margin_bps_range check (min_margin_bps between 0 and 10000),
  constraint campaigns_margins_ordered check (min_margin_bps <= usual_margin_bps),
  constraint campaigns_pause_threshold_bps_range check (pause_threshold_bps between 0 and 10000),
  constraint campaigns_status_known check (
    status in (
      'draft', 'funding', 'live', 'paused', 'sales_closed',
      'settled_yes', 'settled_no', 'void', 'closed'
    )
  ),
  constraint campaigns_sale_state_known check (
    sale_state in (
      'open', 'paused_price', 'paused_budget', 'paused_depth',
      'paused_stale', 'paused_breaker', 'paused_manual', 'closed'
    )
  ),
  constraint campaigns_outcome_known check (outcome in ('yes', 'no', 'void')),
  constraint campaigns_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);

create index campaigns_merchant_id_idx on public.campaigns (merchant_id, created_at desc);
create index campaigns_instrument_idx on public.campaigns (instrument, status);
create index campaigns_event_ticker_idx on public.campaigns (event_ticker);

create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

-- payments: one Stripe PaymentIntent of a customer purchase (CO-2, CO-3). The primary key is the
-- PaymentIntent id, so the webhook and the client confirmation land on the same row, and
-- `ticket_id` is unique: one payment creates at most one ticket.
create table public.payments (
  stripe_pi text primary key,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  email text,
  buyer text,
  qty integer not null,
  amount bigint not null,
  status text not null default 'requires_payment',
  ticket_id uuid,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_ticket_id_key unique (ticket_id),
  constraint payments_email_normalised check (email = lower(btrim(email)) and email <> ''),
  constraint payments_buyer_format check (buyer ~ '^0x[0-9a-f]{40}$'),
  constraint payments_qty_range check (qty >= 1),
  constraint payments_amount_range check (amount >= 0),
  constraint payments_status_known check (
    status in ('requires_payment', 'processing', 'ticketed', 'cancelled_paused', 'failed')
  )
);

create index payments_campaign_id_idx on public.payments (campaign_id);
create index payments_email_idx on public.payments (email);

create trigger payments_set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- tickets: the indexed copy of an on-chain ticket (TicketPurchased), plus what the live ticket
-- needs. `access_token` is the secret of the /t/<token> link. The ticket is also the trace of its
-- signed quote (`max_hedge_cost`, `quote_nonce`): there is no quotes table.
-- The displayed phase is derived: campaign outcome, event start, `refunded_at`.
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  onchain_id bigint,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  buyer text not null,
  qty integer not null,
  paid bigint not null,
  refundable bigint not null,
  max_hedge_cost bigint not null,
  quote_nonce numeric(78, 0),
  status text not null default 'issued',
  access_token text not null,
  tx_hash text,
  payment_pi text references public.payments (stripe_pi) on delete restrict,
  purchased_at timestamptz not null default now(),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_onchain_id_key unique (onchain_id),
  constraint tickets_access_token_key unique (access_token),
  constraint tickets_payment_pi_key unique (payment_pi),
  constraint tickets_quote_nonce_key unique (quote_nonce),
  constraint tickets_onchain_id_range check (onchain_id >= 0),
  constraint tickets_buyer_format check (buyer ~ '^0x[0-9a-f]{40}$'),
  constraint tickets_qty_range check (qty >= 1),
  constraint tickets_paid_range check (paid >= 0),
  constraint tickets_refundable_range check (refundable >= 0 and refundable <= paid),
  constraint tickets_max_hedge_cost_range check (max_hedge_cost >= 0),
  constraint tickets_quote_nonce_range check (quote_nonce >= 0),
  constraint tickets_status_known check (status in ('issued', 'refunded', 'refund_failed')),
  constraint tickets_access_token_length check (char_length(access_token) >= 16),
  constraint tickets_tx_hash_format check (tx_hash ~ '^0x[0-9a-f]{64}$')
);

create index tickets_buyer_idx on public.tickets (buyer, purchased_at desc);
create index tickets_campaign_id_idx on public.tickets (campaign_id, purchased_at desc);

create trigger tickets_set_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- payments and tickets reference each other, so this side is added once both tables exist.
alter table public.payments
  add constraint payments_ticket_id_fkey
  foreign key (ticket_id) references public.tickets (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- Chain: events in, transactions out
-- ---------------------------------------------------------------------------------------------

-- chain_events: every WinzEscrow log, written by three sources (transaction receipt, QuickNode
-- Streams, eth_getLogs poller) and idempotent on (tx_hash, log_index) (HE-1). Ordered by
-- (block_number, log_index): Arc block timestamps have a one-second granularity.
-- `processed_at` is set once the row has been projected to tickets, campaigns and the ledger.
create table public.chain_events (
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  block_time timestamptz,
  name text not null,
  args jsonb not null default '{}',
  source text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chain_events_pkey primary key (tx_hash, log_index),
  constraint chain_events_tx_hash_format check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint chain_events_log_index_range check (log_index >= 0),
  constraint chain_events_block_number_range check (block_number >= 0),
  constraint chain_events_source_known check (source in ('receipt', 'streams', 'logs'))
);

create index chain_events_order_idx on public.chain_events (block_number, log_index);
create index chain_events_name_idx on public.chain_events (name);
create index chain_events_unprocessed_idx on public.chain_events (block_number, log_index)
  where processed_at is null;

-- chain_cursor: last block read by each log poller, so a restart resumes where it stopped.
create table public.chain_cursor (
  name text primary key,
  block_number bigint not null,
  updated_at timestamptz not null default now(),
  constraint chain_cursor_block_number_range check (block_number >= 0)
);

create trigger chain_cursor_set_updated_at before update on public.chain_cursor
  for each row execute function public.set_updated_at();

-- chain_txs: outbox of the single transaction sender (SPEC section 7). One queue per signer key;
-- `idempotency_key` makes an enqueue safe to repeat, and (signer, nonce) can be used only once.
-- `payload` is the decoded intent (ids, amounts) kept for the logs; `data` is what is sent.
create table public.chain_txs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  signer text not null,
  kind text not null,
  to_address text not null,
  data text not null,
  value bigint not null default 0,
  payload jsonb not null default '{}',
  nonce bigint,
  tx_hash text,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  block_number bigint,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  mined_at timestamptz,
  constraint chain_txs_idempotency_key_key unique (idempotency_key),
  constraint chain_txs_signer_known check (signer in ('relayer', 'oracle')),
  constraint chain_txs_to_address_format check (to_address ~ '^0x[0-9a-f]{40}$'),
  constraint chain_txs_data_format check (data ~ '^0x([0-9a-f]{2})*$'),
  constraint chain_txs_value_range check (value >= 0),
  constraint chain_txs_nonce_range check (nonce >= 0),
  constraint chain_txs_tx_hash_format check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint chain_txs_status_known check (status in ('queued', 'sent', 'mined', 'reverted', 'failed')),
  constraint chain_txs_attempts_range check (attempts >= 0),
  constraint chain_txs_block_number_range check (block_number >= 0)
);

create unique index chain_txs_signer_nonce_key on public.chain_txs (signer, nonce)
  where nonce is not null;
create index chain_txs_queue_idx on public.chain_txs (signer, status, created_at);
create index chain_txs_tx_hash_idx on public.chain_txs (tx_hash) where tx_hash is not null;

-- ---------------------------------------------------------------------------------------------
-- Hedging engine (SPEC section 9)
-- ---------------------------------------------------------------------------------------------

-- lots: one per ticket (9.5). A lot is the q micro-contracts a sale needs, with the cost the quote
-- guaranteed. Fills are allocated to lots in `seq` order (FIFO); the merchant is charged
-- min(cost, max_hedge_cost) once, when the lot is fully covered.
create table public.lots (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  ticket_id uuid not null references public.tickets (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  instrument text not null references public.instruments (symbol) on delete restrict,
  qty bigint not null,
  max_hedge_cost bigint not null,
  filled_qty bigint not null default 0,
  cost bigint not null default 0,
  charged boolean not null default false,
  charged_amount bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lots_seq_key unique (seq),
  constraint lots_ticket_id_key unique (ticket_id),
  constraint lots_qty_range check (qty >= 0),
  constraint lots_max_hedge_cost_range check (max_hedge_cost >= 0),
  constraint lots_filled_qty_range check (filled_qty >= 0 and filled_qty <= qty),
  constraint lots_cost_range check (cost >= 0),
  constraint lots_charged_amount_range check (charged_amount >= 0 and charged_amount <= max_hedge_cost),
  constraint lots_charged_has_amount check (charged = (charged_amount is not null))
);

create index lots_instrument_fifo_idx on public.lots (instrument, seq);
create index lots_instrument_open_idx on public.lots (instrument, seq) where filled_qty < qty;
create index lots_campaign_id_idx on public.lots (campaign_id);
create index lots_uncharged_idx on public.lots (campaign_id) where not charged;

create trigger lots_set_updated_at before update on public.lots
  for each row execute function public.set_updated_at();

-- positions: the exposure ledger, one row per instrument shared by all its campaigns (HE-1, HE-3).
-- exposure = E (contracts owed if YES), held = H, working = W (resting maker orders).
create table public.positions (
  instrument text primary key references public.instruments (symbol) on delete restrict,
  exposure bigint not null default 0,
  held bigint not null default 0,
  working bigint not null default 0,
  venue text not null default 'paper',
  updated_at timestamptz not null default now(),
  constraint positions_exposure_range check (exposure >= 0),
  constraint positions_held_range check (held >= 0),
  constraint positions_working_range check (working >= 0),
  constraint positions_venue_known check (venue in ('paper', 'gemini-sandbox', 'gemini'))
);

create trigger positions_set_updated_at before update on public.positions
  for each row execute function public.set_updated_at();

-- orders: hedge orders sent to an execution venue (9.3). `price_bps` is the limit price.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  instrument text not null references public.instruments (symbol) on delete restrict,
  side text not null,
  kind text not null,
  price_bps integer not null,
  qty bigint not null,
  filled_qty bigint not null default 0,
  status text not null default 'working',
  venue text not null,
  venue_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_side_known check (side in ('buy', 'sell')),
  constraint orders_kind_known check (kind in ('maker', 'taker')),
  constraint orders_price_bps_range check (price_bps between 0 and 10000),
  constraint orders_qty_range check (qty >= 0),
  constraint orders_filled_qty_range check (filled_qty >= 0 and filled_qty <= qty),
  constraint orders_status_known
    check (status in ('working', 'filled', 'partially_filled', 'cancelled', 'rejected')),
  constraint orders_venue_known check (venue in ('paper', 'gemini-sandbox', 'gemini'))
);

create unique index orders_venue_order_id_key on public.orders (venue, venue_order_id)
  where venue_order_id is not null;
create index orders_instrument_status_idx on public.orders (instrument, status);
create index orders_instrument_created_at_idx on public.orders (instrument, created_at desc);

create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- fills: executions of an order. `book_ref` is the book snapshot a paper fill was made against,
-- so every paper fill can be replayed and checked (9.7). `venue_fill_id` dedupes real venue fills.
create table public.fills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  price_bps integer not null,
  qty bigint not null,
  fee bigint not null default 0,
  ts timestamptz not null default now(),
  book_ref jsonb,
  venue_fill_id text,
  created_at timestamptz not null default now(),
  constraint fills_price_bps_range check (price_bps between 0 and 10000),
  constraint fills_qty_range check (qty >= 0),
  constraint fills_fee_range check (fee >= 0)
);

create unique index fills_venue_fill_id_key on public.fills (order_id, venue_fill_id)
  where venue_fill_id is not null;
create index fills_order_id_idx on public.fills (order_id, ts);
create index fills_ts_idx on public.fills (ts desc);

-- lot_fills: allocation of a fill to a lot (9.5). `cost` is the price and the fees of the `qty`
-- contracts of that fill that covered that lot.
create table public.lot_fills (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots (id) on delete restrict,
  fill_id uuid not null references public.fills (id) on delete restrict,
  qty bigint not null,
  cost bigint not null,
  created_at timestamptz not null default now(),
  constraint lot_fills_lot_fill_key unique (lot_id, fill_id),
  constraint lot_fills_qty_range check (qty >= 0),
  constraint lot_fills_cost_range check (cost >= 0)
);

create index lot_fills_fill_id_idx on public.lot_fills (fill_id);

-- engine_pnl: what the engine itself won or lost, per event (9.6): maker savings against an
-- all-taker execution, losses paid when a fill came in above a quote's guarantee, crossing gains.
create table public.engine_pnl (
  event_ticker text primary key references public.events (ticker) on delete restrict,
  maker_savings bigint not null default 0,
  guarantee_losses bigint not null default 0,
  crossing_gains bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint engine_pnl_maker_savings_range check (maker_savings >= 0),
  constraint engine_pnl_guarantee_losses_range check (guarantee_losses >= 0),
  constraint engine_pnl_crossing_gains_range check (crossing_gains >= 0)
);

create trigger engine_pnl_set_updated_at before update on public.engine_pnl
  for each row execute function public.set_updated_at();

-- engine_params: risk parameters of the execution policy (U_max, maker TTL, tolerance...), shown
-- on the Hedge desk. Missing keys fall back to DEFAULT_RISK_PARAMS in packages/shared.
create table public.engine_params (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger engine_params_set_updated_at before update on public.engine_params
  for each row execute function public.set_updated_at();

-- demo_overrides: demo mode (MDB-4). A simulated book and/or a forced result for one instrument,
-- written by the admin routes and read by the engine in place of the Gemini feed.
create table public.demo_overrides (
  instrument text primary key references public.instruments (symbol) on delete cascade,
  book jsonb,
  forced_result text,
  updated_at timestamptz not null default now(),
  constraint demo_overrides_forced_result_known check (forced_result in ('yes', 'no', 'void'))
);

create trigger demo_overrides_set_updated_at before update on public.demo_overrides
  for each row execute function public.set_updated_at();

-- venue_checks: real orders placed on the Gemini sandbox to prove the order adapter (HE-10):
-- one maker order placed, one cancelled, one filled. Shown on the Hedge desk. `instrument` is a
-- sandbox symbol (a crypto market), not a row of `instruments`.
create table public.venue_checks (
  id uuid primary key default gen_random_uuid(),
  venue_order_id text not null,
  instrument text not null,
  action text not null,
  at timestamptz not null default now(),
  constraint venue_checks_order_action_key unique (venue_order_id, action),
  constraint venue_checks_action_known check (action in ('placed_maker', 'cancelled', 'filled'))
);

create index venue_checks_at_idx on public.venue_checks (at desc);

-- ---------------------------------------------------------------------------------------------
-- Notifications and jobs
-- ---------------------------------------------------------------------------------------------

-- push_subscriptions: Web Push subscriptions of an installed PWA (LT-3).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint)
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- jobs: the queue between the web routes and the engine (SPEC section 7). The web only inserts;
-- workers take rows with `for update skip locked` where status = 'queued' and run_at <= now().
-- `idempotency_key` (nullable) makes the Stripe webhook and the client confirmation one job.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_idempotency_key_key unique (idempotency_key),
  constraint jobs_status_known check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  constraint jobs_attempts_range check (attempts >= 0),
  constraint jobs_max_attempts_range check (max_attempts >= 1)
);

create index jobs_status_run_at_idx on public.jobs (status, run_at);
create index jobs_kind_idx on public.jobs (kind, created_at desc);

create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Public realtime tables: read-only for the browser, no personal data
-- ---------------------------------------------------------------------------------------------

-- live_instruments: best bid, best ask and mid of each instrument used by a campaign, for the live
-- odds. Columns are exactly liveInstrumentRowSchema.
create table public.live_instruments (
  symbol text primary key,
  bid_bps integer,
  ask_bps integer,
  mid_bps integer,
  observed_at timestamptz not null default now(),
  stale boolean not null default false,
  constraint live_instruments_bid_bps_range check (bid_bps between 0 and 10000),
  constraint live_instruments_ask_bps_range check (ask_bps between 0 and 10000),
  constraint live_instruments_mid_bps_range check (mid_bps between 0 and 10000)
);

-- live_campaigns: public state of a live campaign, keyed by its slug. Columns are exactly
-- liveCampaignRowSchema.
create table public.live_campaigns (
  slug text primary key,
  sale_state text not null,
  sales integer not null default 0,
  exposure bigint not null default 0,
  hedged_bps integer not null default 0,
  outcome text,
  updated_at timestamptz not null default now(),
  constraint live_campaigns_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  constraint live_campaigns_sale_state_known check (
    sale_state in (
      'open', 'paused_price', 'paused_budget', 'paused_depth',
      'paused_stale', 'paused_breaker', 'paused_manual', 'closed'
    )
  ),
  constraint live_campaigns_sales_range check (sales >= 0),
  constraint live_campaigns_exposure_range check (exposure >= 0),
  constraint live_campaigns_hedged_bps_range check (hedged_bps between 0 and 10000),
  constraint live_campaigns_outcome_known check (outcome in ('yes', 'no', 'void'))
);

create trigger live_campaigns_set_updated_at before update on public.live_campaigns
  for each row execute function public.set_updated_at();

-- live_hedge_desk: one row per active instrument; `payload` is the hedgeInstrumentSchema object of
-- GET /api/hedge-desk (exposure, position, orders, fills, breaker, savings).
create table public.live_hedge_desk (
  instrument text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger live_hedge_desk_set_updated_at before update on public.live_hedge_desk
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.merchants enable row level security;
alter table public.events enable row level security;
alter table public.instruments enable row level security;
alter table public.campaigns enable row level security;
alter table public.payments enable row level security;
alter table public.tickets enable row level security;
alter table public.chain_events enable row level security;
alter table public.chain_cursor enable row level security;
alter table public.chain_txs enable row level security;
alter table public.lots enable row level security;
alter table public.positions enable row level security;
alter table public.orders enable row level security;
alter table public.fills enable row level security;
alter table public.lot_fills enable row level security;
alter table public.engine_pnl enable row level security;
alter table public.engine_params enable row level security;
alter table public.demo_overrides enable row level security;
alter table public.venue_checks enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.jobs enable row level security;
alter table public.live_instruments enable row level security;
alter table public.live_campaigns enable row level security;
alter table public.live_hedge_desk enable row level security;

-- Supabase grants every privilege on new public tables to the browser roles by default and relies
-- on RLS alone. Taking the grants away as well means a policy added by mistake exposes nothing.
revoke all on table
  public.users,
  public.merchants,
  public.events,
  public.instruments,
  public.campaigns,
  public.payments,
  public.tickets,
  public.chain_events,
  public.chain_cursor,
  public.chain_txs,
  public.lots,
  public.positions,
  public.orders,
  public.fills,
  public.lot_fills,
  public.engine_pnl,
  public.engine_params,
  public.demo_overrides,
  public.venue_checks,
  public.push_subscriptions,
  public.jobs,
  public.live_instruments,
  public.live_campaigns,
  public.live_hedge_desk
from anon, authenticated;

grant select on table
  public.live_instruments,
  public.live_campaigns,
  public.live_hedge_desk
to anon, authenticated;

create policy live_instruments_public_read on public.live_instruments
  for select to anon, authenticated using (true);

create policy live_campaigns_public_read on public.live_campaigns
  for select to anon, authenticated using (true);

create policy live_hedge_desk_public_read on public.live_hedge_desk
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------------------------

-- The publication exists on Supabase, not on a plain Postgres (local tests).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.live_instruments, public.live_campaigns, public.live_hedge_desk;
  end if;
end;
$$;
