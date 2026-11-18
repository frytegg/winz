/**
 * Test support of the pause and resume jobs: the sale state service beside the handlers, on the
 * jobs harness's chain and database. Test code only.
 */
import pino from "pino";

import { JOB_KINDS, type BookLevel } from "@winz/shared";

import { SaleStateRunner, type SaleBookSource } from "../../sales";
import { CONTRACT, type JobsHarness } from "./test-support";

/** A book on which a campaign with the default terms sells (`DEFAULT_TERMS`). */
export const SELLING_ASKS: BookLevel[] = [
  { priceBps: 3_000n, qty: 200n * CONTRACT },
  { priceBps: 3_100n, qty: 300n * CONTRACT },
];
export const SELLING_BIDS: BookLevel[] = [{ priceBps: 2_900n, qty: 100n * CONTRACT }];

/** The harness's hand-fed books as the sale state service reads them: never stale, no events. */
export function saleBookSource(harness: JobsHarness): SaleBookSource {
  return {
    getBook: (symbol) => harness.books.getBook(symbol),
    isStale: () => false,
    subscribe: () => () => undefined,
  };
}

/** A sale state runner on the harness's clock and books, with no start-up grace. */
export function saleStateRunner(harness: JobsHarness): SaleStateRunner {
  return new SaleStateRunner({
    db: harness.db,
    bookFeed: saleBookSource(harness),
    logger: pino({ level: "silent" }),
    clock: harness.clock.now,
    startupGraceMs: 0,
  });
}

/**
 * What the job worker does once a handler returns: the campaign's `campaign.set_paused` jobs that
 * a test ran by calling the handler directly end `done`.
 */
export async function finishPauseJobs(harness: JobsHarness, campaignId: string): Promise<void> {
  await harness.db`
    update jobs set status = 'done', locked_at = null, locked_by = null
    where kind = ${JOB_KINDS.setPaused} and payload ->> 'campaignId' = ${campaignId}
      and status in ('queued', 'running')
  `;
}

/**
 * Records every change of `campaigns.sale_state` in a table of the test database (a trigger
 * there, not a migration: the database is thrown away with the harness). `states` returns the
 * values written for a campaign, in order.
 */
export async function recordSaleStates(harness: JobsHarness): Promise<{
  states: (campaignId: string) => Promise<string[]>;
}> {
  await harness.db.unsafe(`
    create table if not exists test_sale_state_log (
      seq bigserial primary key,
      campaign_id uuid not null,
      sale_state text not null
    );
    create or replace function test_log_sale_state() returns trigger language plpgsql as $$
    begin
      if tg_op = 'INSERT' or new.sale_state is distinct from old.sale_state then
        insert into test_sale_state_log (campaign_id, sale_state) values (new.id, new.sale_state);
      end if;
      return new;
    end $$;
    drop trigger if exists test_log_sale_state on campaigns;
    create trigger test_log_sale_state after insert or update of sale_state on campaigns
      for each row execute function test_log_sale_state();
  `);
  return {
    states: async (campaignId) => {
      const rows = await harness.db<{ sale_state: string }[]>`
        select sale_state from test_sale_state_log where campaign_id = ${campaignId} order by seq
      `;
      return rows.map((row) => row.sale_state);
    },
  };
}
