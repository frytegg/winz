import type { Db } from "../../db";

import type { VenueCheckReport } from "./check";

/** Where a venue check is kept once it ran. */
export interface VenueCheckRecorder {
  /** Records the run and its orders; returns the run's id. */
  record(report: VenueCheckReport): Promise<string>;
}

/**
 * The check in Postgres (migration 20261120000000_venue_checks.sql): one `venue_check_runs` row
 * (venue, trigger, times, outcome, failed step and reason) and one `venue_checks` row per order of
 * the proof (Gemini's order id, instrument, action, side, kind, price, quantity, filled quantity,
 * Gemini's status read back, average price). One transaction: a run is never half written. No key,
 * no payload, no signature is ever written.
 */
export class PgVenueCheckRecorder implements VenueCheckRecorder {
  constructor(private readonly db: Db) {}

  async record(report: VenueCheckReport): Promise<string> {
    return this.db.begin(async (tx) => {
      const [run] = await tx<{ id: string }[]>`
        insert into venue_check_runs (venue, trigger, started_at, finished_at, outcome,
                                      failed_step, failure, instrument)
        values (${report.venue}, ${report.trigger}, ${new Date(report.startedAtMs)},
                ${new Date(report.finishedAtMs)}, ${report.outcome}, ${report.failedStep},
                ${report.failure}, ${report.instrument?.symbol ?? null})
        returning id
      `;
      if (run === undefined) throw new Error("venue_check_runs insert returned no row");
      for (const order of report.orders) {
        await tx`
          insert into venue_checks (venue_order_id, instrument, action, at, run_id, side, kind,
                                    price_bps, qty, filled_qty, status, avg_price)
          values (${order.venueOrderId}, ${order.instrumentSymbol}, ${order.action},
                  ${new Date(order.atMs)}, ${run.id}, ${order.side}, ${order.kind},
                  ${Number(order.limitPriceBps)}, ${order.qty.toString()}::bigint,
                  ${order.filledQty.toString()}::bigint, ${order.status}, ${order.avgPrice})
        `;
      }
      return run.id;
    });
  }
}
