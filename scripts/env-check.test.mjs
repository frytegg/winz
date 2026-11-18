// Tests for scripts/env-check.mjs. Run with: pnpm exec tsx --test scripts/env-check.test.mjs
// (tsx, because the schemas it imports are TypeScript). The CLI cases run the real command.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkEnv,
  exampleNames,
  formatList,
  formatReport,
  loadSchemas,
  parseArgs,
  parseDotenv,
} from "./env-check.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const script = join(scriptsDir, "env-check.mjs");

// Dummy values of the right shape. Not keys of anything.
const KEY_A = `0x${"11".repeat(32)}`;
const KEY_B = `0x${"22".repeat(32)}`;
const ENGINE = {
  APP_ADMIN_DEMO_KEY: "a-demo-key-of-16-chars",
  DB_URL: "postgres://user:pa55word@db.example.invalid:6543/postgres",
  ARC_RPC_URL: "https://rpc.example.invalid",
  ARC_ESCROW_ADDRESS: "0x0000000000000000000000000000000000000abc",
  ARC_ESCROW_DEPLOY_BLOCK: "123",
  ARC_RELAYER_PRIVATE_KEY: KEY_A,
  ARC_ORACLE_PRIVATE_KEY: KEY_B,
  APP_DEMO_WALLET_SEED: `0x${"33".repeat(32)}`,
};
const WEB = {
  APP_BASE_URL: "https://winz.example.invalid",
  APP_ADMIN_DEMO_KEY: "a-demo-key-of-16-chars",
  DB_URL: "postgres://user:pa55word@db.example.invalid:6543/postgres",
  STRIPE_SECRET_KEY: "sk_test_dummyvalue",
  STRIPE_WEBHOOK_SECRET: "whsec_dummyvalue",
  PRIVY_APP_SECRET: "privy-dummy-secret",
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-dummy-app",
  QUICKNODE_STREAMS_TOKEN: "qn-dummy-token",
};

let schemas;
let example;
const sandboxes = [];
before(async () => {
  schemas = await loadSchemas();
  example = exampleNames();
});
after(() => {
  for (const directory of sandboxes) rmSync(directory, { recursive: true, force: true });
});

function check(target, source, fromFile = true) {
  return checkEnv({
    target,
    source,
    schemas: schemas[target],
    otherSchemas: schemas[target === "engine" ? "web" : "engine"],
    example,
    fromFile,
  });
}

function rowOf(report, name) {
  const row = report.rows.find((r) => r.name === name);
  assert.ok(row, `no row for ${name}`);
  return row;
}

function cli(args, env = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
}

function envFile(content) {
  const directory = mkdtempSync(join(tmpdir(), "env-check-"));
  sandboxes.push(directory);
  const path = join(directory, "test.env");
  writeFileSync(path, content);
  return path;
}

