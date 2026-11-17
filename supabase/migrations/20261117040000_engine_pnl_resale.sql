-- The result of reselling a hedge surplus (HE-6): what the contracts sold for, minus what they had
-- cost. It belongs to the platform, never to a merchant, and unlike the other columns of
-- engine_pnl it can be negative, so it has no range check.
alter table public.engine_pnl
  add column resale_result bigint not null default 0;
