// Tests for scripts/landing-check.mjs. Run with: pnpm exec tsx --test scripts/landing-check.test.mjs
// Not in CI, like the script itself. The last case runs the real command.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { PLACEHOLDERS, findPlaceholders, formatReport } from "./landing-check.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const script = join(scriptsDir, "landing-check.mjs");
const repoRoot = resolve(scriptsDir, "..");

const files = {
  "/x/a.tsx": 'export const A = () => <a href="#">go</a>;',
  "/x/b.tsx": "// TODO: write the real text\nexport const B = 1;",
  "/x/c.tsx": "export const C = 'Lorem ipsum dolor';\nexport const D = '[placeholder]';",
  "/x/ok.tsx": 'export const Ok = () => <a href="/start">Start</a>;',
};
const read = (path) => files[path];

describe("findPlaceholders", () => {
  test("finds each kind of placeholder with its line", () => {
    const found = findPlaceholders(Object.keys(files), read);
    const summary = found.map((hit) => `${hit.file}:${hit.line}:${hit.name}`).sort();
    assert.deepEqual(summary, [
      '/x/a.tsx:1:href="#"',
      "/x/b.tsx:1:TODO",
      "/x/c.tsx:1:lorem ipsum",
      "/x/c.tsx:2:[placeholder]",
    ]);
  });

  test("leaves a clean file alone", () => {
    assert.deepEqual(findPlaceholders(["/x/ok.tsx"], read), []);
  });

  test("covers the five kinds the page's rules name", () => {
    assert.deepEqual(
      PLACEHOLDERS.map((entry) => entry.name),
      ["TODO", "FIXME", "lorem ipsum", "[placeholder]", 'href="#"'],
    );
  });
});

describe("formatReport", () => {
  test("says nothing is open when nothing is", () => {
    assert.match(formatReport({ missing: [], placeholders: [] }), /nothing open/);
  });

  test("lists every open item and counts them", () => {
    const text = formatReport({
      missing: [{ key: "liveDemoUrl", reason: "not set" }],
      placeholders: [],
    });
    assert.match(text, /liveDemoUrl/);
    assert.match(text, /1 open\. Not a CI job/);
  });
});

describe("the command", () => {
  test("exits 0 when nothing is open and 1 otherwise, and always names the links section", () => {
    const run = spawnSync(`pnpm exec tsx "${script}"`, {
      cwd: repoRoot,
      encoding: "utf8",
      shell: true,
    });
    assert.match(run.stdout, /^Links \(/m, run.stdout + run.stderr);
    const clean = /nothing open/.test(run.stdout);
    assert.equal(run.status, clean ? 0 : 1, run.stdout + run.stderr);
  });
});
