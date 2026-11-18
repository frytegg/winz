/**
 * The real engine PROCESS, spawned as the container runs it (`node --import tsx src/index.ts`),
 * with PORT set, on a test database and a local chain with the escrow deployed. Gemini points at
 * a closed local port: nothing reaches a real network.
 *
 * - alone: it takes the lease, /healthz answers 200 as leader; on SIGTERM it stops its services,
 *   releases the lease (the row says so), closes the probe, frees the port and exits 0, with the
 *   stop logged in that order;
 * - a redeploy with two processes: the second answers 200 as standby while the first leads; the
 *   first gets SIGTERM and exits 0; the second leads within 2 s; their services never overlap
 *   (from the processes' own logs).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { healthReportSchema, type HealthReport } from "../health/server";
import { startAnvil, type AnvilInstance } from "../testing/anvil";
import { deployTestEscrow, type TestEscrow } from "../testing/escrow";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let anvil: AnvilInstance;
let escrow: TestEscrow;
let database: TestDatabase;
/** A port nothing listens on: Gemini's REST and WebSocket URLs point at it. */
let closedPort: number;
const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === "object") resolvePort(address.port);
        else reject(new Error("no port"));
      });
    });
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.listen(port, "0.0.0.0", () => probe.close(() => resolveFree(true)));
  });
}

beforeAll(async () => {
  anvil = await startAnvil();
  escrow = await deployTestEscrow(anvil);
  database = await createTestDatabase();
  closedPort = await freePort();
}, 60_000);

afterAll(async () => {
  await database?.drop();
  await anvil?.stop();
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolveExit) => child.once("exit", resolveExit));
    }
  }
  await database.db`delete from engine_lease`;
});

interface LogLine {
  level: string;
  time: string;
  module?: string;
  msg: string;
  [key: string]: unknown;
}

interface EngineProcess {
  child: ChildProcess;
  port: number;
  lines: LogLine[];
  /** stderr, kept for a failure message. */
  stderr: () => string;
  exited: Promise<number | null>;
}

/** Starts the engine process as the Dockerfile does, with a test environment. */
async function spawnEngine(): Promise<EngineProcess> {
  const port = await freePort();
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "/tmp",
    APP_ENV: "production",
    APP_LOG_LEVEL: "info",
    APP_ADMIN_DEMO_KEY: "spawn-test-admin-key",
    DB_URL: database.url,
    DB_POOL_MAX: "8",
    ARC_CHAIN_ID: escrow.chainId.toString(),
    ARC_RPC_URL: anvil.rpcUrl,
    ARC_RPC_FALLBACK_URL: anvil.rpcUrl,
    ARC_ESCROW_ADDRESS: escrow.escrow,
    ARC_ESCROW_DEPLOY_BLOCK: escrow.deployedAtBlock.toString(),
    ARC_USDC_ADDRESS: escrow.usdc,
    ARC_RELAYER_PRIVATE_KEY: anvil.privateKeys[1] ?? "",
    ARC_ORACLE_PRIVATE_KEY: anvil.privateKeys[2] ?? "",
    APP_DEMO_WALLET_SEED: `0x${"33".repeat(32)}`,
    GEMINI_API_URL: `http://127.0.0.1:${closedPort.toString()}`,
    GEMINI_WS_URL: `ws://127.0.0.1:${closedPort.toString()}`,
    GEMINI_SANDBOX_API_URL: `http://127.0.0.1:${closedPort.toString()}`,
    // The shortest lease the schema allows, and a quick standby.
    ENGINE_LEASE_TTL_MS: "10000",
    ENGINE_LEASE_RENEW_MS: "1000",
    ENGINE_LEASE_STANDBY_POLL_MS: "200",
    PORT: port.toString(),
  };
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ENGINE_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const lines: LogLine[] = [];
  let pending = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim() === "") continue;
      try {
        lines.push(JSON.parse(part) as LogLine);
      } catch {
        lines.push({ level: "raw", time: "", msg: part });
      }
    }
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const exited = new Promise<number | null>((resolveExit) =>
    child.once("exit", (code) => resolveExit(code)),
  );
  return { child, port, lines, stderr: () => stderr, exited };
}

async function health(
  engine: EngineProcess,
): Promise<{ status: number; report: HealthReport } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${engine.port.toString()}/healthz`);
    const body: unknown = await response.json();
    return { status: response.status, report: healthReportSchema.parse(body) };
  } catch {
    return null;
  }
}

async function until<T>(
  what: string,
  engine: EngineProcess,
  probe: () => Promise<T | null | undefined | false>,
  ms = 45_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline || engine.child.exitCode !== null) {
      const tail = engine.lines
        .slice(-15)
        .map((line) => `${line.level} ${String(line.module)} ${line.msg}`)
        .join("\n");
      throw new Error(`timed out waiting for ${what}\n${tail}\n${engine.stderr().slice(-2_000)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}

function indexOf(engine: EngineProcess, module: string, msg: string): number {
  return engine.lines.findIndex((line) => line.module === module && line.msg === msg);
}

