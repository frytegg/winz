import { describe, expect, it } from "vitest";

import { isManuallyPaused, type ManualPauseInput } from "./manual-pause";
import {
  PauseModel,
  PauseModelError,
  minedJobSteps,
  pauseResumeOrders,
  randomRequestOrder,
  replay,
  requestOrders,
  stepName,
  stepTime,
  type PauseStep,
} from "./pause-model";
import { seededRandom } from "./test-support";

const T0 = 1_800_000_000_500; // half a second into a block second

/** Nothing in flight, nothing unprojected, no job: a live campaign never paused. */
const SETTLED: ManualPauseInput = {
  status: "live",
  pauseJobInFlight: false,
  pauseEventUnprojected: false,
  latestPauseJob: null,
};

function settled(overrides: Partial<ManualPauseInput>): ManualPauseInput {
  return { ...SETTLED, ...overrides };
}

/** A pause request whose own pause was not seen on-chain (`pauseProjected` false). */
const PAUSE_NOT_SEEN = { paused: true, pauseProjected: false };
/** A pause request whose own `CampaignPaused(true)` was projected. */
const PAUSE_SEEN = { paused: true, pauseProjected: true };
const RESUME = { paused: false, pauseProjected: false };

describe("isManuallyPaused: each condition", () => {
  it("is not paused without any pause job on a live campaign", () => {
    expect(isManuallyPaused(SETTLED)).toBe(false);
  });

  it("a: the projected status is paused, even with no job (a pause made on-chain directly)", () => {
    expect(isManuallyPaused(settled({ status: "paused" }))).toBe(true);
  });

  it("b: a pause or resume job is not finished, whatever it asks", () => {
    for (const job of [PAUSE_NOT_SEEN, PAUSE_SEEN, RESUME]) {
      expect(isManuallyPaused(settled({ pauseJobInFlight: true, latestPauseJob: job }))).toBe(true);
    }
  });

  it("c: a pause or resume event is stored and not projected", () => {
    expect(isManuallyPaused(settled({ pauseEventUnprojected: true }))).toBe(true);
    expect(isManuallyPaused(settled({ pauseEventUnprojected: true, latestPauseJob: RESUME }))).toBe(
      true,
    );
  });

  it("d: the latest pause job asked for a pause the chain has not shown for it (a dead pause)", () => {
    expect(isManuallyPaused(settled({ latestPauseJob: PAUSE_NOT_SEEN }))).toBe(true);
    // An older on-chain pause (an earlier request's, since resumed) does not count.
    const model = replay(
      [
        ...minedJobSteps("pause"),
        ...minedJobSteps("resume"),
        { job: "pause2", phase: "requested" },
        { job: "pause2", phase: "running" },
        { job: "pause2", phase: "dead" },
      ],
      T0,
    );
    expect(model.input().latestPauseJob).toEqual(PAUSE_NOT_SEEN);
    expect(isManuallyPaused(model.input())).toBe(true);
  });

  it("d is over when the request's own pause was projected and a resume reached the chain without a job", () => {
    expect(isManuallyPaused(settled({ latestPauseJob: PAUSE_SEEN }))).toBe(false);
  });

  it("d counts the request's own pause mined in the second of its job, even in a block stamped before it", () => {
    // Block times are whole seconds: a block stamped T0 − 500 ms (the start of the job's second)
    // may well hold the job's transaction. It is the request's own pause, so it counts.
    const model = new PauseModel();
    model.apply({ job: "pause", phase: "requested" }, T0);
    model.apply({ job: "pause", phase: "running" }, T0 + 100);
    model.apply({ job: "pause", phase: "mined" }, T0 + 200);
    model.apply({ job: "pause", phase: "projected" }, T0 + 300);
    expect(model.input().latestPauseJob).toEqual(PAUSE_SEEN);
    // The chain is paused (a); were it resumed without a job, the pause would be over.
    expect(isManuallyPaused({ ...model.input(), status: "live" })).toBe(false);
    // A pause from the second before the job's is an older one: another request's pause.
    const older = replay(
      [
        ...minedJobSteps("pause"),
        { job: "pause2", phase: "requested" },
        { job: "pause2", phase: "running" },
        { job: "pause2", phase: "nothing-sent" },
      ],
      T0,
    );
    expect(older.input().latestPauseJob).toEqual(PAUSE_NOT_SEEN);
    expect(isManuallyPaused({ ...older.input(), status: "live" })).toBe(true);
  });

  it("d: a pause requested in the second an earlier pause was mined, whose job dies, keeps the pause", () => {
    // An earlier pause is mined in second s and a resume lands; the merchant pauses again in the
    // same second s and that job dies. The earlier pause is not this request's: the merchant's
    // latest word is a pause the chain never showed, so the sale must not reopen.
    const second = Math.floor(T0 / 1000) * 1000;
    const steps: PauseStep[] = [
      ...minedJobSteps("pause"),
      ...minedJobSteps("resume"),
      { job: "pause2", phase: "requested" },
      { job: "pause2", phase: "running" },
      { job: "pause2", phase: "dead" },
    ];
    const model = new PauseModel();
    steps.forEach((s, index) => {
      model.apply(s, second + index * 50);
    });
    expect(model.chainPaused()).toBe(false);
    expect(model.latest()).toMatchObject({ job: "pause2", paused: true, status: "dead" });
    expect(isManuallyPaused(model.input())).toBe(true);
  });

  it("a pause that found the chain already paused sent nothing: paused while the chain is, and after", () => {
    // pause on-chain, resume requested, pause again before the resume runs: the resume is
    // superseded, the new pause finds the chain paused and sends nothing.
    const model = replay(
      [
        ...minedJobSteps("pause"),
        { job: "resume", phase: "requested" },
        { job: "pause2", phase: "requested" },
        { job: "resume", phase: "running" },
        { job: "resume", phase: "nothing-sent" },
        { job: "pause2", phase: "running" },
        { job: "pause2", phase: "nothing-sent" },
      ],
      T0,
    );
    expect(model.chainPaused()).toBe(true);
    expect(model.input()).toMatchObject({ status: "paused", latestPauseJob: PAUSE_NOT_SEEN });
    expect(isManuallyPaused(model.input())).toBe(true);
    // Its pause is never "seen": the merchant's later resume ends it once it lands, and nothing
    // else does (a resume that reached the chain without a request leaves the latest word, a
    // pause, in force).
    expect(isManuallyPaused({ ...model.input(), status: "live" })).toBe(true);
    for (const s of minedJobSteps("resume2")) model.apply(s, T0 + 60_000);
    expect(model.input()).toMatchObject({ status: "live", latestPauseJob: RESUME });
    expect(isManuallyPaused(model.input())).toBe(false);
  });

  it("a finished resume on a live campaign is not paused: the evaluator decides normally", () => {
    expect(isManuallyPaused(settled({ latestPauseJob: RESUME }))).toBe(false);
  });
});

