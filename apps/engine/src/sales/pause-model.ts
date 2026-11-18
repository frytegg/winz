import type { CampaignStatus } from "@winz/shared";

import type { ManualPauseInput, PauseJobView } from "./manual-pause";

/**
 * Test support for the manual pause rule: a model of one campaign's pause and resume jobs and
 * `CampaignPaused` events, with the transitions the job worker, the transaction sender and the
 * projector make, and the generator of every order in which they can happen. Not part of the
 * module's API (not exported by `index.ts`).
 */

/** A scenario the model cannot play: a step out of order, or orders that leave a job stuck. */
export class PauseModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PauseModelError";
  }
}

/** What happens to a pause or resume job and its transaction. */
export type PausePhase =
  /** The web API enqueued the job (`queued`). */
  | "requested"
  /** A worker claimed it (`running`). */
  | "running"
  /** The attempt failed and the worker put it back to `queued` with a later `run_at`. */
  | "retry"
  /** Its attempts are used up, or the handler said retrying is pointless (`dead`), no transaction mined. */
  | "dead"
  /** The handler found nothing to send (superseded, or the chain already as asked) (`done`). */
  | "nothing-sent"
  /** Its transaction is mined; the sender stored the receipt's events at once, unprojected. */
  | "mined"
  /** Its event is projected (`processed_at`, `campaigns.status`) and the handler ends the job `done`. */
  | "projected";

export interface PauseStep {
  /** The job's name in the scenario: a name starting with "pause" asks for a pause, any other for a resume. */
  job: string;
  phase: PausePhase;
}

export function stepName(step: PauseStep): string {
  return `${step.job}:${step.phase}`;
}

/** Whether the job named `job` asks for a pause. */
export function asksPause(job: string): boolean {
  return job.startsWith("pause");
}

/** The job worker's states (`jobs.status`). */
export type ModelJobStatus = "queued" | "running" | "done" | "dead";

interface ModelJob {
  paused: boolean;
  createdAtMs: number;
  status: ModelJobStatus;
  /** Its transaction is mined (`chain_txs.status = 'mined'`). */
  txMined: boolean;
  /** Transient failures so far (`retry` steps). */
  retries: number;
}

/** A job of the model as a test reads it. */
export interface ModelJobView {
  job: string;
  paused: boolean;
  status: ModelJobStatus;
  txMined: boolean;
}

interface ModelEvent {
  job: string;
  paused: boolean;
  /** Block time, whole seconds. */
  blockTimeMs: number;
  projected: boolean;
}

/**
 * One campaign, live on-chain at the start. `apply` makes one transition at `nowMs`; `input` is
 * what the store reads for `isManuallyPaused`; `chainPaused` is what the escrow says.
 */
export class PauseModel {
  private readonly jobs = new Map<string, ModelJob>();
  /** In chain order: the sender stores a receipt's events when it is mined. */
  private readonly events: ModelEvent[] = [];
  private status: CampaignStatus = "live";

  apply(step: PauseStep, nowMs: number): void {
    const job = this.jobs.get(step.job);
    if (step.phase === "requested") {
      if (job !== undefined) throw new PauseModelError(`${stepName(step)}: requested twice`);
      this.jobs.set(step.job, {
        paused: asksPause(step.job),
        createdAtMs: nowMs,
        status: "queued",
        txMined: false,
        retries: 0,
      });
      return;
    }
    if (job === undefined) throw new PauseModelError(`${stepName(step)}: never requested`);
    switch (step.phase) {
      case "running":
        job.status = "running";
        return;
      case "retry":
        job.status = "queued";
        job.retries += 1;
        return;
      case "dead":
        job.status = "dead";
        return;
      case "nothing-sent":
        job.status = "done";
        return;
      case "mined":
        job.txMined = true;
        this.events.push({
          job: step.job,
          paused: job.paused,
          blockTimeMs: Math.floor(nowMs / 1000) * 1000,
          projected: false,
        });
        return;
      case "projected": {
        const event = this.events.find((candidate) => candidate.job === step.job);
        if (event === undefined) throw new PauseModelError(`${stepName(step)}: nothing mined`);
        event.projected = true;
        // The projector sets the status from the LAST stored event in chain order, not from the
        // event it applies (chain/projector.ts: latestPauseState).
        const last = this.events[this.events.length - 1];
        this.status = last?.paused === true ? "paused" : "live";
        job.status = "done";
        return;
      }
    }
  }

