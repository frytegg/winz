import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import {
  JOB_KINDS,
  closeSalesJobSchema,
  createCampaignJobSchema,
  purchaseJobSchema,
  setPausedJobSchema,
} from "@winz/shared";

import { defaultBackoff } from "../backoff";
import { JobConfigError } from "../errors";
import { JobWorker, type JobWorkerConfig } from "../worker";
import { createCloseSalesHandler, createSetPausedHandler } from "./campaign-actions";
import { createCampaignCreationHandler } from "./create-campaign";
import type { JobHandlerDeps } from "./deps";
import { createPurchaseHandler } from "./purchase";

/** Registers the four job handlers of the web app's job contract, each with its payload schema. */
export function registerJobHandlers(
  worker: Pick<JobWorker, "register">,
  deps: JobHandlerDeps,
): void {
  worker.register(
    JOB_KINDS.createCampaign,
    createCampaignJobSchema,
    createCampaignCreationHandler(deps),
  );
  worker.register(JOB_KINDS.purchase, purchaseJobSchema, createPurchaseHandler(deps));
  worker.register(JOB_KINDS.setPaused, setPausedJobSchema, createSetPausedHandler(deps));
  worker.register(JOB_KINDS.closeSales, closeSalesJobSchema, createCloseSalesHandler(deps));
}

export interface StartJobsOptions extends JobHandlerDeps {
  /** Aborting it stops the worker; in-flight handlers get the worker's shutdown grace. */
  signal: AbortSignal;
  /** Overrides of the worker's configuration (defaults below). */
  worker?: Partial<JobWorkerConfig>;
}

export interface JobsService {
  /** Resolves once the worker has stopped after the signal aborted. Never rejects. */
  stopped: Promise<void>;
}

/**
 * Defaults: a handful of jobs at a time (each purchase holds a pooled connection for its lock
 * and waits up to its transaction's outcome), a quick poll so a sale starts within half a second,
 * and a visibility timeout the heartbeat refreshes well within.
 */
const DEFAULT_WORKER_CONFIG = {
  concurrency: 4,
  pollIntervalMs: 500,
  visibilityTimeoutMs: 30_000,
  shutdownGraceMs: 10_000,
} as const;

/**
 * Builds a `JobWorker` with the four handlers and starts it, in the style of `startChainIngest`:
 * returns at once, stops when `signal` aborts.
 *
 * Each running handler holds one pooled connection for its lock (see `withExclusiveLock`) and
 * needs others for its queries, the transaction sender and the worker's own heartbeat. A
 * concurrency that reaches the pool's size would let the lock transactions take every connection
 * while each handler waits for one more: it is refused (`JobConfigError`). Size the pool well
 * above the concurrency (the engine's default pool of 10 leaves 6 connections at concurrency 4).
 */
export function startJobs(options: StartJobsOptions): JobsService {
  const { signal, worker: overrides, ...deps } = options;
  const config: JobWorkerConfig = {
    ...DEFAULT_WORKER_CONFIG,
    workerId: `engine-${hostname()}-${process.pid.toString()}-${randomUUID().slice(0, 8)}`,
    backoff: defaultBackoff,
    ...overrides,
  };
  const poolSize = deps.db.options.max;
  if (config.concurrency >= poolSize) {
    throw new JobConfigError(
      `job worker concurrency ${config.concurrency.toString()} must be below the database pool size ` +
        `${poolSize.toString()}: each running handler holds a connection for its lock`,
    );
  }
  const worker = new JobWorker({ db: deps.db, logger: deps.logger, clock: deps.clock, config });
  registerJobHandlers(worker, deps);
  if (signal.aborted) return { stopped: Promise.resolve() };
  worker.start();
  const stopped = new Promise<void>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        void worker.stop().then(resolve);
      },
      { once: true },
    );
  });
  return { stopped };
}