function timeOf(engine: EngineProcess, module: string, msg: string): number {
  const line = engine.lines.find((entry) => entry.module === module && entry.msg === msg);
  if (line === undefined) throw new Error(`no "${msg}" logged by ${module}`);
  return Date.parse(line.time);
}

async function leaseRow(): Promise<{ holder: string; released_at: Date | null } | undefined> {
  const [row] = await database.db<{ holder: string; released_at: Date | null }[]>`
    select holder, released_at from engine_lease where name = 'engine'
  `;
  return row;
}

describe("the engine process", () => {
  it("leads alone, then on SIGTERM stops, releases the lease, frees its port and exits 0", async () => {
    const a = await spawnEngine();
    const leading = await until("200 as leader", a, async () => {
      const answer = await health(a);
      return answer?.status === 200 && answer.report.role === "leader" ? answer : null;
    });
    expect(leading.report).toMatchObject({ status: "ok", sender: "running", jobs: "running" });
    const holder = leading.report.lease.holder;
    expect(holder).toMatch(/^eng-[0-9a-f]{12}$/);
    expect((await leaseRow())?.holder).toBe(holder);

    const sigtermAt = Date.now();
    a.child.kill("SIGTERM");
    const code = await a.exited;
    expect(code, a.stderr()).toBe(0);
    const stopMs =
      timeOf(a, "engine", "engine stopped") - timeOf(a, "engine", "shutdown requested");
    if (process.env.LEADER_REPORT === "1") {
      process.stderr.write(
        `[process] SIGTERM -> engine stopped: ${stopMs.toString()} ms; -> exit: ${(Date.now() - sigtermAt).toString()} ms\n` +
          a.lines
            .slice(indexOf(a, "engine", "shutdown requested"))
            .map((line) => `  ${line.time} ${String(line.module)} ${line.msg}`)
            .join("\n") +
          "\n",
      );
    }

    // The stop, in order: services, then the lease, then the probe.
    const order = [
      indexOf(a, "engine", "shutdown requested"),
      indexOf(a, "engine", "engine stopping"),
      indexOf(a, "engine", "engine stopped"),
      indexOf(a, "leader", "engine services stopped"),
      indexOf(a, "leader", "lease released"),
      indexOf(a, "health", "health listener stopped"),
    ];
    expect(
      order.every((index) => index >= 0),
      JSON.stringify(order),
    ).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(a.lines.find((line) => line.msg === "lease released")).toMatchObject({
      holder,
      released: true,
    });

    const row = await leaseRow();
    expect(row?.holder).toBe(holder);
    expect(row?.released_at).not.toBeNull();
    expect(await portIsFree(a.port)).toBe(true);
    // Nothing logged at error level or above by the process's own lifecycle (Gemini, pointed at a
    // closed port, does log errors: the catalogue and the book feed cannot reach it).
    expect(
      a.lines.filter(
        (line) =>
          (line.level === "error" || line.level === "fatal") &&
          ["engine", "leader", "health", "tx-sender", "jobs"].includes(String(line.module)),
      ),
    ).toEqual([]);
  }, 90_000);

  it("a redeploy: the new process is a healthy standby, the old one stops, the new one leads within 2 s", async () => {
    const a = await spawnEngine();
    await until("A as leader", a, async () => {
      const answer = await health(a);
      return answer?.status === 200 && answer.report.role === "leader" ? answer : null;
    });
    const holderA = (await leaseRow())?.holder;

    const b = await spawnEngine();
    const standby = await until("B as a healthy standby", b, async () => {
      const answer = await health(b);
      return answer?.status === 200 &&
        answer.report.role === "standby" &&
        answer.report.lease.holder !== null
        ? answer
        : null;
    });
    expect(standby.report).toMatchObject({
      status: "ok",
      role: "standby",
      sender: "stopped",
      jobs: "stopped",
      db: "ok",
      lease: { holder: holderA },
    });
    expect(indexOf(b, "engine", "engine running")).toBe(-1);

    a.child.kill("SIGTERM");
    expect(await a.exited, a.stderr()).toBe(0);
    const aStopped = timeOf(a, "engine", "engine stopped");
    const aExit = Date.now();
    await until("B leading", b, () =>
      Promise.resolve(indexOf(b, "leader", "engine running under the lease") >= 0),
    );
    const bRunning = timeOf(b, "leader", "engine running under the lease");
    const bStarting = timeOf(b, "leader", "lease acquired: starting the engine");
    if (process.env.LEADER_REPORT === "1") {
      process.stderr.write(
        `[process] A's services stopped -> B's services running: ${(bRunning - aStopped).toString()} ms (A's exit seen ${(aExit - aStopped).toString()} ms after its stop)\n`,
      );
    }
    // B started its services only after A's had stopped, and within 2 s of it.
    expect(bStarting).toBeGreaterThan(aStopped);
    expect(bRunning - aStopped).toBeLessThan(2_000);
    expect((await leaseRow())?.holder).not.toBe(holderA);

    b.child.kill("SIGTERM");
    expect(await b.exited, b.stderr()).toBe(0);
    expect((await leaseRow())?.released_at).not.toBeNull();
  }, 120_000);
});
