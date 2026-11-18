import type { Logger } from "pino";
import type { TransactionSql } from "postgres";
import { encodeFunctionData } from "viem";

import { JOB_KINDS, winzEscrowAbi, type CloseSalesJob, type SetPausedJob } from "@winz/shared";

import type { Db } from "../../db";
import { isManuallyPaused, loadManualPauseInput } from "../../sales";
import { PermanentJobError, RetryLaterError } from "../errors";
import type { JobContext, JobHandler } from "../worker";
import {
  awaitOutcome,
  JobStateError,
  lockTransactionEvents,
  projectEvents,
  readTxAttempt,
  resendDelay,
  runUntilSettled,
  sendOrResume,
  withExclusiveLock,
  type PreparedTx,
} from "./common";
import { resolveOptions, type JobHandlerDeps, type ResolvedJobHandlerOptions } from "./deps";

/** `Status` of a campaign in the escrow (IWinzEscrow): Live, Paused, then settled or void. */
const ONCHAIN_LIVE = 0;
const ONCHAIN_PAUSED = 1;

/** The transaction kinds of the merchant's actions, which this module serialises per campaign. */
const ACTION_TX_KINDS = ["setPaused", "closeSales"] as const;

interface CampaignRow {
  id: string;
  onchain_id: bigint | null;
  status: string;
}

interface CampaignAction {
  /** Idempotency key of the transaction (attempt 1; `<base>:<n>` after). */
  base: string;
  /** For the logs. */
  name: "setPaused" | "closeSales";
  /** The request of a new attempt, or null when there is nothing to send (any more). */
  prepare: (onchainId: bigint) => Promise<PreparedTx | null>;
  /**
   * Reverts meaning the action is no longer possible or no longer needed: the job ends done,
   * with a warning, and nothing is written.
   */
  noLongerPossible: ReadonlySet<string>;
  /** Reverts that no later attempt can change: the job ends `dead`, logged at error. */
  permanent: ReadonlySet<string>;
  /**
   * Off-chain writes made with the projection of the mined receipt, in the same transaction,
   * after it (the campaign row locked, its events projected). The public row is synced after.
   */
  onMined: (sql: TransactionSql, campaignId: string) => Promise<void>;
  /** Off-chain writes when `prepare` decided there was nothing to send. */
  onNothingSent: (campaignId: string) => Promise<void>;
}

async function loadCampaign(deps: JobHandlerDeps, campaignId: string): Promise<CampaignRow> {
  const [row] = await deps.db<CampaignRow[]>`
    select id, onchain_id, status from campaigns where id = ${campaignId}
  `;
  if (row === undefined) throw new PermanentJobError(`campaign ${campaignId} does not exist`);
  return row;
}

/**
 * Waits for the merchant-action transactions of this campaign that other jobs queued and that
 * are not final yet (`RetryLaterError` when the wait runs out). Every pause, resume and close of
 * a campaign is decided against a chain that no earlier action can still change: a resume never
 * concludes "not paused" while the pause before it is in flight.
 */
async function waitForOtherActions(
  deps: JobHandlerDeps,
  options: ResolvedJobHandlerOptions,
  ctx: JobContext,
  campaignId: string,
  base: string,
): Promise<void> {
  const rows = await deps.db<{ id: string; idempotency_key: string }[]>`
    select id, idempotency_key from chain_txs
    where kind in ${deps.db([...ACTION_TX_KINDS])} and status in ('queued', 'sent')
      and payload ->> 'campaignId' = ${campaignId}
    order by created_at
  `;
  for (const row of rows) {
    if (row.idempotency_key === base || row.idempotency_key.startsWith(`${base}:`)) continue;
    await awaitOutcome(deps, options, ctx, row.id);
  }
}

