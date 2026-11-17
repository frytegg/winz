// Tests for scripts/completion-check.mjs. Run with: node --test scripts/completion-check.test.mjs
// Each case builds a throwaway plan and tree in os.tmpdir() and runs the real CLI against it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { expectedPathExists, parseCoverage, parseTasks } from "./completion-check.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const script = join(scriptsDir, "completion-check.mjs");
const repoRoot = resolve(scriptsDir, "..");

const sandboxes = [];
after(() => {
  for (const directory of sandboxes) rmSync(directory, { recursive: true, force: true });
});

const COVERAGE_HEADER = [
  "## Couverture des exigences",
  "",
  "| Exigence | Priorité | Tâches |",
  "|---|---|---|",
];

/** A plan with two Must rows (one of them multi-requirement), one Should and the criteria row. */
function plan({ unchecked = [], extraTasks = [], extraRows = [], coverage = true } = {}) {
  const box = (id) => (unchecked.includes(id) ? "[ ]" : "[x]");
  return [
    "# Tâches",
    "",
    "- Cocher `- [x]` quand c'est fini.",
    "",
    `- ${box("F-01")} **F-01** · Qui : A · Dép. : aucune`,
    "  Squelette du monorepo.",
    "  Fini quand : tout passe.",
    `- ${box("C-01")} **C-01** · Qui : Agent \`coder-high\` · Dép. : F-01 · EC-1`,
    `- ${box("H-07")} **H-07** ◇ · Qui : Agent · Dép. : C-01 · HE-10`,
    `- ${box("I-02")} **I-02** ◇ · Qui : T · ID-3 (Should)`,
    `- ${box("Q-03")} **Q-03** · Qui : A · Critères 6 et 7`,
    `- ${box("B-01")} **B-01** ◇ · CA-7 · Dupliquer une campagne.`,
    ...extraTasks,
    "",
    "---",
    "",
    ...(coverage
      ? [
          ...COVERAGE_HEADER,
          "| EC-1, EC-3 | Must | C-01 |",
          "| HE-10 | Must | C-01, H-07 |",
          "| ID-3 | Should | I-02 |",
          "| CA-7 | Could | B-01 |",
          "| Critères de succès 1 à 8 | Must | Q-03 |",
          ...extraRows,
          "",
          "## Questions ouvertes",
          "",
          "| Question | Bloque |",
          "|---|---|",
          "| 1. Compte sandbox | H-07 |",
        ]
      : []),
    "",
  ].join("\n");
}

/** Writes a root directory holding TASKS.md, scripts/completion-expect.json and `files`. */
function sandbox({ tasks = plan(), expect = {}, files = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "completion-check-"));
  sandboxes.push(root);
  const write = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  if (tasks !== null) write("TASKS.md", tasks);
  write("scripts/completion-expect.json", JSON.stringify(expect));
  for (const [path, content] of Object.entries(files)) write(path, content);
  return root;
}