describe("isManuallyPaused: every combination of a, b, c, d", () => {
  const combinations: { a: boolean; b: boolean; c: boolean; d: boolean }[] = [];
  for (let mask = 0; mask < 16; mask += 1) {
    combinations.push({
      a: (mask & 1) !== 0,
      b: (mask & 2) !== 0,
      c: (mask & 4) !== 0,
      d: (mask & 8) !== 0,
    });
  }

  it.each(combinations)("a=$a b=$b c=$c d=$d", ({ a, b, c, d }) => {
    // d holds with a pause job whose own pause was not seen; it fails with a resume as the latest.
    const input: ManualPauseInput = {
      status: a ? "paused" : "live",
      pauseJobInFlight: b,
      pauseEventUnprojected: c,
      latestPauseJob: d ? PAUSE_NOT_SEEN : RESUME,
    };
    expect(isManuallyPaused(input)).toBe(a || b || c || d);
  });

  it.each(combinations.filter((combination) => !combination.d))(
    "a=$a b=$b c=$c, the latest pause seen on-chain: d fails",
    ({ a, b, c }) => {
      const input: ManualPauseInput = {
        status: a ? "paused" : "live",
        pauseJobInFlight: b,
        pauseEventUnprojected: c,
        latestPauseJob: PAUSE_SEEN,
      };
      expect(isManuallyPaused(input)).toBe(a || b || c);
    },
  );
});

