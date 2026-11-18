-- chain_txs: find a pause or resume request's own transaction by its request id.
--
-- The manual-pause rule asks, for the latest `campaign.set_paused` job of each campaign, whether
-- the `setPaused` transaction carrying that job's `requestId` is mined (`pause_job_in_flight`) and
-- whether its own `CampaignPaused` event is projected (`pause_projected`): see
-- `apps/engine/src/sales/store.ts`. Both look a row up by `payload ->> 'requestId'` among the
-- `setPaused` rows, and nothing indexed that: each lookup scanned the whole outbox, which grows by
-- two rows per sale. Measured on 5 000 rows with ten pause jobs in flight: 9.2 ms per sale-state
-- pass, 2.6 ms with this index. Partial: only the `setPaused` rows are in it.
create index chain_txs_set_paused_request_idx
  on public.chain_txs ((payload ->> 'requestId'))
  where kind = 'setPaused';