/** Copies the campaign's sale state into its public row (`live_campaigns`), if it has one. */
async function syncLiveSaleState(sql: TransactionSql, campaignId: string): Promise<void> {
  await sql`
    update live_campaigns lc set sale_state = c.sale_state
    from campaigns c
    where c.id = ${campaignId} and lc.slug = c.slug and lc.sale_state is distinct from c.sale_state
  `;
}

/** Sends (or resumes) the action's transaction, then projects its receipt or reads its revert. */
async function runCampaignAction(
  deps: JobHandlerDeps,
  log: Logger,
  ctx: JobContext,
  campaignId: string,
  action: CampaignAction,
): Promise<void> {
  const options = resolveOptions(deps.options);
  const campaign = await loadCampaign(deps, campaignId);
  const onchainId = campaign.onchain_id;
  if (onchainId === null) {
    throw new PermanentJobError(
      `campaign ${campaignId} is not on-chain, ${action.name} cannot run`,
    );
  }
  await waitForOtherActions(deps, options, ctx, campaignId, action.base);
  const sent = await sendOrResume(
    deps,
    options,
    ctx,
    action.base,
    () => action.prepare(onchainId),
    {
      resendAfter: (reason) =>
        !action.noLongerPossible.has(reason) && !action.permanent.has(reason),
    },
  );
  if (sent === null) {
    await action.onNothingSent(campaignId);
    return;
  }
  const fields = {
    campaignId,
    onchainId: onchainId.toString(),
    txId: sent.txId,
    attempt: sent.attempt,
    action: action.name,
  };

  if (sent.outcome.status === "mined") {
    const tx = await readTxAttempt(deps.db, action.base, sent.txId);
    const txHash = tx.txHash;
    if (txHash === null) throw new JobStateError(`mined transaction ${sent.txId} has no hash`);
    await deps.db.begin(async (sql) => {
      await sql`select id from campaigns where id = ${campaignId} for update`;
      const events = await lockTransactionEvents(sql, txHash);
      // Projected first, so that `onMined` decides on the campaign as the chain now has it (its
      // status, the event processed); the public row then takes the sale state it wrote.
      await projectEvents(sql, events);
      await action.onMined(sql, campaignId);
      await syncLiveSaleState(sql, campaignId);
    });
    log.info({ ...fields, txHash }, `${action.name} written on-chain`);
    return;
  }

  const reason = sent.outcome.error ?? "unknown error";
  if (action.noLongerPossible.has(reason)) {
    log.warn({ ...fields, reason }, `${action.name} no longer possible on-chain; nothing to do`);
    return;
  }
  if (action.permanent.has(reason)) {
    log.error({ ...fields, reason, status: sent.outcome.status }, `${action.name} failed on-chain`);
    throw new PermanentJobError(
      `${action.name} of campaign ${campaignId} ended '${sent.outcome.status}': ${reason}`,
    );
  }
  const delayMs = resendDelay(options, sent.attempt);
  log.error(
    { ...fields, reason, status: sent.outcome.status, retryInMs: delayMs },
    `${action.name} failed on-chain; a new attempt follows`,
  );
  throw new RetryLaterError(
    delayMs,
    `${action.name} of campaign ${campaignId} ended '${sent.outcome.status}' (${reason}); attempt ${(sent.attempt + 1).toString()} follows`,
  );
}

/**
 * Runs an action under the campaign's lock, so the pause, resume and close jobs of a campaign
 * never interleave, and keeps the job alive through passing conditions: the merchant's request is
 * carried out, or found no longer possible, never dropped because a node was down for a while.
 */
function campaignActionHandler<T extends { campaignId: string }>(
  deps: JobHandlerDeps,
  log: Logger,
  action: (payload: T) => CampaignAction,
): JobHandler<T> {
  const { retryDelayMs } = resolveOptions(deps.options);
  return (payload, ctx) =>
    runUntilSettled(
      deps,
      log,
      ctx,
      { campaignId: payload.campaignId },
      () => Promise.resolve(true),
      () =>
        withExclusiveLock(deps.db, `job:campaign-action:${payload.campaignId}`, retryDelayMs, () =>
          runCampaignAction(deps, log, ctx, payload.campaignId, action(payload)),
        ),
    );
}

