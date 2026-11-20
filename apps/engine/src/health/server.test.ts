import { createServer } from "node:net";

import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDb, type Db } from "../db";
import { EngineLeader, PgEngineLease, type LeaseView } from "../leader";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { LoopMonitor, type LoopHandle } from "./loops";
import {
  createHealthReader,
  HealthConfigError,
  healthPortFromEnv,
  healthReportSchema,
  readHealth,
  startHealthServer,
  type HealthReport,
  type HealthServer,
  type HealthSources,
} from "./server";

const silent = pino({ level: "silent" });
const CURSOR = "escrow-logs:0x00000000000000000000000000000000000000e5";

const LEADING: LeaseView = {
  role: "leader",
  holder: "eng-0123456789ab",
  heldForMs: 42_700,
  renewedAgoMs: 1_250,
  leaseReachable: true,
};
const STANDING_BY: LeaseView = {
  role: "standby",
  holder: "eng-ba9876543210",
  heldForMs: 3_600_400,
  renewedAgoMs: 900,
  leaseReachable: true,
};

/** True when nothing listens on `port` any more: binding it succeeds. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

describe("healthPortFromEnv", () => {
  it("is off without PORT, and with an empty one", () => {
    expect(healthPortFromEnv({})).toBeUndefined();
    expect(healthPortFromEnv({ PORT: "" })).toBeUndefined();
  });

  it("reads a port", () => {
    expect(healthPortFromEnv({ PORT: "8080" })).toBe(8080);
  });

  it("refuses a malformed port, naming the variable", () => {
    expect(() => healthPortFromEnv({ PORT: "eighty" })).toThrow(HealthConfigError);
    expect(() => healthPortFromEnv({ PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("GET /healthz", () => {
  let database: TestDatabase;
  let server: HealthServer | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db`insert into chain_cursor (name, block_number) values (${CURSOR}, 4200)`;
  });
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });
  afterAll(async () => {
    await database.drop();
  });

  function sources(overrides: Partial<HealthSources> = {}): HealthSources {
    return {
      db: database.db,
      chain: { getBlockNumber: () => Promise.resolve(4_321n) },
      chainId: 5_042_002,
      cursorName: CURSOR,
      startedAt: new Date("2026-11-18T10:00:00.000Z"),
      services: () => ({ sender: "running", jobs: "running" }),
      lease: () => LEADING,
      now: () => Date.parse("2026-11-18T10:01:05.900Z"),
      timeoutMs: 1_000,
      ...overrides,
    };
  }

  async function get(
    options: Partial<HealthSources>,
    path = "/healthz",
  ): Promise<{ status: number; body: unknown }> {
    server = await startHealthServer({
      ...sources(options),
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    const response = await fetch(`http://127.0.0.1:${server.port.toString()}${path}`);
    return { status: response.status, body: await response.json() };
  }

  it("answers 200 with the expected shape and nothing else", async () => {
    const { status, body } = await get({});
    expect(status).toBe(200);
    const expected: HealthReport = {
      status: "ok",
      role: "leader",
      startedAt: "2026-11-18T10:00:00.000Z",
      uptimeS: 65,
      chain: { id: 5_042_002, head: 4321, cursor: 4200 },
      db: "ok",
      sender: "running",
      jobs: "running",
      lease: { holder: "eng-0123456789ab", heldForS: 42, renewedAgoMs: 1_250 },
      loops: {},
      staleLoops: [],
    };
    expect(body).toStrictEqual(expected);
    expect(healthReportSchema.safeParse(body).success).toBe(true);
  });

  describe("the leader's loops", () => {
    const NOW = Date.parse("2026-11-18T10:01:05.900Z");

    /** A monitor at `NOW` with the sale states registered `registeredAgoMs` ago, and the jobs. */
    function monitorWith(registeredAgoMs: number): {
      monitor: LoopMonitor;
      sales: LoopHandle;
      jobs: LoopHandle;
      setNow: (ms: number) => void;
    } {
      let nowMs = NOW - registeredAgoMs;
      const monitor = new LoopMonitor(() => nowMs);
      const sales = monitor.register("sale-states", 60_000);
      const jobs = monitor.register("jobs", 120_000);
      nowMs = NOW;
      return { monitor, sales, jobs, setNow: (ms) => (nowMs = ms) };
    }

    it("200 with every loop running, each with the time since its last pass and its bound", async () => {
      const { monitor, sales, jobs, setNow } = monitorWith(90_000);
      setNow(NOW - 900);
      sales.beat();
      setNow(NOW - 2_000);
      jobs.beat();
      setNow(NOW);
      const { status, body } = await get({ loops: () => monitor.report() });
      expect(status).toBe(200);
      expect(healthReportSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({
        status: "ok",
        loops: {
          jobs: { state: "running", sinceS: 2, boundS: 120 },
          "sale-states": { state: "running", sinceS: 0, boundS: 60 },
        },
        staleLoops: [],
      });
    });

    it("200 during the start-up grace: a loop gets its whole bound to complete its first pass", async () => {
      const { monitor } = monitorWith(59_000);
      const { status, body } = await get({ loops: () => monitor.report() });
      expect(status).toBe(200);
      expect(body).toMatchObject({
        loops: { "sale-states": { state: "running", sinceS: 59, boundS: 60 } },
        staleLoops: [],
      });
    });

    it("503 naming the sale states once they go past 60 s without a completed pass, 200 again after one", async () => {
      const { monitor, sales, jobs, setNow } = monitorWith(300_000);
      setNow(NOW - 61_000);
      sales.beat();
      setNow(NOW - 1_000);
      jobs.beat();
      setNow(NOW);
      const stale = await get({ loops: () => monitor.report() });
      expect(stale.status).toBe(503);
      expect(healthReportSchema.safeParse(stale.body).success).toBe(true);
      expect(stale.body).toMatchObject({
        status: "unavailable",
        role: "leader",
        db: "ok",
        loops: {
          "sale-states": { state: "stale", sinceS: 61, boundS: 60 },
          jobs: { state: "running" },
        },
        staleLoops: ["sale-states"],
      });
      const reading = await readHealth(sources({ loops: () => monitor.report() }));
      expect(reading.problems).toEqual([
        "leader: loop sale-states has not completed a pass for 61 s (bound 60 s)",
      ]);

      // Positive control: one completed pass and the same engine is healthy again.
      sales.beat();
      await server?.close();
      server = undefined;
      const back = await get({ loops: () => monitor.report() });
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ status: "ok", staleLoops: [] });
    });

    it("503 at once when a loop's service stopped by itself", async () => {
      const { monitor, sales, jobs } = monitorWith(1_000);
      sales.beat();
      jobs.beat();
      jobs.stopped("the jobs service stopped by itself");
      const { status, body } = await get({ loops: () => monitor.report() });
      expect(status).toBe(503);
      expect(body).toMatchObject({
        loops: { jobs: { state: "stopped" }, "sale-states": { state: "running" } },
        staleLoops: ["jobs"],
      });
    });

    it("a standby is not judged on loops (it runs none), and reports none", async () => {
      const { monitor } = monitorWith(600_000);
      const { status, body } = await get({
        services: () => ({ sender: "stopped", jobs: "stopped" }),
        lease: () => STANDING_BY,
        loops: () => monitor.report(),
      });
      expect(status).toBe(200);
      expect(body).toMatchObject({ role: "standby", loops: {}, staleLoops: [] });
    });

    it('a 503 for a stale loop contains the keyword `"status":"ok"` nowhere, a 200 does', async () => {
      const { monitor } = monitorWith(600_000);
      const stale = await get({ loops: () => monitor.report() });
      expect(stale.status).toBe(503);
      expect(JSON.stringify(stale.body)).not.toContain('"status":"ok"');
      await server?.close();
      server = undefined;
      const healthy = await get({});
      expect(JSON.stringify(healthy.body)).toContain('"status":"ok"');
    });
  });

  it("reports a null cursor before the event reader stored one", async () => {
    const { status, body } = await get({ cursorName: "escrow-logs:none" });
    expect(status).toBe(200);
    expect((body as HealthReport).chain.cursor).toBeNull();
  });

  it("answers 503 when the database cannot be reached", async () => {
    // Nothing listens on port 1: every connection is refused.
    const down = createDb("postgres://nobody@127.0.0.1:1/none", { max: 1 });
    try {
      const { status, body } = await get({ db: down });
      expect(status).toBe(503);
      expect(healthReportSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({
        status: "unavailable",
        db: "down",
        chain: { head: 4321, cursor: null },
      });
    } finally {
      await down.end({ timeout: 1 });
    }
  });

  it("answers 503 within the timeout when the node does not answer", async () => {
    const started = Date.now();
    const { status, body } = await get({
      chain: { getBlockNumber: () => new Promise<bigint>(() => undefined) },
      timeoutMs: 200,
    });
    expect(status).toBe(503);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(body).toMatchObject({
      status: "unavailable",
      db: "ok",
      chain: { head: null, cursor: 4200 },
    });
  });

  it("answers 503 when the node refuses", async () => {
    const { status } = await get({
      chain: { getBlockNumber: () => Promise.reject(new Error("connection refused")) },
    });
    expect(status).toBe(503);
  });

  it("answers 503 while the engine stops", async () => {
    const { status, body } = await get({
      services: () => ({ sender: "stopped", jobs: "stopped" }),
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({ sender: "stopped", jobs: "stopped", db: "ok" });
  });

  it("answers 200 for a healthy standby, with its role and who holds the lease", async () => {
    const { status, body } = await get({
      services: () => ({ sender: "stopped", jobs: "stopped" }),
      lease: () => STANDING_BY,
    });
    expect(status).toBe(200);
    expect(healthReportSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      status: "ok",
      role: "standby",
      db: "ok",
      sender: "stopped",
      jobs: "stopped",
      chain: { head: 4321, cursor: 4200 },
      lease: { holder: "eng-ba9876543210", heldForS: 3_600, renewedAgoMs: 900 },
    });
  });

  it("answers 200 for a standby that sees the lease free", async () => {
    const { status, body } = await get({
      services: () => ({ sender: "stopped", jobs: "stopped" }),
      lease: () => ({
        role: "standby",
        holder: null,
        heldForMs: null,
        renewedAgoMs: null,
        leaseReachable: true,
      }),
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      role: "standby",
      lease: { holder: null, heldForS: null, renewedAgoMs: null },
    });
  });

  it("answers 503 for a standby that cannot reach its database or its node", async () => {
    const down = createDb("postgres://nobody@127.0.0.1:1/none", { max: 1 });
    try {
      const noDb = await get({
        db: down,
        services: () => ({ sender: "stopped", jobs: "stopped" }),
        lease: () => STANDING_BY,
      });
      expect(noDb.status).toBe(503);
      expect(noDb.body).toMatchObject({ status: "unavailable", role: "standby", db: "down" });
    } finally {
      await down.end({ timeout: 1 });
    }
    await server?.close();
    server = undefined;
    const noNode = await get({
      chain: { getBlockNumber: () => Promise.reject(new Error("connection refused")) },
      services: () => ({ sender: "stopped", jobs: "stopped" }),
      lease: () => STANDING_BY,
    });
    expect(noNode.status).toBe(503);
    expect(noNode.body).toMatchObject({ role: "standby", chain: { head: null } });
  });

  it("answers 503 for a standby whose latest ask for the lease failed", async () => {
    const { status, body } = await get({
      services: () => ({ sender: "stopped", jobs: "stopped" }),
      lease: () => ({ ...STANDING_BY, leaseReachable: false }),
    });
    expect(status).toBe(503);
    expect(healthReportSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ status: "unavailable", role: "standby", db: "ok" });
    const reading = await readHealth(
      sources({
        services: () => ({ sender: "stopped", jobs: "stopped" }),
        lease: () => ({ ...STANDING_BY, leaseReachable: false }),
      }),
    );
    expect(reading.problems).toEqual([
      "standby: its latest ask for the engine lease was not answered",
    ]);
  });

  it("answers 503 for a leader whose services are not running (starting, or fenced)", async () => {
    const { status, body } = await get({
      services: () => ({ sender: "stopped", jobs: "stopped" }),
      lease: () => LEADING,
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({ role: "leader", sender: "stopped" });
  });

  it("answers 404 on any other path", async () => {
    const { status } = await get({}, "/");
    expect(status).toBe(404);
  });

  it("never answers a key's address, an e-mail or a URL", async () => {
    const { body } = await get({});
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/:\/\//);
  });

  it("frees its port once stopped, even with a connection kept alive", async () => {
    const running = await startHealthServer({
      ...sources(),
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    const response = await fetch(`http://127.0.0.1:${running.port.toString()}/healthz`, {
      headers: { connection: "keep-alive" },
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(await portIsFree(running.port)).toBe(false);
    await running.close();
    expect(await portIsFree(running.port)).toBe(true);
  });

  it("refuses to start on a port already taken", async () => {
    const first = await startHealthServer({
      ...sources(),
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    try {
      await expect(
        startHealthServer({ ...sources(), port: first.port, host: "127.0.0.1", logger: silent }),
      ).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });

  it("reads the same report without a listener", async () => {
    const { httpStatus, report } = await readHealth(sources());
    expect(httpStatus).toBe(200);
    expect(report.chain).toStrictEqual({ id: 5_042_002, head: 4321, cursor: 4200 });
  });
});

describe("the health read's cache", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db`insert into chain_cursor (name, block_number) values (${CURSOR}, 4200)`;
  });
  afterAll(async () => {
    await database.drop();
  });

  /** The database and the node, each counting the reads they serve. */
  function counted(): {
    sources: HealthSources;
    reads: { db: number; node: number };
    clock: { ms: number };
    release: () => void;
  } {
    const reads = { db: 0, node: 0 };
    const clock = { ms: Date.parse("2026-11-18T10:00:00.000Z") };
    // The node answers once released: every request of a burst arrives while the read runs.
    let release: () => void = () => undefined;
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      reads.db += 1;
      return database.db(strings, ...(values as never[]));
    }) as unknown as Db;
    const sources: HealthSources = {
      db,
      chain: {
        getBlockNumber: async () => {
          reads.node += 1;
          await gate;
          return 4_321n;
        },
      },
      chainId: 5_042_002,
      cursorName: CURSOR,
      startedAt: new Date(clock.ms),
      services: () => ({ sender: "running", jobs: "running" }),
      lease: () => LEADING,
      now: () => clock.ms,
      timeoutMs: 1_000,
    };
    return {
      sources,
      reads,
      clock,
      release: () => {
        release();
        gate = Promise.resolve();
      },
    };
  }

  it("serves N concurrent requests from one read, and reads again after 2 s", async () => {
    const { sources, reads, clock, release } = counted();
    const server = await startHealthServer({
      ...sources,
      port: 0,
      host: "127.0.0.1",
      logger: silent,
    });
    try {
      const url = `http://127.0.0.1:${server.port.toString()}/healthz`;
      const burst = Array.from({ length: 20 }, () => fetch(url));
      // Every request is in before the node answers.
      for (let i = 0; i < 100 && reads.node === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      release();
      const answers = await Promise.all(burst);
      expect(answers.map((answer) => answer.status)).toEqual(Array(20).fill(200));
      const bodies = await Promise.all(answers.map((answer) => answer.json()));
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
      expect(reads).toEqual({ db: 1, node: 1 });

      // Within 2 s of that read: still the same one.
      clock.ms += 1_999;
      expect((await fetch(url)).status).toBe(200);
      expect(reads).toEqual({ db: 1, node: 1 });

      // 2 s after it: a new read.
      clock.ms += 1;
      expect((await fetch(url)).status).toBe(200);
      expect(reads).toEqual({ db: 2, node: 2 });
    } finally {
      await server.close();
    }
  });

  it("caches a probe that failed the same way, and does not keep a probe that threw", async () => {
    const { sources, reads, clock, release } = counted();
    release();
    // The node throws at the call itself, once: the probe rejects and is not kept.
    let throwing = true;
    let nodeDown = false;
    const read = createHealthReader({
      ...sources,
      chain: {
        getBlockNumber: () => {
          if (throwing) {
            throwing = false;
            throw new Error("client unusable");
          }
          return nodeDown ? Promise.reject(new Error("refused")) : sources.chain.getBlockNumber();
        },
      },
    });
    await expect(read()).rejects.toThrow("client unusable");
    nodeDown = true;
    const first = await read();
    expect(first.httpStatus).toBe(503);
    expect(first.problems).toEqual(["the node did not answer"]);
    nodeDown = false;
    // Within 2 s: the failed probe still answers, without a new query.
    const again = await read();
    expect(again.httpStatus).toBe(503);
    expect(reads.db).toBe(2);
    clock.ms += 2_000;
    expect((await read()).httpStatus).toBe(200);
    expect(reads.db).toBe(3);
  });

  it("builds the role and the services fresh on every request: only the I/O is cached", async () => {
    const { sources, reads, clock, release } = counted();
    release();
    let services: { sender: "running" | "stopped"; jobs: "running" | "stopped" } = {
      sender: "running",
      jobs: "running",
    };
    let lease: LeaseView = LEADING;
    const read = createHealthReader({
      ...sources,
      services: () => services,
      lease: () => lease,
    });
    const leading = await read();
    expect(leading.httpStatus).toBe(200);
    expect(leading.report.role).toBe("leader");
    expect(reads).toEqual({ db: 1, node: 1 });

    // The leader begins to stop (or fences itself) 100 ms later: 503 at once, no new probe.
    clock.ms += 100;
    services = { sender: "stopped", jobs: "stopped" };
    const stopping = await read();
    expect(stopping.httpStatus).toBe(503);
    expect(stopping.report).toMatchObject({ role: "leader", sender: "stopped", jobs: "stopped" });
    expect(stopping.problems).toEqual([
      "leader: the transaction sender or the job worker is not running",
    ]);

    // Back to standby, still within the 2 s: 200 standby, from the same probe.
    lease = STANDING_BY;
    const standby = await read();
    expect(standby.httpStatus).toBe(200);
    expect(standby.report).toMatchObject({
      role: "standby",
      lease: { holder: STANDING_BY.holder },
    });
    expect(reads).toEqual({ db: 1, node: 1 });
  });
});

describe("a real standby whose lease queries fail", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db`insert into chain_cursor (name, block_number) values (${CURSOR}, 4200)`;
  });
  afterAll(async () => {
    await database.drop();
  });

  /** A standby over the test database, its health read as `index.ts` wires it. */
  async function standbyHealth(): Promise<{
    status: number;
    report: HealthReport;
    problems: string[];
    starts: number;
  }> {
    let starts = 0;
    const leader = new EngineLeader({
      lease: new PgEngineLease({ db: database.db, holder: "eng-standby00000", ttlMs: 10_000 }),
      settings: { ttlMs: 10_000, renewMs: 1_000, standbyPollMs: 50, fenceMarginMs: 5_000 },
      logger: silent,
      startServices: () => {
        starts += 1;
        return Promise.reject(new Error("must not start"));
      },
    });
    void leader.run();
    try {
      // Several asks, answered or failed.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const reading = await readHealth({
        db: database.db,
        chain: { getBlockNumber: () => Promise.resolve(4_321n) },
        chainId: 5_042_002,
        cursorName: CURSOR,
        startedAt: new Date(),
        services: () => {
          const state = leader.servicesRunning() ? "running" : "stopped";
          return { sender: state, jobs: state };
        },
        lease: () => leader.view(),
      });
      return {
        status: reading.httpStatus,
        report: reading.report,
        problems: reading.problems,
        starts,
      };
    } finally {
      await leader.stop();
    }
  }

  it("positive control: with the table and another engine's live lease, it answers 200 standby", async () => {
    await database.db`
      insert into engine_lease (name, holder, acquired_at, renewed_at, expires_at)
      values ('engine', 'eng-other0000000', now(), now(), now() + interval '1 hour')
    `;
    const health = await standbyHealth();
    expect(health.status).toBe(200);
    expect(health.report).toMatchObject({
      role: "standby",
      db: "ok",
      lease: { holder: "eng-other0000000" },
    });
    expect(health.starts).toBe(0);
  });

  it("answers 503 when engine_lease is missing (the engine deployed before its migration)", async () => {
    // The chain_cursor read, the database probe, still answers: only the lease cannot be worked.
    await database.db`drop table engine_lease`;
    const health = await standbyHealth();
    expect(health.status).toBe(503);
    expect(health.report).toMatchObject({ status: "unavailable", role: "standby", db: "ok" });
    expect(health.problems).toEqual([
      "standby: its latest ask for the engine lease was not answered",
    ]);
    expect(health.starts).toBe(0);
  });
});
