import type { CampaignStatus } from "@winz/shared";

/** The latest `campaign.set_paused` job of a campaign, as far as the pause rule needs it. */
export interface PauseJobView {
  /** What the merchant asked for: true to pause, false to resume. */
  paused: boolean;
  /** When the job was enqueued (`jobs.created_at`), epoch milliseconds. */
  createdAtMs: number;
}

export interface ManualPauseInput {
  /** `campaigns.status`, which the projection sets to `paused` once the pause is on-chain. */
  status: CampaignStatus;
  /**
   * A `campaign.set_paused` job of this campaign, pause or resume, is not finished: the chain's
   * answer to it is not known yet. In the job worker's states that is a job `queued` (never run,
   * or waiting for its retry after a failure: the worker puts a failed attempt back to `queued`
   * with a later `run_at`) or `running`, unless the transaction it sent is already `mined` (its
   * events were stored with it, and the rest of the rule reads them). `done`, `dead` and `failed`
   * are final: no worker takes such a job again.
   */
  pauseJobInFlight: boolean;
  /**
   * A `CampaignPaused` event of this campaign (a pause or a resume) is stored in `chain_events`
   * but not projected yet (`processed_at` is null): the chain moved and `status` does not show it.
   */
  pauseEventUnprojected: boolean;
  /** The most recent `campaign.set_paused` job naming the campaign, or null when there is none. */
  latestPauseJob: PauseJobView | null;
  /**
   * When the campaign was last paused on-chain, as far as the projection has applied it: the time
   * of its latest PROJECTED `CampaignPaused` event with `paused = true` (block time, or the time it
   * was stored when the block time is unknown), epoch milliseconds. Null when none. An event that
   * is stored but not projected yet must not count: `status` still says `live` for it, and the two
   * together would read as "paused, then resumed on-chain" and reopen a campaign that is paused.
   */
  lastOnChainPauseAtMs: number | null;
}

/** Block times have a one-second granularity: a pause mined in the second of the job counts. */
function floorToSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

/**
 * Whether the merchant's manual pause is in force (SPEC CA-4, CA-5: the one pause written
 * on-chain, which the page must follow). The web API writes `paused_manual` at once when the
 * merchant pauses, before the transaction is mined, and on resume only enqueues a job. The pause
 * is in force while ANY of these holds:
 *
 * a. the projected status is `paused`: the campaign is paused on-chain as far as the projection
 *    knows, whatever job is waiting. This also covers a resume job that died (failed for good):
 *    the campaign stays paused on-chain, and so does the sale state until the merchant resumes
 *    again;
 * b. a pause or resume job of the campaign is not finished (`pauseJobInFlight`): the chain's
 *    answer is not known yet, whatever the job asks. A pause and a resume both waiting, in any
 *    order of mining, never show the campaign selling while it may be paused on-chain;
 * c. a pause or resume event of the campaign is stored but not projected yet
 *    (`pauseEventUnprojected`): the chain moved and the status lags it, in either direction;
 * d. its latest pause job asked for a pause and the campaign has not been paused on-chain (as
 *    projected) since that job was enqueued. With (b) out of the way this is the case of a pause
 *    job that finished without its pause reaching the chain: it died (attempts used up, or a
 *    revert no attempt can change), and the merchant, who asked for a pause and still sees one,
 *    resumes by hand. If the campaign was paused on-chain since the job and is no longer paused,
 *    a resume reached the chain without a job and the pause is over.
 *
 * So after a resume is requested, the pause ends only when the resume is mined AND projected (its
 * job finished or its transaction mined, its event projected, the status `live`); and once every
 * job is finished and every event projected, only (a) and (d) remain, both of which a resume
 * that reached the chain clears. Leaving the pause has no delay: the next evaluation decides
 * normally from the market.
 */
export function isManuallyPaused(input: ManualPauseInput): boolean {
  if (input.status === "paused") return true;
  if (input.pauseJobInFlight) return true;
  if (input.pauseEventUnprojected) return true;
  const job = input.latestPauseJob;
  if (job === null || !job.paused) return false;
  const pausedOnChainSinceJob =
    input.lastOnChainPauseAtMs !== null &&
    input.lastOnChainPauseAtMs >= floorToSecond(job.createdAtMs);
  return !pausedOnChainSinceJob;
}