function run(root, ...flags) {
  const result = spawnSync(process.execPath, [script, "--root", root, ...flags], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runJson(root, ...flags) {
  const result = run(root, "--json", ...flags);
  return { ...result, json: JSON.parse(result.stdout) };
}

const ids = (requirements) => requirements.map((requirement) => requirement.id);

describe("parsing", () => {
  test("reads id, checkbox, slip marker and title of each task entry", () => {
    const tasks = parseTasks(plan({ unchecked: ["H-07", "B-01"] }));
    assert.deepEqual(
      tasks.map((task) => task.id),
      ["F-01", "C-01", "H-07", "I-02", "Q-03", "B-01"],
    );
    const byId = Object.fromEntries(tasks.map((task) => [task.id, task]));
    assert.deepEqual(
      { checked: byId["F-01"].checked, slip: byId["F-01"].slip, title: byId["F-01"].title },
      { checked: true, slip: false, title: "Qui : A · Dép. : aucune" },
    );
    assert.deepEqual(
      { checked: byId["H-07"].checked, slip: byId["H-07"].slip },
      { checked: false, slip: true },
    );
    assert.equal(byId["B-01"].title, "CA-7 · Dupliquer une campagne.");
    assert.equal(byId["B-01"].slip, true);
  });

  test("a ◇ later on the line marks a sub-item, not the task", () => {
    const [task] = parseTasks("- [ ] **U-05** · Qui : T\n  liste, détail, bilan ◇, réglages.\n");
    assert.equal(task.slip, false);
  });

  test("splits multi-requirement rows and names the success criteria row", () => {
    const { requirements, problems } = parseCoverage(plan());
    assert.deepEqual(problems, []);
    assert.deepEqual(ids(requirements), [
      "EC-1",
      "EC-3",
      "HE-10",
      "ID-3",
      "CA-7",
      "SUCCESS-CRITERIA",
    ]);
    assert.deepEqual(requirements[2].tasks, ["C-01", "H-07"]);
    assert.equal(requirements[5].priority, "Must");
  });

  test("stops at the next heading: later tables are not coverage rows", () => {
    const { requirements } = parseCoverage(plan());
    assert.ok(!ids(requirements).some((id) => id.startsWith("1.")));
  });
});

describe("exit code and report", () => {
  test("all Must tasks checked: exit 0", () => {
    const result = run(sandbox({ tasks: plan({ unchecked: ["I-02", "B-01"] }) }));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^Must open \(0\)$/m);
    assert.match(result.stdout, /completion-check: PASS/);
  });

  test("one Must task unchecked: exit 1 and the task is named", () => {
    const root = sandbox({ tasks: plan({ unchecked: ["C-01"] }) });
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /EC-1, EC-3 \[Must\]: waiting on C-01/);
    assert.match(result.stdout, /HE-10 \[Must\]: waiting on C-01$/m);

    const { json } = runJson(root);
    assert.deepEqual(ids(json.mustOpen), ["EC-1", "EC-3", "HE-10"]);
    assert.deepEqual(json.mustOpen[0].unchecked, ["C-01"]);
    assert.deepEqual(ids(json.mustClosed), ["SUCCESS-CRITERIA"]);
  });

  test("a requirement stays open until every one of its tasks is checked", () => {
    const { status, json } = runJson(sandbox({ tasks: plan({ unchecked: ["H-07"] }) }));
    assert.equal(status, 1);
    assert.deepEqual(ids(json.mustOpen), ["HE-10"]);
    assert.deepEqual(json.mustOpen[0].unchecked, ["H-07"]);
  });

  test("an open Should or Could is reported but does not fail", () => {
    const result = run(sandbox({ tasks: plan({ unchecked: ["I-02", "B-01"] }) }));
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Should \/ Could open, informational \(2\)$/m);
    assert.match(result.stdout, /ID-3 \[Should\]: waiting on I-02/);
    assert.match(result.stdout, /CA-7 \[Could\]: waiting on B-01/);
  });

  test("the ◇ marker never closes anything: an unchecked ◇ task keeps its Must open", () => {
    const root = sandbox({ tasks: plan({ unchecked: ["H-07"] }) });
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /HE-10 \[Must\]: waiting on H-07 ◇/);
    assert.deepEqual(runJson(root).json.mustOpen[0].uncheckedMaySlip, ["H-07"]);
  });

  test("the table references an unknown task: plan error, requirement open", () => {
    const root = sandbox({ tasks: plan({ extraRows: ["| ZZ-1 | Should | Z-99 |"] }) });
    const { status, json } = runJson(root);
    assert.equal(status, 1);
    assert.equal(json.counts.planErrors, 1);
    assert.equal(json.planErrors[0].kind, "unknown-task");
    assert.match(json.planErrors[0].message, /Z-99/);
    assert.deepEqual(ids(json.otherOpen), ["ZZ-1"]);
    assert.match(run(root).stdout, /^Plan errors \(1\)$/m);
  });

  test("a duplicated task id: plan error", () => {
    const tasks = plan({ extraTasks: ["- [x] **C-01** · Qui : A · en double"] });
    const { status, json } = runJson(sandbox({ tasks }));
    assert.equal(status, 1);
    assert.deepEqual(
      json.planErrors.map((error) => error.kind),
      ["duplicate-task"],
    );
    assert.match(json.planErrors[0].message, /C-01 is defined twice/);
    assert.equal(json.counts.mustOpen, 0);
  });

  test("a malformed coverage row is a plan error, not a silently dropped requirement", () => {
    const { status, json } = runJson(
      sandbox({ tasks: plan({ extraRows: ["| ST-1 | Urgent | C-01 |"] }) }),
    );
    assert.equal(status, 1);
    assert.equal(json.planErrors[0].kind, "malformed-row");
  });

  test("a checked task missing its expected file is open", () => {
    const expect = { "C-01": ["packages/contracts/src/WinzEscrow.sol"] };
    const root = sandbox({ expect });
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^Checked without files \(1\)$/m);
    assert.match(
      result.stdout,
      /C-01 is checked but these are missing: packages\/contracts\/src\/WinzEscrow\.sol/,
    );
    assert.match(result.stdout, /EC-1, EC-3 \[Must\]: waiting on C-01 \(checked, files missing\)/);
    assert.deepEqual(ids(runJson(root).json.mustOpen), ["EC-1", "EC-3", "HE-10"]);

    const fixed = sandbox({ expect, files: { "packages/contracts/src/WinzEscrow.sol": "//" } });
    assert.equal(run(fixed).status, 0);
  });

  test("expected files of an unchecked task are not required yet", () => {
    const root = sandbox({
      tasks: plan({ unchecked: ["I-02"] }),
      expect: { "I-02": ["apps/web/passkey.ts"] },
    });
    const { status, json } = runJson(root);
    assert.equal(status, 0);
    assert.equal(json.counts.checkedWithoutFiles, 0);
  });

  test("an expectation for a task that is not in the plan is a plan error", () => {
    const { status, json } = runJson(sandbox({ expect: { "Z-01": ["somewhere"] } }));
    assert.equal(status, 1);
    assert.equal(json.planErrors[0].kind, "expectation-for-unknown-task");
  });

  test("a TODO in an audience-facing file: exit 1 with file and line", () => {
    const root = sandbox({
      files: {
        "README.md": "# Winz\n\nLorem Ipsum dolor sit amet\n",
        "apps/web/app/page.tsx": "export default function Page() {\n  // TODO: hero copy\n}\n",
        "apps/web/components/Card.tsx": "// FIXME spacing\nconst mask = 'XXX';\n",
        // Not audience-facing, or not source: none of these may be reported.
        "apps/web/app/node_modules/pkg/index.js": "// TODO\n",
        "apps/web/app/.next/chunk.js": "// TODO\n",
        "apps/web/app/logo.png": "TODO",
        "apps/web/lib/server/env.ts": "// TODO\n",
        "apps/engine/src/index.ts": "// TODO\n",
      },
    });
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^TODO in audience-facing files \(4\)$/m);
    assert.match(result.stdout, /apps\/web\/app\/page\.tsx:2 \[TODO\]/);
    assert.match(result.stdout, /README\.md:3 \[lorem ipsum\]/);

    const { json } = runJson(root);
    assert.deepEqual(
      json.todos.map((todo) => `${todo.file}:${todo.line}:${todo.marker}`),
      [
        "README.md:3:lorem ipsum",
        "apps/web/app/page.tsx:2:TODO",
        "apps/web/components/Card.tsx:1:FIXME",
        "apps/web/components/Card.tsx:2:XXX",
      ],
    );
    assert.equal(json.counts.mustOpen, 0);
  });

  test("words that merely contain a marker are not reported", () => {
    const root = sandbox({
      files: { "apps/web/app/page.tsx": "const todos = mastodon; // card 4242 XXXX, size XXXL\n" },
    });
    assert.equal(run(root).status, 0);
  });
});