/**
 * Plays `steps` on a fresh model one second apart and returns, after each step, whether the rule
 * says paused and whether the chain is paused.
 */
function play(steps: readonly PauseStep[]): { manual: boolean; chain: boolean; step: string }[] {
  const model = new PauseModel();
  return steps.map((step, index) => {
    model.apply(step, T0 + index * 1_000);
    return {
      manual: isManuallyPaused(model.input()),
      chain: model.chainPaused(),
      step: stepName(step),
    };
  });
}

/** Paused after every step but the last, not paused after it; never "not paused" while the chain is. */
function expectPausedUntilLast(steps: readonly PauseStep[]): void {
  const trace = play(steps);
  const order = trace.map((entry) => entry.step).join(" → ");
  trace.forEach((entry, index) => {
    const last = index === trace.length - 1;
    expect(entry.manual, `after ${entry.step} (step ${String(index + 1)}) in ${order}`).toBe(!last);
    if (entry.chain) {
      expect(entry.manual, `chain paused after ${entry.step} in ${order}`).toBe(true);
    }
  });
}

describe("isManuallyPaused: every order of a pause and its resume", () => {
  const plain = pauseResumeOrders(minedJobSteps("pause"), minedJobSteps("resume"));

  it("generates every allowed interleaving", () => {
    // 70 interleavings of two chains of four, minus those with the resume requested before the
    // pause or mined before it.
    expect(plain.length).toBeGreaterThan(20);
    expect(new Set(plain.map((order) => order.map(stepName).join(","))).size).toBe(plain.length);
    // Among them, the case CI hit and the back-to-back case.
    const names = plain.map((order) => order.map(stepName).join(","));
    expect(names).toContain(
      "pause:requested,pause:running,pause:mined,resume:requested,pause:projected,resume:running,resume:mined,resume:projected",
    );
    expect(names).toContain(
      "pause:requested,resume:requested,pause:running,resume:running,pause:mined,resume:mined,pause:projected,resume:projected",
    );
    // And the resume projected before the pause (the projector sets the status from the last
    // stored event, so the pause's late projection leaves the campaign live).
    expect(names.some((name) => name.endsWith("resume:projected,pause:projected"))).toBe(true);
  });

  it("is paused at every step until the last one, and not paused after it, in every order", () => {
    for (const order of plain) expectPausedUntilLast(order);
  });

  it("the same with a transient failure (a retry) of each job, in every order", () => {
    const orders = pauseResumeOrders(minedJobSteps("pause", 1), minedJobSteps("resume", 1));
    expect(orders.length).toBeGreaterThan(plain.length);
    for (const order of orders) expectPausedUntilLast(order);
  });

  it("random orders with up to three retries per job (seeded)", () => {
    const random = seededRandom(20261118);
    for (let round = 0; round < 300; round += 1) {
      const pause = minedJobSteps("pause", Math.floor(random() * 4));
      const resume = minedJobSteps("resume", Math.floor(random() * 4));
      // A random walk through the allowed orders: at each point, either chain's next step.
      const order: PauseStep[] = [];
      let i = 0;
      let j = 0;
      while (i < pause.length || j < resume.length) {
        const nextResume = resume[j];
        const done = (phase: string): boolean =>
          order.some((s) => s.job === "pause" && s.phase === phase);
        const resumeAllowed =
          nextResume !== undefined &&
          (nextResume.phase !== "requested" || done("requested")) &&
          (nextResume.phase !== "mined" || done("mined"));
        const nextPause = pause[i];
        if (nextPause !== undefined && (!resumeAllowed || random() < 0.5)) {
          order.push(nextPause);
          i += 1;
        } else if (nextResume !== undefined) {
          order.push(nextResume);
          j += 1;
        }
      }
      expectPausedUntilLast(order);
    }
  });
});