/** The latest pause or resume the merchant asked for: the newest `setPaused` job's request. */
async function latestPauseRequest(
  sql: Db | TransactionSql,
  campaignId: string,
): Promise<{ requestId: string | null; paused: boolean | null } | null> {
  const [row] = await sql<{ request_id: string | null; paused: boolean | null }[]>`
    select payload ->> 'requestId' as request_id, (payload ->> 'paused')::boolean as paused
    from jobs
    where kind = ${JOB_KINDS.setPaused} and payload ->> 'campaignId' = ${campaignId}
    order by created_at desc, id desc
    limit 1
  `;
  return row === undefined ? null : { requestId: row.request_id, paused: row.paused };
}

/** Whether `requestId` is the merchant's latest request (or the only one known). */
async function isLatestRequest(
  sql: Db | TransactionSql,
  campaignId: string,
  requestId: string,
): Promise<boolean> {
  const latest = await latestPauseRequest(sql, campaignId);
  return latest === null || latest.requestId === requestId;
}

/**
 * The sale state of the merchant's request, once the chain matches it, unless a later request
 * exists (that request's job writes its own). Called with the campaign row locked, in the
 * transaction that projected the request's receipt (or that found nothing to send).
 *
 * A pause writes `paused_manual`: the merchant's pause is the sale state until a resume.
 *
 * A resume writes `open` only when the manual pause rule (`isManuallyPaused`), read in this same
 * transaction, says the pause is over: the resume is mined and projected, no other pause or
 * resume of the campaign is in flight, no pause event waits for its projection. Otherwise it
 * writes nothing, and the sale state service reopens the sale once the rule allows it. A handler
 * writing `open` while the rule still says paused made the public page flap: a resume that finds
 * the chain already live sends nothing and ends while its job is still `running`, which the rule
 * counts as in flight, so `open`, then `paused_manual` at the next pass, then `open` again once
 * the worker marked the job done; the same with a mined resume while an earlier, superseded
 * request was still waiting for the lock. Gated by the rule, the sale state only ever moves from
 * `paused_manual` to `open` once, never back without a new request. A reopened sale leaves the
 * automatic pauses to the pricing that runs at every sale state pass and at every sale.
 */
export async function applyRequestedSaleState(
  sql: Db | TransactionSql,
  campaignId: string,
  requestId: string,
  paused: boolean,
): Promise<void> {
  if (!(await isLatestRequest(sql, campaignId, requestId))) return;
  if (paused) {
    await sql`
      update campaigns set sale_state = 'paused_manual'
      where id = ${campaignId} and sale_state <> 'closed' and status in ('live', 'paused')
    `;
    return;
  }
  const rule = await loadManualPauseInput(sql, campaignId);
  if (rule === null || isManuallyPaused(rule)) return;
  await sql`
    update campaigns set sale_state = 'open'
    where id = ${campaignId} and sale_state = 'paused_manual' and status in ('live', 'paused')
  `;
}

/** The escrow's `Status` of the campaign, read from the chain. */
async function onchainStatus(
  deps: JobHandlerDeps,
  options: ResolvedJobHandlerOptions,
  onchainId: bigint,
): Promise<number> {
  try {
    const campaign = await deps.publicClient.readContract({
      address: deps.escrowAddress,
      abi: winzEscrowAbi,
      functionName: "getCampaign",
      args: [onchainId],
    });
    return campaign.status;
  } catch {
    throw new RetryLaterError(
      options.retryDelayMs,
      `the escrow's status of campaign ${onchainId.toString()} cannot be read now`,
    );
  }
}

/**
 * The merchant's manual pause or resume (SPEC CA-4, CA-5: the only pause written on-chain), key
 * `setPaused:<request id>`. Under the campaign's lock, after the other actions in flight are
 * final, the job brings the chain to the merchant's LATEST request: a request superseded by a
 * later one sends nothing (the later job decides), and a campaign already in the requested state
 * sends nothing either. A pause or resume the contract refuses because sales are closed or the
 * campaign is settled ends done with a warning.
 */
