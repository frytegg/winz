import type { CampaignStatus } from "@winz/shared";

import type { ManualPauseInput, PauseJobView } from "./manual-pause";

/**
 * Test support for the manual pause rule: a model of one campaign's pause and resume jobs and
 * `CampaignPaused` events, with the transitions the job worker, the transaction sender and the
 * projector make, and the generator of every order in which they can happen. Not part of the
 * module's API (not exported by `index.ts`).
 */

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
      if (job !== undefined) throw new Error(`${stepName(step)}: requested twice`);
      this.jobs.set(step.job, {
        paused: asksPause(step.job),
        createdAtMs: nowMs,
        status: "queued",
        txMined: false,
      });
      return;
    }
    if (job === undefined) throw new Error(`${stepName(step)}: never requested`);
    switch (step.phase) {
      case "running":
        job.status = "running";
        return;
      case "retry":
        job.status = "queued";
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
        if (event === undefined) throw new Error(`${stepName(step)}: nothing mined`);
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
