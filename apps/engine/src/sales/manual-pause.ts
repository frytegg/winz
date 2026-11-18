import type { CampaignStatus } from "@winz/shared";

/** The latest `campaign.set_paused` job of a campaign, as far as the pause rule needs it. */
export interface PauseJobView {
  /** What the merchant asked for: true to pause, false to resume. */
  paused: boolean;
  /**
   * For a pause: the pause of THIS request is on-chain as far as the projection knows, i.e. the
   * `CampaignPaused(paused = true)` event of the request's own `setPaused` transaction (the
   * `chain_txs` row whose payload carries its `requestId`, mined, and the events of its hash) is
   * projected. A pause that sent no transaction (it found the chain already paused) or none that
   * was mined (its job died) has none. Always false for a resume.
   */
  pauseProjected: boolean;
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
  /**
   * The merchant's latest `campaign.set_paused` job naming the campaign (the newest stamp: the
   * request that took the campaign's lock last), or null when there is none.
   */
  latestPauseJob: PauseJobView | null;
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
 * d. its latest pause job asked for a pause, and THAT request's own pause has not been seen
 *    on-chain (`pauseProjected`: the event of its own transaction, projected). With (b) out of
 *    the way this is the case of a pause job that finished without its pause reaching the
 *    chain: it died (attempts used up, or a revert no attempt can change), and the merchant, who
 *    asked for a pause and still sees one, resumes by hand. No other pause counts for it, however
 *    close in time: an earlier pause mined in the very second the request was made, since
 *    resumed, says nothing about this request. If its own pause was projected and the campaign is
 *    live again, a resume reached the chain without a job and the pause is over.
 *
 *    A pause job that found the chain already paused sends no transaction, so its pause is never
 *    "seen" and (d) holds for as long as it is the latest request. That is what the merchant
 *    asked: while the chain is paused (a) holds anyway, so nothing changes there; the sale never
 *    reopens while the chain is paused ((a), (c)); and it does not stay `paused_manual` after the
 *    merchant's later resume lands, because that resume is then the latest request and (d) no
 *    longer applies. Only a resume that reached the chain without any request (outside the
 *    engine) leaves it paused, until the merchant resumes: their latest word is still a pause.
 *    No time is compared any more: a block time has a one-second granularity, and the order of
 *    two pauses in one second cannot be read from it.
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
  return !job.pauseProjected;
}
