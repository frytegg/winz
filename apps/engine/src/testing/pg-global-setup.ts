import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { TestProject } from "vitest/node";

const run = promisify(execFile);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");
export const TEMPLATE_DATABASE = "winz_template";

/**
 * Directory holding initdb, pg_ctl and psql. Looked up in this order: `PG_BIN`, the Debian/Ubuntu
 * layout (`/usr/lib/postgresql/<version>/bin`, newest version first), then `pg_config --bindir`.
 */
function pgBin(): string {
  const candidates: string[] = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  const debianRoot = "/usr/lib/postgresql";
  if (existsSync(debianRoot)) {
    const versions = readdirSync(debianRoot)
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(b) - Number(a));
    candidates.push(...versions.map((version) => join(debianRoot, version, "bin")));
  }
  try {
    candidates.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim());
  } catch {
    // pg_config is optional: the candidates above usually suffice.
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl"))) return dir;
  }
  throw new Error(
    "Postgres server binaries not found (initdb, pg_ctl). Install PostgreSQL 16 or set PG_BIN to their directory.",
  );
}

/** Postgres refuses to run as root: as root, every Postgres command runs as the `postgres` user. */
function asPg(command: string, args: string[]): { file: string; args: string[] } {
  if (userInfo().uid !== 0) return { file: command, args };
  return {
    file: "runuser",
    args: ["-u", process.env.PG_OS_USER ?? "postgres", "--", command, ...args],
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePort(address.port);
        else reject(new Error("could not allocate a port"));
      });
    });
  });
}

async function psql(bin: string, port: number, database: string, sqlText: string): Promise<void> {
  const { file, args } = asPg(join(bin, "psql"), [
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    database,
    "-f",
    "-",
  ]);
  await new Promise<void>((resolveRun, reject) => {
    // SQL goes through stdin: the server user may not be allowed to read the repository.
    const child = spawn(file, args, { stdio: ["pipe", "ignore", "pipe"], cwd: tmpdir() });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolveRun() : reject(new Error(`psql failed (${String(code)}): ${stderr}`)),
    );
    child.stdin.end(sqlText);
  });
}

/**
 * Vitest global setup: one throwaway Postgres for the whole run, with every migration applied to
 * a template database. Tests get their own copy through `createTestDatabase()`.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const bin = pgBin();
  const work = await mkdtemp(join(tmpdir(), "winz-engine-pg-"));
  const data = join(work, "data");
  const port = await freePort();
  if (userInfo().uid === 0) await run("chown", [process.env.PG_OS_USER ?? "postgres", work]);

  const initdb = asPg(join(bin, "initdb"), [
    "-D",
    data,
    "-U",
    "postgres",
    "-A",
    "trust",
    "-E",
    "UTF8",
    "--no-sync",
  ]);
  await run(initdb.file, initdb.args, { cwd: tmpdir() });

  const start = asPg(join(bin, "pg_ctl"), [
    "-D",
    data,
    "-l",
    join(work, "postgres.log"),
    "-w",
    "-o",
    `-c listen_addresses=127.0.0.1 -c port=${String(port)} -c unix_socket_directories=${work} -c fsync=off -c max_connections=200`,
    "start",
  ]);
  await run(start.file, start.args, { cwd: tmpdir() });

  const stop = async (): Promise<void> => {
    const command = asPg(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
    await run(command.file, command.args, { cwd: tmpdir() }).catch(() => undefined);
    await rm(work, { recursive: true, force: true });
  };

  try {
    // Roles a Supabase project has and a vanilla Postgres lacks.
    await psql(
      bin,
      port,
      "postgres",
      `create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
       create database ${TEMPLATE_DATABASE};`,
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
    for (const name of files) {
      await psql(bin, port, TEMPLATE_DATABASE, await readFile(join(MIGRATIONS_DIR, name), "utf8"));
    }
  } catch (error: unknown) {
    await stop();
    throw error;
  }

  project.provide("pgAdminUrl", `postgres://postgres@127.0.0.1:${String(port)}/postgres`);
  return stop;
}

declare module "vitest" {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}