  /** The jobs requested so far, in the order of their requests. */
  jobsView(): ModelJobView[] {
    return [...this.jobs.entries()].map(([job, state]) => ({
      job,
      paused: state.paused,
      status: state.status,
      txMined: state.txMined,
    }));
  }

  /** The merchant's latest request, or null before the first. */
  latest(): ModelJobView | null {
    return this.jobsView().at(-1) ?? null;
  }

  /**
   * The steps the job worker, the handler (`jobs/handlers/campaign-actions.ts`), the transaction
   * sender and the projector can take next, for the jobs requested so far (the merchant's next
   * request is the caller's). A job takes at most `maxRetries` transient failures.
   *
   * - a `queued` job is claimed (`running`);
   * - a `running` job whose transaction is not mined decides, under the campaign's lock (held by
   *   a running job whose transaction is mined until it has projected it), with the chain final
   *   (every other action's transaction mined: a decision and its mining are one step here, the
   *   store reads only mined transactions): superseded by a later request, or the chain already
   *   as asked, it sends nothing (`nothing-sent`); otherwise its transaction is mined (`mined`);
   * - a running job whose transaction is mined projects it and ends (`projected`);
   * - a running job can fail transiently (`retry`) before or after its transaction is mined.
   */
  nextSteps(maxRetries = 0): PauseStep[] {
    const steps: PauseStep[] = [];
    const names = [...this.jobs.keys()];
    const latest = names[names.length - 1];
    const lockHolder = names.find((name) => {
      const job = this.jobs.get(name);
      return job !== undefined && job.status === "running" && job.txMined;
    });
    for (const [name, job] of this.jobs) {
      if (job.status === "queued") {
        steps.push({ job: name, phase: "running" });
        continue;
      }
      if (job.status !== "running") continue;
      if (job.retries < maxRetries) steps.push({ job: name, phase: "retry" });
      if (job.txMined) {
        steps.push({ job: name, phase: "projected" });
      } else if (lockHolder === undefined) {
        const nothingToSend = name !== latest || this.chainPaused() === job.paused;
        steps.push({ job: name, phase: nothingToSend ? "nothing-sent" : "mined" });
      }
    }
    return steps;
  }

  /** What the escrow says: the `paused` argument of the last mined `CampaignPaused`. */
  chainPaused(): boolean {
    return this.events[this.events.length - 1]?.paused ?? false;
  }

  input(): ManualPauseInput {
    let latest: PauseJobView | null = null;
    // Jobs are requested in the order of the map, each later than the one before.
    for (const job of this.jobs.values()) {
      latest = { paused: job.paused, createdAtMs: job.createdAtMs };
    }
    let lastPause: number | null = null;
    for (const event of this.events) {
      if (event.projected && event.paused) {
        lastPause = Math.max(lastPause ?? event.blockTimeMs, event.blockTimeMs);
      }
    }
    return {
      status: this.status,
      pauseJobInFlight: [...this.jobs.values()].some(
        (job) => (job.status === "queued" || job.status === "running") && !job.txMined,
      ),
      pauseEventUnprojected: this.events.some((event) => !event.projected),
      latestPauseJob: latest,
      lastOnChainPauseAtMs: lastPause,
    };
  }
}

/** The steps of a job that is mined and projected, with `retries` transient failures first. */
export function minedJobSteps(job: string, retries = 0): PauseStep[] {
  const steps: PauseStep[] = [
    { job, phase: "requested" },
    { job, phase: "running" },
  ];
  for (let i = 0; i < retries; i += 1) {
    steps.push({ job, phase: "retry" }, { job, phase: "running" });
  }
  steps.push({ job, phase: "mined" }, { job, phase: "projected" });
  return steps;
}

/**
 * Every order of a pause's steps and the following resume's steps that the system allows: each
 * job's steps in their order, the resume requested after the pause (the merchant's order), and
 * the resume mined after the pause (the set_paused jobs of a campaign run under one lock, and a
 * resume waits for the pause's transaction to be final, `jobs/handlers/campaign-actions.ts`).
 * Everything else is free: a job can be claimed, retried, mined and projected at any point
 * relative to the other, including the resume projected before the pause.
 */
