-- The real-order proof on Gemini's sandbox (SPEC HE-10, task H-07), and the links of the real
-- order adapter (apps/engine/src/venues/gemini).
--
-- venue_check_runs: one row per run of the check (`pnpm --filter @winz/engine venue:check`, or once
-- at the engine's boot with APP_VENUE_CHECK_ON_BOOT=true), whether it proved or failed. A failed
-- run says at which step and why, in one line that never holds a key, a payload or a signature.
-- The Hedge desk shows the latest run.
--
--   venue        'gemini-sandbox' (the only venue real orders may go to)
--   trigger      'command' (venue:check) or 'boot' (APP_VENUE_CHECK_ON_BOOT)
--   outcome      'proven' (the three orders below were read back as expected) or 'failed'
--   failed_step  'preflight' (key, terms), 'instrument', 'placed_maker', 'cancelled', 'filled'
--   instrument   the sandbox contract used, when one was chosen
create table public.venue_check_runs (
  id uuid primary key default gen_random_uuid(),
  venue text not null,
  trigger text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null,
  failed_step text,
  failure text,
  instrument text,
  constraint venue_check_runs_venue_known check (venue in ('gemini-sandbox')),
  constraint venue_check_runs_trigger_known check (trigger in ('command', 'boot')),
  constraint venue_check_runs_outcome_known check (outcome in ('proven', 'failed')),
  constraint venue_check_runs_failed_step_known check (
    failed_step in ('preflight', 'instrument', 'placed_maker', 'cancelled', 'filled')
  ),
  -- A failed run names its step and its reason; any other run carries neither.
  constraint venue_check_runs_failure_consistent check (
    (outcome = 'failed') = (failed_step is not null and failure is not null)
    and (outcome = 'failed' or (failed_step is null and failure is null))
  ),
  constraint venue_check_runs_failure_length check (char_length(failure) <= 600),
  constraint venue_check_runs_times_ordered check (finished_at >= started_at)
);

create index venue_check_runs_finished_at_idx on public.venue_check_runs (finished_at desc);

-- venue_checks (20261117000000_init.sql) gets the run it belongs to and what was read back from
-- Gemini for each order. Rows written before this migration keep nulls.
--
--   side, kind     buy/sell, maker/taker
--   price_bps      the order's limit price, bps
--   qty            the order's quantity, micro-contracts
--   filled_qty     filled when read back, micro-contracts
--   status         Gemini's own status when read back: 'open', 'filled', 'cancelled' ('closed'
--                  is listed by Gemini's batch answer)
--   avg_price      Gemini's average execution price as Gemini wrote it, when filled
alter table public.venue_checks
  add column run_id uuid references public.venue_check_runs (id) on delete cascade,
  add column side text,
  add column kind text,
  add column price_bps integer,
  add column qty bigint,
  add column filled_qty bigint,
  add column status text,
  add column avg_price text,
  add constraint venue_checks_side_known check (side in ('buy', 'sell')),
  add constraint venue_checks_kind_known check (kind in ('maker', 'taker')),
  add constraint venue_checks_price_range check (price_bps between 0 and 10000),
  add constraint venue_checks_qty_positive check (qty > 0),
  add constraint venue_checks_filled_range check (filled_qty >= 0 and filled_qty <= qty),
  add constraint venue_checks_status_known check (status in ('open', 'filled', 'cancelled', 'closed'));

create index venue_checks_run_id_idx on public.venue_checks (run_id);

-- venue_order_links: for each order the real adapter places, the caller's client order id and
-- Gemini's order id. Gemini's Prediction Markets REST order takes no client id, so the link is the
-- only way back from one to the other. Written before the placement is sent (state 'pending'), so
-- an order whose answer was lost can be found at Gemini by its terms, even after a restart.
--
--   state  'pending' (sent, no answer yet), 'placed' (Gemini answered with its id), 'refused'
--          (Gemini refused it: nothing exists), 'absent' (never found after the grace period)
create table public.venue_order_links (
  client_order_id text primary key,
  venue text not null,
  instrument text not null,
  side text not null,
  kind text not null,
  limit_price_bps integer not null,
  qty bigint not null,
  placed_at timestamptz not null,
  venue_order_id text,
  state text not null,
  refusal text,
  cancel_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_order_links_venue_known check (venue in ('gemini-sandbox')),
  constraint venue_order_links_side_known check (side in ('buy', 'sell')),
  constraint venue_order_links_kind_known check (kind in ('maker', 'taker')),
  constraint venue_order_links_price_range check (limit_price_bps between 0 and 10000),
  constraint venue_order_links_qty_positive check (qty > 0),
  constraint venue_order_links_state_known check (state in ('pending', 'placed', 'refused', 'absent')),
  -- Placed means Gemini gave its id.
  constraint venue_order_links_placed_has_id check (state <> 'placed' or venue_order_id is not null),
  constraint venue_order_links_venue_order_key unique (venue, venue_order_id)
);

-- Private like every table but live_*: no policy, and no grant to the browser roles.
alter table public.venue_check_runs enable row level security;
alter table public.venue_order_links enable row level security;
revoke all on table public.venue_check_runs, public.venue_order_links from anon, authenticated;