describe("usage and parse failures: exit 2", () => {
  test("missing coverage table", () => {
    const result = run(sandbox({ tasks: plan({ coverage: false }) }));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /coverage table not found/);
    assert.equal(result.stdout, "");
  });

  test("coverage heading with no table under it", () => {
    const tasks = `${plan({ coverage: false })}\n## Couverture des exigences\n\nÀ écrire.\n`;
    assert.equal(run(sandbox({ tasks })).status, 2);
  });

  test("missing TASKS.md", () => {
    const result = run(sandbox({ tasks: null }));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot read the task list/);
  });

  test("unknown flag, flag without value, unreadable expectations", () => {
    const root = sandbox();
    assert.equal(run(root, "--nope").status, 2);
    assert.equal(run(root, "--tasks").status, 2);
    assert.equal(run(root, "--expect", join(root, "absent.json")).status, 2);
    const escaping = sandbox({ expect: { "C-01": ["../outside"] } });
    assert.equal(run(escaping).status, 2);
  });
});

describe("options", () => {
  test("--tasks reads the plan from another path", () => {
    const root = sandbox();
    const other = join(root, "other-plan.md");
    writeFileSync(other, plan({ unchecked: ["Q-03"] }));
    const { status, json } = runJson(root, "--tasks", other);
    assert.equal(status, 1);
    assert.deepEqual(ids(json.mustOpen), ["SUCCESS-CRITERIA"]);
    assert.equal(json.tasksFile, other);
  });

  test("--json is valid JSON carrying the same counts as the human report", () => {
    const root = sandbox({
      tasks: plan({
        unchecked: ["H-07", "I-02"],
        extraRows: ["| ZZ-1 | Must | Z-99 |"],
      }),
      expect: { "F-01": ["missing.txt"] },
      files: { "README.md": "TODO\n" },
    });
    const human = run(root);
    const { status, json } = runJson(root);
    assert.equal(status, 1);
    assert.equal(human.status, 1);
    assert.equal(json.exitCode, 1);
    assert.equal(json.ok, false);
    assert.deepEqual(json.counts, {
      tasks: 6,
      tasksChecked: 4,
      requirements: 7,
      must: 5,
      mustOpen: 2,
      mustClosed: 3,
      otherOpen: 1,
      otherClosed: 1,
      planErrors: 1,
      checkedWithoutFiles: 1,
      todos: 1,
    });
    assert.equal(json.mustOpen.length, json.counts.mustOpen);
    assert.equal(json.mustClosed.length, json.counts.mustClosed);
    assert.equal(json.otherOpen.length, json.counts.otherOpen);
    assert.equal(json.planErrors.length, json.counts.planErrors);
    assert.equal(json.checkedWithoutFiles.length, json.counts.checkedWithoutFiles);
    assert.equal(json.todos.length, json.counts.todos);

    const summary = human.stdout.trimEnd().split("\n").at(-1);
    assert.equal(
      summary,
      "completion-check: FAIL | Must open 2/5, Must closed 3, Should/Could open 1, " +
        "plan errors 1, checked without files 1, TODO 1 | tasks checked 4/6",
    );
  });
});