describe("checkEnv", () => {
  test("a complete engine environment passes", () => {
    const report = check("engine", ENGINE);
    assert.equal(report.ok, true);
    assert.equal(rowOf(report, "DB_URL").status, "set");
    assert.equal(rowOf(report, "DB_POOL_MAX").status, "default");
    assert.equal(rowOf(report, "STRIPE_SECRET_KEY").status, "unset");
    assert.equal(rowOf(report, "PORT").required, false);
  });

  test("a complete web environment passes", () => {
    assert.equal(check("web", WEB).ok, true);
  });

  test("a missing required variable fails and is named", () => {
    const { DB_URL: _dropped, ...rest } = ENGINE;
    const report = check("engine", rest);
    assert.equal(report.ok, false);
    assert.equal(report.missing, 1);
    assert.deepEqual(
      { status: rowOf(report, "DB_URL").status, message: rowOf(report, "DB_URL").message },
      { status: "missing", message: "required" },
    );
  });

  test("an empty value counts as missing, as the services read it", () => {
    const report = check("engine", { ...ENGINE, ARC_RPC_URL: "" });
    assert.equal(rowOf(report, "ARC_RPC_URL").status, "missing");
  });

  test("a malformed variable fails with the zod message and never its value", () => {
    const report = check("engine", {
      ...ENGINE,
      ARC_ESCROW_ADDRESS: "0xnotanaddress",
      STRIPE_SECRET_KEY: "sk_live_realvalue",
    });
    assert.equal(report.invalid, 2);
    assert.equal(rowOf(report, "ARC_ESCROW_ADDRESS").message, "must be a 20-byte hex address");
    assert.equal(rowOf(report, "STRIPE_SECRET_KEY").message, "only Stripe test keys are allowed");
    const text = formatReport(report, "test");
    assert.ok(!text.includes("0xnotanaddress"));
    assert.ok(!text.includes("sk_live_realvalue"));
  });

  test("a cross-variable rule is reported on the variable it names", () => {
    const { APP_DEMO_WALLET_SEED: _seed, ...rest } = ENGINE;
    const report = check("engine", { ...rest, PRIVY_APP_SECRET: "only-half-of-privy" });
    assert.equal(report.ok, false);
    assert.match(rowOf(report, "NEXT_PUBLIC_PRIVY_APP_ID").message, /must be set together/);
  });

  test("a malformed PORT fails the engine check", () => {
    const report = check("engine", { ...ENGINE, PORT: "eighty" });
    assert.equal(rowOf(report, "PORT").status, "invalid");
  });

  test("a name read by nobody is reported as a typo, without failing", () => {
    const report = check("engine", { ...ENGINE, ARC_ESCROW_ADRESS: "x" });
    assert.equal(report.ok, true);
    assert.deepEqual(
      report.extras.map((e) => [e.name, e.kind]),
      [["ARC_ESCROW_ADRESS", "unknown"]],
    );
  });

  test("a front-end variable of .env.example is a note, not a typo", () => {
    const report = check("web", { ...WEB, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" });
    assert.equal(report.ok, true);
    assert.equal(report.extras[0]?.kind, "no-schema");
  });

  test("a variable of the other service is a note", () => {
    const report = check("engine", { ...ENGINE, STRIPE_WEBHOOK_SECRET: "whsec_x" });
    assert.equal(report.ok, true);
    assert.equal(report.extras[0]?.kind, "other-service");
  });

  test("an engine secret on the web app fails", () => {
    const report = check("web", { ...WEB, ARC_RELAYER_PRIVATE_KEY: KEY_A });
    assert.equal(report.ok, false);
    assert.deepEqual(
      report.extras.map((e) => [e.name, e.kind]),
      [["ARC_RELAYER_PRIVATE_KEY", "exposed"]],
    );
    assert.ok(!formatReport(report, "test").includes(KEY_A));
  });

  test("a secret under NEXT_PUBLIC_ fails on either service", () => {
    const report = check("engine", { ...ENGINE, NEXT_PUBLIC_STRIPE_SECRET_KEY: "sk_test_x" });
    assert.equal(report.ok, false);
    assert.equal(report.exposed, 1);
  });

  test("platform variables are ignored, and unrelated process variables too", () => {
    const report = check(
      "web",
      { ...WEB, VERCEL_ENV: "production", PORT: "3000", HOME: "/root" },
      false,
    );
    assert.deepEqual(report.extras, []);
  });

  test("the report never contains a value", () => {
    const text = formatReport(check("engine", ENGINE), "test");
    for (const value of Object.values(ENGINE))
      assert.ok(!text.includes(value), `value printed: ${value.slice(0, 6)}`);
  });
});

describe("parseDotenv and parseArgs", () => {
  test("reads export, quotes and comments", () => {
    assert.deepEqual(parseDotenv('# c\nexport A=1\nB="two words"\nC=3 # note\n\nD=\n'), {
      A: "1",
      B: "two words",
      C: "3",
      D: "",
    });
  });

  test("refuses an unknown target or argument", () => {
    assert.throws(() => parseArgs(["worker"]), /usage/);
    assert.throws(() => parseArgs(["engine", "--fil", "x"]), /unknown argument/);
    assert.deepEqual(parseArgs(["web", "--file", "a.env"]), {
      target: "web",
      file: "a.env",
      list: false,
    });
  });

  test("--list renders the schema as a table with defaults", () => {
    const table = formatList("engine", schemas.engine);
    assert.match(table, /^\| Variable \| Requise \| Défaut \|/);
    assert.ok(table.includes("| `DB_URL` | oui |  |"));
    assert.match(table, /\| `DB_POOL_MAX` \| non \| `20` \|/);
    assert.ok(table.includes("| `PORT` | non |  |"));
  });
});

describe("the command", () => {
  test("exits 0 on a complete file", () => {
    const file = envFile(
      Object.entries(ENGINE)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
    );
    const result = cli(["engine", "--file", file]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /result: complete for the engine/);
    for (const value of Object.values(ENGINE)) assert.ok(!result.stdout.includes(value));
  });

  test("exits 1 on an incomplete environment, read from the process", () => {
    const result = cli(["web"], {
      APP_BASE_URL: "https://winz.example.invalid",
      DB_URL: "not a url",
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /MISSING\s+STRIPE_SECRET_KEY\s+required/);
    assert.match(result.stdout, /INVALID\s+DB_URL\s+Invalid URL/);
    assert.ok(!result.stdout.includes("not a url"));
  });

  test("exits 2 on a usage error or a missing file", () => {
    assert.equal(cli([]).status, 2);
    assert.equal(cli(["engine", "--file", "/nonexistent/x.env"]).status, 2);
  });
});
