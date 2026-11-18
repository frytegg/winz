-- budget_top_ups (CA-6): a merchant's card payment adding hedge budget to a running campaign.
-- One row per request and per PaymentIntent, a positive amount, a known status, and at most one
-- top-up of a campaign awaiting payment or on its way to the chain at a time.

-- Well-formed rows are accepted: one open top-up next to the credited fixture.
select test.lives(
  $$insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount)
    values ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
            'pi_top_up_2', 50000000)$$,
  'budget_top_ups accepts an open top-up next to a credited one'
);
select test.count_is(
  $$select count(*) from public.budget_top_ups
    where request_id = '40000000-0000-4000-8000-000000000002' and status = 'requires_payment'$$,
  1, 'a new top-up starts requires_payment'
);

-- Uniqueness.
select test.throws(
  $$insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
    values ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
            'pi_top_up_other', 50000000, 'failed')$$,
  '{23505}', 'budget_top_ups rejects a second row for one request', 'budget_top_ups_pkey'
);
select test.throws(
  $$insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
    values ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
            'pi_top_up_2', 50000000, 'failed')$$,
  '{23505}', 'budget_top_ups rejects a second row for one PaymentIntent',
  'budget_top_ups_stripe_pi_key'
);
select test.throws(
  $$insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
    values ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001',
            'pi_top_up_4', 50000000, 'processing')$$,
  '{23505}', 'budget_top_ups rejects a second open top-up of one campaign',
  'budget_top_ups_one_open_key'
);
-- Closed ones do not count: a failed and a refunded top-up sit next to the open one.
select test.lives(
  $$insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
    values ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001',
            'pi_top_up_5', 50000000, 'failed')$$,
  'budget_top_ups accepts a failed top-up next to an open one'
);
select test.lives(
  $$insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount, status,
                                      refunded_at)
    values ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001',
            'pi_top_up_6', 50000000, 'refunded', now())$$,
  'budget_top_ups accepts a refunded top-up next to an open one'
);

-- Checks.
select test.throws(
  $$update public.budget_top_ups set amount = 0
    where request_id = '40000000-0000-4000-8000-000000000002'$$,
  '{23514}', 'budget_top_ups rejects a zero amount', 'budget_top_ups_amount_range'
);
select test.throws(
  $$update public.budget_top_ups set amount = -1
    where request_id = '40000000-0000-4000-8000-000000000002'$$,
  '{23514}', 'budget_top_ups rejects a negative amount', 'budget_top_ups_amount_range'
);
select test.throws(
  $$update public.budget_top_ups set status = 'paid'
    where request_id = '40000000-0000-4000-8000-000000000002'$$,
  '{23514}', 'budget_top_ups rejects an unknown status', 'budget_top_ups_status_known'
);
select test.throws(
  $$update public.budget_top_ups set tx_hash = '0x123'
    where request_id = '40000000-0000-4000-8000-000000000002'$$,
  '{23514}', 'budget_top_ups rejects a malformed transaction hash', 'budget_top_ups_tx_hash_format'
);
select test.throws(
  $$update public.budget_top_ups set status = 'credited'
    where request_id = '40000000-0000-4000-8000-000000000002'$$,
  '{23514}', 'budget_top_ups rejects a credited top-up without its transaction',
  'budget_top_ups_credited_has_tx'
);
select test.throws(
  $$update public.budget_top_ups set status = 'refunded'
    where request_id = '40000000-0000-4000-8000-000000000002'$$,
  '{23514}', 'budget_top_ups rejects a refunded top-up without its refund time',
  'budget_top_ups_refunded_has_time'
);
select test.ok(
  test.check_values('budget_top_ups_status_known')
    = array['credited', 'failed', 'processing', 'refunded', 'refunding', 'requires_payment'],
  'budget_top_ups_status_known lists exactly the six statuses',
  test.check_values('budget_top_ups_status_known')::text
);
select test.ok(
  (
    select data_type = 'bigint' from information_schema.columns
    where table_schema = 'public' and table_name = 'budget_top_ups' and column_name = 'amount'
  ),
  'budget_top_ups.amount is a bigint'
);

-- Every status can be reached; an open top-up moving on frees its campaign for the next one.
select test.lives(
  format(
    'update public.budget_top_ups set status = %L, tx_hash = %L, refunded_at = %L
     where request_id = %L',
    x.status, x.tx_hash, x.refunded_at, '40000000-0000-4000-8000-000000000002'
  ),
  format('budget_top_ups accepts the status %s', x.status)
)
from (
  values
    ('processing', null, null),
    ('refunding', null, null),
    ('refunded', null, now()::text),
    ('failed', null, null),
    ('credited', '0x' || repeat('ef', 32), null)
) as x (status, tx_hash, refunded_at);
select test.lives(
  $$insert into public.budget_top_ups (request_id, campaign_id, stripe_pi, amount, status)
    values ('40000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001',
            'pi_top_up_7', 50000000, 'processing')$$,
  'once the open top-up is credited, the next one of the campaign is accepted'
);

-- A campaign with top-ups cannot be deleted.
select test.throws(
  $$delete from public.budget_top_ups where false;
    delete from public.campaigns where id = '20000000-0000-4000-8000-000000000001'$$,
  '{23503,23001}', 'a campaign with top-ups cannot be deleted'
);