describe("expected paths", () => {
  test("a directory counts only once it holds a real file; globs need one match", () => {
    const root = sandbox({
      files: {
        "e2e/.gitkeep": "",
        "supabase/migrations/0001_init.sql": "select 1;",
        "packages/pricing/src/fees/taker.test.ts": "",
        "packages/pricing/src/index.ts": "",
      },
    });
    mkdirSync(join(root, "docs"));
    assert.equal(expectedPathExists(root, "docs"), false);
    assert.equal(expectedPathExists(root, "e2e"), false);
    assert.equal(expectedPathExists(root, "supabase/migrations"), true);
    assert.equal(expectedPathExists(root, "packages/pricing/src/index.ts"), true);
    assert.equal(expectedPathExists(root, "packages/pricing/src/**/*.test.ts"), true);
    assert.equal(expectedPathExists(root, "packages/pricing/src/*.test.ts"), false);
    assert.equal(expectedPathExists(root, "packages/shared/src/**/*.test.ts"), false);
    assert.equal(expectedPathExists(root, "nowhere"), false);
  });
});

describe("the real plan", () => {
  test("TASKS.md parses without plan errors and the check is red today", () => {
    const result = spawnSync(process.execPath, [script, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const json = JSON.parse(result.stdout);
    assert.deepEqual(json.planErrors, []);
    assert.ok(json.counts.tasks > 50, `only ${json.counts.tasks} tasks parsed`);
    assert.ok(ids(json.mustOpen).includes("SUCCESS-CRITERIA"));
    assert.ok(ids(json.mustOpen).includes("PR-5"));
    assert.equal(json.counts.mustOpen + json.counts.mustClosed, json.counts.must);
    // Red by design until gate G3 (task Q-07). When every Must is closed this assertion is the
    // one to flip to 0; it is here so that a parser regression cannot turn the check green early.
    assert.equal(result.status, 1);
    assert.ok(json.counts.mustOpen > 0);
  });
});