describe("isManuallyPaused: retried and dead jobs", () => {
  const step = (job: string, phase: PauseStep["phase"]): PauseStep => ({ job, phase });

  it("a pause retried after a transient failure is in force through the retry", () => {
    const trace = play([
      step("pause", "requested"),
      step("pause", "running"),
      step("pause", "retry"),
      step("pause", "running"),
      step("pause", "mined"),
      step("pause", "projected"),
    ]);
    expect(trace.map((entry) => entry.manual)).toEqual([true, true, true, true, true, true]);
  });

  it("a resume retried after a transient failure leaves the pause only once mined and projected", () => {
    expectPausedUntilLast([
      ...minedJobSteps("pause"),
      step("resume", "requested"),
      step("resume", "running"),
      step("resume", "retry"),
      step("resume", "running"),
      step("resume", "retry"),
      step("resume", "running"),
      step("resume", "mined"),
      step("resume", "projected"),
    ]);
  });

  it("a dead pause (never mined) keeps the pause (d) until the merchant resumes", () => {
    const trace = play([
      step("pause", "requested"),
      step("pause", "running"),
      step("pause", "dead"),
      // The merchant resumes; the chain is live, so the resume job sends nothing.
      step("resume", "requested"),
      step("resume", "running"),
      step("resume", "nothing-sent"),
    ]);
    expect(trace.map((entry) => entry.manual)).toEqual([true, true, true, true, true, false]);
    expect(trace.every((entry) => !entry.chain)).toBe(true);
  });

  it("a dead resume leaves the campaign paused on-chain, so paused (a), until a new resume lands", () => {
    const trace = play([
      ...minedJobSteps("pause"),
      step("resume", "requested"),
      step("resume", "running"),
      step("resume", "retry"),
      step("resume", "running"),
      step("resume", "dead"),
      ...minedJobSteps("resume2"),
    ]);
    const deadAt = trace.findIndex((entry) => entry.step === "resume:dead");
    expect(trace[deadAt]).toMatchObject({ manual: true, chain: true });
    expect(trace.slice(0, -1).every((entry) => entry.manual)).toBe(true);
    expect(trace[trace.length - 1]).toMatchObject({ manual: false, chain: false });
  });

  it("pause and resume both requested before the pause runs: the pause is superseded, nothing is mined", () => {
    const trace = play([
      step("pause", "requested"),
      step("resume", "requested"),
      step("pause", "running"),
      step("pause", "nothing-sent"),
      step("resume", "running"),
      step("resume", "nothing-sent"),
    ]);
    expect(trace.map((entry) => entry.manual)).toEqual([true, true, true, true, true, false]);
  });

  it("a job whose transaction is mined counts as finished while its handler is still running", () => {
    const model = new PauseModel();
    const steps = [
      ...minedJobSteps("pause"),
      step("resume", "requested"),
      step("resume", "running"),
    ];
    steps.forEach((s, index) => {
      model.apply(s, T0 + index * 1_000);
    });
    model.apply(step("resume", "mined"), T0 + 10_000);
    // Mined and stored: the event is not projected yet, paused by (c), not by (b).
    expect(model.input()).toMatchObject({ pauseJobInFlight: false, pauseEventUnprojected: true });
    expect(isManuallyPaused(model.input())).toBe(true);
  });
});

/**
 * Plays `prefix` then `order` one second apart and returns the first broken promise, or null:
 *
 * - the rule says "not paused" only while the chain is live AND the merchant's latest request is
 *   a resume whose job has ended (mined and projected, or nothing to send: the chain was live);
 * - once it says "not paused", it keeps saying so until the merchant's next request (no flap);
 * - at the end every job has ended, the chain is in the state of the latest request, and so is
 *   the rule.
 */
