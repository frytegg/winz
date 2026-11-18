-- budget_top_ups: one card payment of a merchant adding hedge budget to their running campaign
-- (SPEC CA-6, task A-08). The first budget is recorded on the campaign itself (`budget_pi`); a
-- campaign can take several top-ups over its life, and `payments` is the table of customer
-- purchases (its quantity, its statuses and the public GET /api/checkout/:pi are a purchase's),
-- so a top-up has its own row here.
--
-- `request_id` is the merchant's `requestId` of POST /api/campaigns/:id/top-up: the same request
-- sent again finds its row and creates nothing. The PaymentIntent is unique: one row per payment.
--
-- Status:
--   requires_payment  the PaymentIntent exists, the card is not paid yet
--   processing        paid; the `campaign.top_up` job is enqueued (the money is the campaign's)
--   credited          `topUpBudgetFor` is mined and its `BudgetToppedUp` projected
--   refunding         the campaign can no longer take it: the refund is decided, never sent again
--   refunded          the card payment is refunded
--   failed            the PaymentIntent is cancelled at Stripe, so it can never be paid
-- At most one top-up per campaign is `requires_payment` or `processing` at a time.
create table public.budget_top_ups (
  request_id uuid primary key,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  stripe_pi text not null,
  amount bigint not null,
  status text not null default 'requires_payment',
  message text,
  tx_hash text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_top_ups_stripe_pi_key unique (stripe_pi),
  constraint budget_top_ups_amount_range check (amount > 0),
  constraint budget_top_ups_status_known check (
    status in ('requires_payment', 'processing', 'credited', 'refunding', 'refunded', 'failed')
  ),
  constraint budget_top_ups_tx_hash_format check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint budget_top_ups_credited_has_tx check (status <> 'credited' or tx_hash is not null),
  constraint budget_top_ups_refunded_has_time check (status <> 'refunded' or refunded_at is not null)
);

create unique index budget_top_ups_one_open_key
  on public.budget_top_ups (campaign_id)
  where status in ('requires_payment', 'processing');

create index budget_top_ups_campaign_id_idx
  on public.budget_top_ups (campaign_id, created_at desc);

create trigger budget_top_ups_set_updated_at before update on public.budget_top_ups
  for each row execute function public.set_updated_at();

-- Private like every table but live_*: no policy, and no grant to the browser roles.
alter table public.budget_top_ups enable row level security;
revoke all on table public.budget_top_ups from anon, authenticated;