export function createSetPausedHandler(deps: JobHandlerDeps): JobHandler<SetPausedJob> {
  const log = deps.logger.child({ module: "jobs.set-paused" });
  const options = resolveOptions(deps.options);
  return campaignActionHandler<SetPausedJob>(deps, log, (payload) => {
    const fields = {
      campaignId: payload.campaignId,
      requestId: payload.requestId,
      paused: payload.paused,
    };
    return {
      base: `setPaused:${payload.requestId}`,
      name: "setPaused",
      prepare: async (onchainId) => {
        if (!(await isLatestRequest(deps.db, payload.campaignId, payload.requestId))) {
          log.info(fields, "pause or resume superseded by a later request; nothing to send");
          return null;
        }
        const status = await onchainStatus(deps, options, onchainId);
        if (status !== ONCHAIN_LIVE && status !== ONCHAIN_PAUSED) {
          log.warn({ ...fields, status }, "campaign settled on-chain; nothing to pause or resume");
          return null;
        }
        if ((status === ONCHAIN_PAUSED) === payload.paused) {
          log.info(fields, "campaign already in the requested state on-chain; nothing to send");
          return null;
        }
        return {
          signer: "relayer",
          kind: "setPaused",
          to: deps.escrowAddress,
          data: encodeFunctionData({
            abi: winzEscrowAbi,
            functionName: "setPaused",
            args: [onchainId, payload.paused],
          }),
          payload: {
            campaignId: payload.campaignId,
            paused: payload.paused,
            requestId: payload.requestId,
          },
        };
      },
      // InvalidParams: pausing a paused campaign or resuming a live one (the chain changed
      // between the read above and the call, outside this engine).
      noLongerPossible: new Set(["SalesAreClosed", "AlreadySettled", "InvalidParams"]),
      permanent: new Set(["CampaignNotFound"]),
      onMined: (sql, campaignId) =>
        applyRequestedSaleState(sql, campaignId, payload.requestId, payload.paused),
      onNothingSent: (campaignId) =>
        deps.db.begin(async (sql) => {
          await sql`select id from campaigns where id = ${campaignId} for update`;
          await applyRequestedSaleState(sql, campaignId, payload.requestId, payload.paused);
          await syncLiveSaleState(sql, campaignId);
        }),
    };
  });
}

/**
 * The merchant closes sales early (SPEC CA-4), key `closeSales:<campaign id>`, under the same
 * per-campaign lock as the pauses. Sales already closed (or the campaign settled) end the job done
 * with a warning; a failure that may change gets a new attempt later.
 */
export function createCloseSalesHandler(deps: JobHandlerDeps): JobHandler<CloseSalesJob> {
  const log = deps.logger.child({ module: "jobs.close-sales" });
  return campaignActionHandler<CloseSalesJob>(deps, log, (payload) => ({
    base: `closeSales:${payload.campaignId}`,
    name: "closeSales",
    prepare: (onchainId) =>
      Promise.resolve({
        signer: "relayer",
        kind: "closeSales",
        to: deps.escrowAddress,
        data: encodeFunctionData({
          abi: winzEscrowAbi,
          functionName: "closeSales",
          args: [onchainId],
        }),
        payload: { campaignId: payload.campaignId },
      }),
    noLongerPossible: new Set(["SalesAreClosed", "AlreadySettled"]),
    permanent: new Set(["CampaignNotFound", "InvalidParams"]),
    onMined: async (sql, campaignId) => {
      await sql`
        update campaigns
        set sale_state = 'closed',
            status = case when status in ('live', 'paused') then 'sales_closed' else status end
        where id = ${campaignId}
      `;
    },
    onNothingSent: () => Promise.resolve(),
  }));
}
