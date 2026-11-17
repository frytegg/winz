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
 * Whether a manual pause is in force (SPEC CA-4, CA-5). The web API writes `paused_manual` at
 * once when the merchant pauses, before the transaction is mined, and on resume only enqueues a
 * job, so the pause is in force when:
 *
 * - the campaign is paused on-chain (`status = paused`), whatever job is waiting: a resume
 *   counts only once it is mined and projected; or
 * - its latest pause job asks for a pause and the campaign has not been paused on-chain since that
 *   job was enqueued: the transaction is still on its way (or failed: the merchant asked for a
 *   pause and still sees one, and can resume by hand). If it was paused on-chain since and is no
 *   longer paused, a resume reached the chain without a job and the pause is over.
 *
 * A resume job, mined or not, never makes a campaign paused; a pause and a resume both waiting
 * leave the campaign selling until the pause is mined (the merchant's last word was "resume").
 */
export function isManuallyPaused(input: ManualPauseInput): boolean {
  if (input.status === "paused") return true;
  const job = input.latestPauseJob;
  if (job === null || !job.paused) return false;
  const pausedOnChainSinceJob =
    input.lastOnChainPauseAtMs !== null &&
    input.lastOnChainPauseAtMs >= floorToSecond(job.createdAtMs);
  return !pausedOnChainSinceJob;
}
