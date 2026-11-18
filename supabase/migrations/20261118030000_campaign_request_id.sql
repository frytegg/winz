-- campaigns.request_id: POST /api/campaigns made idempotent (task F-05, front-end request 3.1).
--
-- A double tap on "Fund $1,000", or a retry after a network cut, must never create two campaigns
-- and two budget payments. The front chooses a uuid once per tap (`requestId` of
-- `createCampaignRequestSchema`) and sends it with every retry of that request; the route stores
-- it here. The unique index decides between two calls at the same moment: the first insert wins,
-- the other finds its row (`insert ... on conflict (merchant_id, request_id) where request_id is
-- not null do nothing`), and both answer the same campaign and the same payment.
--
-- request_id   the merchant's `requestId`. Null for a campaign created without one (the request
--              field is optional until the API shapes are frozen) and for every campaign created
--              before this migration: those are not protected, and any number of them can exist.
--              Unique per merchant where it is set: two merchants may pick the same uuid.
--
-- Additive: one nullable column and one partial index, no existing row or constraint changes.
alter table public.campaigns
  add column request_id uuid;

create unique index campaigns_merchant_id_request_id_key
  on public.campaigns (merchant_id, request_id)
  where request_id is not null;