export function pauseResumeOrders(
  pause: readonly PauseStep[],
  resume: readonly PauseStep[],
): PauseStep[][] {
  const orders: PauseStep[][] = [];
  const pausePassed = (index: number, phase: PausePhase): boolean =>
    pause.slice(0, index).some((step) => step.phase === phase);
  const walk = (i: number, j: number, prefix: PauseStep[]): void => {
    if (i === pause.length && j === resume.length) {
      orders.push(prefix);
      return;
    }
    const nextPause = pause[i];
    if (nextPause !== undefined) walk(i + 1, j, [...prefix, nextPause]);
    const nextResume = resume[j];
    if (nextResume !== undefined) {
      const allowed =
        (nextResume.phase !== "requested" || pausePassed(i, "requested")) &&
        (nextResume.phase !== "mined" || pausePassed(i, "mined"));
      if (allowed) walk(i, j + 1, [...prefix, nextResume]);
    }
  };
  walk(0, 0, []);
  return orders;
}

export interface RequestOrdersOptions {
  /** Steps played first (a pause already on-chain, for instance). Default none. */
  prefix?: readonly PauseStep[];
  /** Transient failures each job may take (`PauseModel.nextSteps`). Default 0. */
  maxRetries?: number;
  /** Stops after this many orders (a guard against a scenario too large). Default 200 000. */
  limit?: number;
}

/** The time of the `index`-th step of a scenario: one second apart. */
export function stepTime(t0Ms: number, index: number): number {
  return t0Ms + index * 1_000;
}

/** A model with `steps` played one second apart from `t0Ms`. */
export function replay(steps: readonly PauseStep[], t0Ms: number): PauseModel {
  const model = new PauseModel();
  steps.forEach((step, index) => {
    model.apply(step, stepTime(t0Ms, index));
  });
  return model;
}

/**
 * Every order in which the merchant's `requests` (job names, in the merchant's order, each made
 * at any point after the one before) and the system's steps (`PauseModel.nextSteps`, which decide
 * what each job does from the state it finds) can happen, after `prefix`. Each order ends when no
 * step is left; a job not ended then is stuck, and throws `PauseModelError`.
 */
export function requestOrders(
  requests: readonly string[],
  options: RequestOrdersOptions = {},
): PauseStep[][] {
  const prefix = options.prefix ?? [];
  const maxRetries = options.maxRetries ?? 0;
  const limit = options.limit ?? 200_000;
  const t0 = 0;
  const orders: PauseStep[][] = [];
  const walk = (path: PauseStep[], requested: number): void => {
    const model = replay([...prefix, ...path], t0);
    const candidates = model.nextSteps(maxRetries);
    const next = requests[requested];
    if (next !== undefined) candidates.push({ job: next, phase: "requested" });
    if (candidates.length === 0) {
      const stuck = model.jobsView().filter((job) => job.status !== "done");
      if (stuck.length > 0) {
        throw new PauseModelError(
          `stuck after ${path.map(stepName).join(", ")}: ${stuck.map((job) => job.job).join(", ")}`,
        );
      }
      orders.push(path);
      if (orders.length > limit) {
        throw new PauseModelError(`more than ${String(limit)} orders`);
      }
      return;
    }
    for (const step of candidates) {
      walk([...path, step], step.phase === "requested" ? requested + 1 : requested);
    }
  };
  walk([], 0);
  return orders;
}

/**
 * One order of `requestOrders`, drawn at random: at each point, one of the possible next steps
 * (the merchant's next request among them), chosen with `random` (in [0, 1)). For scenarios too
 * large to walk in full (retries, many requests). Throws `PauseModelError` on a stuck job.
 */
export function randomRequestOrder(
  requests: readonly string[],
  random: () => number,
  options: Omit<RequestOrdersOptions, "limit"> = {},
): PauseStep[] {
  const prefix = options.prefix ?? [];
  const maxRetries = options.maxRetries ?? 0;
  const path: PauseStep[] = [];
  let requested = 0;
  for (;;) {
    const model = replay([...prefix, ...path], 0);
    const candidates = model.nextSteps(maxRetries);
    const next = requests[requested];
    if (next !== undefined) candidates.push({ job: next, phase: "requested" });
    const step = candidates[Math.floor(random() * candidates.length)];
    if (step === undefined) {
      const stuck = model.jobsView().filter((job) => job.status !== "done");
      if (stuck.length > 0) {
        throw new PauseModelError(
          `stuck after ${path.map(stepName).join(", ")}: ${stuck.map((job) => job.job).join(", ")}`,
        );
      }
      return path;
    }
    path.push(step);
    if (step.phase === "requested") requested += 1;
  }
}