function brokenPromise(prefix: readonly PauseStep[], order: readonly PauseStep[]): string | null {
  const model = new PauseModel();
  const steps = [...prefix, ...order];
  const name = steps.map(stepName).join(" → ");
  let reopened = false;
  for (const [index, step] of steps.entries()) {
    model.apply(step, stepTime(T0, index));
    const manual = isManuallyPaused(model.input());
    const latest = model.latest();
    const where = `after ${stepName(step)} (step ${String(index + 1)}) in ${name}`;
    if (!manual) {
      if (model.chainPaused()) return `not paused while the chain is paused, ${where}`;
      if (latest === null || latest.paused || latest.status !== "done") {
        return `not paused before the latest request is a resume that landed, ${where}`;
      }
    }
    if (step.phase === "requested") reopened = false;
    else if (reopened && manual) return `paused again without a new request, ${where}`;
    if (!manual) reopened = true;
  }
  const latest = model.latest();
  if (latest === null) return `no request in ${name}`;
  const unfinished = model.jobsView().filter((job) => job.status !== "done");
  if (unfinished.length > 0) {
    return `jobs not ended: ${unfinished.map((job) => job.job).join(", ")} in ${name}`;
  }
  if (model.chainPaused() !== latest.paused)
    return `the chain ends against ${latest.job} in ${name}`;
  if (isManuallyPaused(model.input()) !== latest.paused) {
    return `the rule ends against ${latest.job} in ${name}`;
  }
  return null;
}

function expectEveryOrderHolds(prefix: readonly PauseStep[], orders: readonly PauseStep[][]): void {
  const broken = orders.map((order) => brokenPromise(prefix, order)).filter((b) => b !== null);
  expect(broken.slice(0, 3)).toEqual([]);
}

