import { liveCampaignRowSchema, type LiveCampaignRow } from "@winz/shared";

/**
 * The public row of a live campaign (`live_campaigns`, keyed by slug), as Supabase Realtime pushes
 * it. It carries `sale_state`, `sales`, `exposure`, `hedged_bps`, `outcome` and `updated_at`, the
 * same figures `GET /api/campaigns/:id` computes from the same tables (units sold, sum of the
 * refundable amounts, share of the lots filled rounded down). Everything else of the detail (the
 * money received and pending, the budget, the capacity, the status, the report) only comes from the
 * API.
 */

/** A row the screen accepted, with when it arrived (this device's clock, epoch milliseconds). */
export interface PushedCampaign {
  row: LiveCampaignRow;
  receivedAt: number;
}

/**
 * A pushed row → the row, read with the shared schema (which takes the pushed spellings: a bigint
 * as a JSON number, a timestamp with an offset). `null` when the row is malformed or belongs to
 * another campaign than `slug`: it is dropped, never shown.
 */
export function campaignRowFrom(row: unknown, slug: string): LiveCampaignRow | null {
  const parsed = liveCampaignRowSchema.safeParse(row);
  if (!parsed.success) return null;
  return parsed.data.slug === slug ? parsed.data : null;
}

/**
 * The newer of the row kept and a row just pushed, by `updated_at` (the database's clock for both).
 * A row that arrives late with an older `updated_at` never replaces a newer one; at the same
 * `updated_at` the one that arrived last is kept.
 */
export function newerPush(current: PushedCampaign | null, next: PushedCampaign): PushedCampaign {
  if (current === null) return next;
  const kept = Date.parse(current.row.updated_at);
  const pushed = Date.parse(next.row.updated_at);
  return pushed < kept ? current : next;
}