describe("isManuallyPaused: any number of requests, the handler deciding what each job does", () => {
  it("the model's handler: a superseded request, or the chain already as asked, sends nothing", () => {
    const model = new PauseModel();
    model.apply({ job: "pause", phase: "requested" }, T0);
    model.apply({ job: "resume", phase: "requested" }, T0 + 1_000);
    model.apply({ job: "pause", phase: "running" }, T0 + 2_000);
    // The pause is superseded; the resume is not claimed yet.
    expect(model.nextSteps()).toEqual([
      { job: "pause", phase: "nothing-sent" },
      { job: "resume", phase: "running" },
    ]);
    model.apply({ job: "pause", phase: "nothing-sent" }, T0 + 3_000);
    model.apply({ job: "resume", phase: "running" }, T0 + 4_000);
    // The chain is live, as the resume asks.
    expect(model.nextSteps(1)).toEqual([
      { job: "resume", phase: "retry" },
      { job: "resume", phase: "nothing-sent" },
    ]);
  });

  it("the campaign's lock: no job decides while another has a mined transaction to project", () => {
    const model = new PauseModel();
    for (const [index, step] of [
      { job: "pause", phase: "requested" },
      { job: "pause", phase: "running" },
      { job: "pause", phase: "mined" },
      { job: "resume", phase: "requested" },
      { job: "resume", phase: "running" },
    ].entries()) {
      model.apply(step as PauseStep, stepTime(T0, index));
    }
    expect(model.nextSteps()).toEqual([{ job: "pause", phase: "projected" }]);
  });

  it("the model refuses an impossible step with its own error", () => {
    const model = new PauseModel();
    expect(() => {
      model.apply({ job: "pause", phase: "running" }, T0);
    }).toThrow(PauseModelError);
    model.apply({ job: "pause", phase: "requested" }, T0);
    expect(() => {
      model.apply({ job: "pause", phase: "requested" }, T0);
    }).toThrow(PauseModelError);
    expect(() => {
      model.apply({ job: "pause", phase: "projected" }, T0);
    }).toThrow(PauseModelError);
  });

  it("pause, resume, pause again: every order", () => {
    const orders = requestOrders(["pause", "resume", "pause2"]);
    expect(orders.length).toBeGreaterThan(100);
    // Among them, the pause again before the resume lands, mined or not.
    const names = orders.map((order) => order.map(stepName).join(","));
    expect(names.some((n) => /resume:mined,pause2:requested/.test(n))).toBe(true);
    expect(names.some((n) => /resume:requested,pause2:requested/.test(n))).toBe(true);
    expectEveryOrderHolds([], orders);
  });

  it("pause, resume, pause again: random orders with up to two transient failures per job (seeded)", () => {
    const random = seededRandom(20261119);
    const orders: PauseStep[][] = [];
    for (let round = 0; round < 3_000; round += 1) {
      orders.push(randomRequestOrder(["pause", "resume", "pause2"], random, { maxRetries: 2 }));
    }
    expect(orders.some((order) => order.some((step) => step.phase === "retry"))).toBe(true);
    expectEveryOrderHolds([], orders);
  });

  it("after a pause on-chain: resume, pause, resume, every order", () => {
    const prefix = minedJobSteps("pause");
    const orders = requestOrders(["resume", "pause2", "resume2"], { prefix });
    expect(orders.length).toBeGreaterThan(100);
    // Among them, the pause requested once the resume is mined, before it is projected, and the
    // pause requested before the resume is claimed (the resume is then superseded).
    const names = orders.map((order) => order.map(stepName).join(","));
    expect(names.some((n) => n.includes("resume:mined,pause2:requested"))).toBe(true);
    expect(names.some((n) => n.includes("pause2:requested,resume:running"))).toBe(true);
    expectEveryOrderHolds(prefix, orders);
  });

  it("after a pause on-chain: resume, pause, resume, random orders with transient failures (seeded)", () => {
    const prefix = minedJobSteps("pause");
    const random = seededRandom(20261120);
    const orders: PauseStep[][] = [];
    for (let round = 0; round < 3_000; round += 1) {
      orders.push(
        randomRequestOrder(["resume", "pause2", "resume2"], random, { prefix, maxRetries: 2 }),
      );
    }
    expectEveryOrderHolds(prefix, orders);
  });

  it("pause, resume, pause, resume: every order", () => {
    const orders = requestOrders(["pause", "resume", "pause2", "resume2"]);
    expect(orders.length).toBeGreaterThan(10_000);
    expectEveryOrderHolds([], orders);
  });

  it("six requests in a row, random orders with transient failures (seeded)", () => {
    const requests = ["pause", "resume", "pause2", "resume2", "pause3", "resume3"];
    const random = seededRandom(20261121);
    const orders: PauseStep[][] = [];
    for (let round = 0; round < 3_000; round += 1) {
      orders.push(randomRequestOrder(requests, random, { maxRetries: 1 }));
    }
    expectEveryOrderHolds([], orders);
  });
});

/**
 * `brokenPromise` with jobs that may die, played `stepMs` apart from the start of a block second:
 *
 * - the rule says "not paused" only while the chain is live AND the merchant's latest request is
 *   a resume whose job has ended (done, or dead with the chain live);
 * - once it says "not paused", it keeps saying so until the merchant's next request (no flap);
 * - at the end every job has ended; when the latest job is done, the chain and the rule are in
 *   the state it asked; when it died, the rule says paused if it asked a pause or the chain is
 *   paused, and not paused otherwise.
 */
function brokenPromiseWithDeaths(order: readonly PauseStep[], stepMs: number): string | null {
  const model = new PauseModel();
  const name = order.map(stepName).join(" → ");
  let reopened = false;
  for (const [index, step] of order.entries()) {
    model.apply(step, stepTime(0, index, stepMs));
    const manual = isManuallyPaused(model.input());
    const latest = model.latest();
    const where = `after ${stepName(step)} (step ${String(index + 1)}) in ${name}`;
    if (!manual) {
      if (model.chainPaused()) return `not paused while the chain is paused, ${where}`;
      if (latest === null || latest.paused) {
        return `not paused while the merchant's latest word is a pause, ${where}`;
      }
      if (latest.status !== "done" && latest.status !== "dead") {
        return `not paused before the latest resume ended, ${where}`;
      }
    }
    if (step.phase === "requested") reopened = false;
    else if (reopened && manual) return `paused again without a new request, ${where}`;
    if (!manual) reopened = true;
  }
  const latest = model.latest();
  if (latest === null) return `no request in ${name}`;
  const unfinished = model
    .jobsView()
    .filter((job) => job.status !== "done" && job.status !== "dead");
  if (unfinished.length > 0) {
    return `jobs not ended: ${unfinished.map((job) => job.job).join(", ")} in ${name}`;
  }
  const manual = isManuallyPaused(model.input());
  if (latest.status === "done") {
    if (model.chainPaused() !== latest.paused)
      return `the chain ends against ${latest.job} in ${name}`;
    if (manual !== latest.paused) return `the rule ends against ${latest.job} in ${name}`;
  } else if (manual !== (latest.paused || model.chainPaused())) {
    return `the rule ends ${String(manual)} after the dead ${latest.job} in ${name}`;
  }
  return null;
}

function expectEveryOrderHoldsWithDeaths(orders: readonly PauseStep[][], stepMs: number): void {
  const broken = orders
    .map((order) => brokenPromiseWithDeaths(order, stepMs))
    .filter((b) => b !== null);
  expect(broken.slice(0, 3)).toEqual([]);
}

describe("isManuallyPaused: jobs that die, many steps in one block second", () => {
  // 50 ms apart from second 0: the first twenty steps share one block second.
  const SAME_SECOND = 50;

  it("generates deaths, among them a pause requested in the second of an earlier pause, then dead", () => {
    const orders = requestOrders(["pause", "resume", "pause2"], {
      deaths: true,
      stepMs: SAME_SECOND,
    });
    const names = orders.map((order) => order.map(stepName).join(","));
    expect(
      names.some((n) =>
        n.endsWith(
          "pause:projected,resume:requested,resume:running,resume:mined,resume:projected,pause2:requested,pause2:running,pause2:dead",
        ),
      ),
    ).toBe(true);
    expect(orders.length).toBeGreaterThan(1_000);
  });

  for (const stepMs of [SAME_SECOND, 1_000]) {
    it(`pause, resume, pause again, every order with deaths (${String(stepMs)} ms apart)`, () => {
      const orders = requestOrders(["pause", "resume", "pause2"], { deaths: true, stepMs });
      expectEveryOrderHoldsWithDeaths(orders, stepMs);
    });

    it(`after a pause on-chain: resume, pause, resume, every order with deaths (${String(stepMs)} ms apart)`, () => {
      const prefix = minedJobSteps("pause");
      const orders = requestOrders(["resume", "pause2", "resume2"], {
        prefix,
        deaths: true,
        stepMs,
      });
      expectEveryOrderHoldsWithDeaths(
        orders.map((order) => [...prefix, ...order]),
        stepMs,
      );
    });

    it(`six requests with deaths and transient failures, random orders (${String(stepMs)} ms apart, seeded)`, () => {
      const requests = ["pause", "resume", "pause2", "resume2", "pause3", "resume3"];
      const random = seededRandom(20261122 + stepMs);
      const orders: PauseStep[][] = [];
      for (let round = 0; round < 2_000; round += 1) {
        orders.push(randomRequestOrder(requests, random, { maxRetries: 1, deaths: true, stepMs }));
      }
      expect(orders.some((order) => order.some((step) => step.phase === "dead"))).toBe(true);
      expectEveryOrderHoldsWithDeaths(orders, stepMs);
    });
  }
});
