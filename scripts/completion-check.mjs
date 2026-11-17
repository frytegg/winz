// Proves completeness against the plan (TASKS.md), not against the test suite.
//
// A green suite only measures the code that exists; it is silent about planned work that was never
// written. This script reads the task checkboxes and the "Couverture des exigences" table, and
// exits non-zero while any Must requirement is still open.
//
// Kept OUT of CI on purpose: it is red by design for most of the project's life.
//
//   pnpm completion-check [--json] [--tasks <path>] [--root <path>] [--expect <path>]
//
// Exit codes: 0 = every gate closed, 1 = something is open, 2 = usage or parse failure.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const COVERAGE_HEADING = /^##\s+Couverture des exigences\s*$/;
const TASK_LINE = /^- \[( |x|X)\] \*\*([A-Z]+-\d+)\*\*(.*)$/;
const PRIORITIES = ["Must", "Should", "Could"];
const SUCCESS_CRITERIA_ROW = /^Critères de succès\b/i;
const SUCCESS_CRITERIA_ID = "SUCCESS-CRITERIA";

/** Files and directories the jury reads; a TODO there is an open gate. Relative to the root. */
const AUDIENCE_TARGETS = ["README.md", "apps/web/app", "apps/web/components"];
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".md",
  ".mdx",
  ".html",
  ".json",
  ".svg",
  ".txt",
]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".next", ".turbo", ".git"]);
const TODO_MARKERS = [
  { name: "TODO", pattern: /\bTODO\b/ },
  { name: "FIXME", pattern: /\bFIXME\b/ },
  { name: "XXX", pattern: /\bXXX\b/ },
  { name: "lorem ipsum", pattern: /lorem ipsum/i },
];

/** A failure of the inputs themselves (bad flag, missing file, unreadable plan): exit code 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/**
 * Task entries: `- [ ] **F-04** · Qui : ...` or `- [x] **H-07** ◇ · ...`.
 * The `◇` marker ("may slip") only counts when it directly follows the id; a `◇` further down the
 * line qualifies a sub-item, not the task.
 */
export function parseTasks(markdown) {
  const tasks = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    const match = TASK_LINE.exec(line);
    if (!match) return;
    const rest = match[3].trim();
    const slip = rest.startsWith("◇");
    tasks.push({
      id: match[2],
      checked: match[1] !== " ",
      slip,
      title: rest.replace(/^◇\s*/, "").replace(/^·\s*/, ""),
      line: index + 1,
    });
  });
  return tasks;
}

function splitCells(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function splitList(cell) {
  return cell
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * The table under `## Couverture des exigences`. One row may carry several requirements; each
 * becomes its own requirement, all sharing the row's priority and tasks. Rows that cannot be read
 * are returned as `problems` (plan errors) rather than dropped: a silently skipped row would be a
 * requirement nobody is checking.
 */
export function parseCoverage(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => COVERAGE_HEADING.test(line));
  if (headingIndex === -1) {
    throw new UsageError('coverage table not found: no "## Couverture des exigences" heading');
  }

  const rows = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) break;
    if (lines[index].trim().startsWith("|")) rows.push({ text: lines[index], line: index + 1 });
  }
  const separatorIndex = rows.findIndex((row) => /^\|[\s:|-]+\|?\s*$/.test(row.text.trim()));
  const dataRows = separatorIndex === -1 ? [] : rows.slice(separatorIndex + 1);
  if (dataRows.length === 0) {
    throw new UsageError('coverage table not found under "## Couverture des exigences"');
  }

  const requirements = [];
  const problems = [];
  for (const row of dataRows) {
    const cells = splitCells(row.text);
    if (cells.length !== 3 || !PRIORITIES.includes(cells[1])) {
      problems.push({
        kind: "malformed-row",
        line: row.line,
        message: `coverage row is not "| requirements | Must|Should|Could | tasks |": ${row.text.trim()}`,
      });
      continue;
    }
    const ids = SUCCESS_CRITERIA_ROW.test(cells[0]) ? [SUCCESS_CRITERIA_ID] : splitList(cells[0]);
    const tasks = splitList(cells[2]);
    if (ids.length === 0 || tasks.length === 0) {
      problems.push({
        kind: "malformed-row",
        line: row.line,
        message: `coverage row has no requirement or no task: ${row.text.trim()}`,
      });
      continue;
    }
    for (const id of ids) {
      requirements.push({ id, priority: cells[1], tasks, line: row.line, label: cells[0] });
    }
  }
  return { requirements, problems };
}

/** `{ "<task id>": ["<path relative to the root>", ...] }` */
export function parseExpectations(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new UsageError(`expectations file is not valid JSON: ${error.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new UsageError("expectations file must be an object mapping task ids to path lists");
  }
  for (const [taskId, paths] of Object.entries(data)) {
    const valid =
      Array.isArray(paths) &&
      paths.length > 0 &&
      paths.every(
        (path) =>
          typeof path === "string" &&
          path.length > 0 &&
          !path.startsWith("/") &&
          !/^[A-Za-z]:/.test(path) &&
          !path.split(/[\\/]/).includes(".."),
      );
    if (!valid) {
      throw new UsageError(
        `expectations for ${taskId} must be a non-empty list of paths relative to the repo root`,
      );
    }
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------------------------

function toPosix(path) {
  return path.split(sep).join("/");
}

/** Every file under `directory`, depth first, in a stable order; build output is skipped. */
function listFiles(directory) {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function globToRegExp(pattern) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replaceAll("\u0000", "(?:.*/)?")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${source}$`);
}

/**
 * Does the expected path exist under `root`?
 * - a file: it must exist;
 * - a directory: it must hold at least one real file. The scaffold ships empty lane directories
 *   (`e2e`, `supabase/migrations`, ...), so mere existence would prove nothing; `.gitkeep` does
 *   not count;
 * - a glob (`*` inside a segment, `**` across segments): at least one file must match. Used for
 *   colocated tests, e.g. `packages/pricing/src/**\/*.test.ts`.
 */
export function expectedPathExists(root, expected) {
  if (expected.includes("*")) {
    const segments = expected.split("/");
    const firstWildcard = segments.findIndex((segment) => segment.includes("*"));
    const base = resolve(root, ...segments.slice(0, firstWildcard));
    if (!existsSync(base) || !statSync(base).isDirectory()) return false;
    const pattern = globToRegExp(expected);
    return listFiles(base).some((file) => pattern.test(toPosix(relative(root, file))));
  }
  const target = resolve(root, expected);
  if (!existsSync(target)) return false;
  const stats = statSync(target);
  if (stats.isFile()) return true;
  if (!stats.isDirectory()) return false;
  return listFiles(target).some((file) => !file.endsWith(`${sep}.gitkeep`));
}

/** TODO / FIXME / XXX / lorem ipsum in what the audience reads, with file and line. */
export function scanAudienceFiles(root) {
  const findings = [];
  const files = [];
  for (const target of AUDIENCE_TARGETS) {
    const path = resolve(root, target);
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  for (const file of files) {
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((text, index) => {
        for (const marker of TODO_MARKERS) {
          if (!marker.pattern.test(text)) continue;
          findings.push({
            file: toPosix(relative(root, file)),
            line: index + 1,
            marker: marker.name,
            text: text.trim().slice(0, 160),
          });
        }
      });
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

/**
 * Pure: applies the rules to already-parsed inputs.
 *
 * @param {object} input
 * @param {ReturnType<typeof parseTasks>} input.tasks
 * @param {ReturnType<typeof parseCoverage>} input.coverage
 * @param {Record<string, string[]>} input.expectations
 * @param {(path: string) => boolean} input.pathExists  is this expected path present?
 * @param {ReturnType<typeof scanAudienceFiles>} input.todos
 */
export function evaluate({ tasks, coverage, expectations, pathExists, todos }) {
  const planErrors = [...coverage.problems];

  const byId = new Map();
  for (const task of tasks) {
    const first = byId.get(task.id);
    if (first) {
      planErrors.push({
        kind: "duplicate-task",
        line: task.line,
        message: `task ${task.id} is defined twice (lines ${first.line} and ${task.line})`,
      });
    } else {
      byId.set(task.id, task);
    }
  }

  const seenRequirements = new Map();
  for (const requirement of coverage.requirements) {
    const firstLine = seenRequirements.get(requirement.id);
    if (firstLine !== undefined) {
      planErrors.push({
        kind: "duplicate-requirement",
        line: requirement.line,
        message: `requirement ${requirement.id} appears twice in the coverage table (lines ${firstLine} and ${requirement.line})`,
      });
    } else {
      seenRequirements.set(requirement.id, requirement.line);
    }
  }

  for (const taskId of Object.keys(expectations)) {
    if (!byId.has(taskId)) {
      planErrors.push({
        kind: "expectation-for-unknown-task",
        message: `expectations file lists ${taskId}, which is not a task in the plan`,
      });
    }
  }

  // A checked task whose expected files are absent is not done, whatever its checkbox says.
  const checkedWithoutFiles = [];
  for (const task of byId.values()) {
    if (!task.checked) continue;
    const missing = (expectations[task.id] ?? []).filter((path) => !pathExists(path));
    if (missing.length > 0) {
      checkedWithoutFiles.push({ id: task.id, line: task.line, title: task.title, missing });
    }
  }
  const lackingFiles = new Set(checkedWithoutFiles.map((entry) => entry.id));

  const reportedUnknown = new Set();
  const requirements = coverage.requirements.map((requirement) => {
    const unknown = requirement.tasks.filter((id) => !byId.has(id));
    for (const id of unknown) {
      if (reportedUnknown.has(id)) continue;
      reportedUnknown.add(id);
      planErrors.push({
        kind: "unknown-task",
        line: requirement.line,
        message: `coverage table references ${id} (requirement ${requirement.id}), which is not in the task list`,
      });
    }
    const known = requirement.tasks.filter((id) => byId.has(id));
    const unchecked = known.filter((id) => !byId.get(id).checked);
    const withoutFiles = known.filter((id) => lackingFiles.has(id));
    return {
      id: requirement.id,
      priority: requirement.priority,
      label: requirement.label,
      line: requirement.line,
      tasks: requirement.tasks,
      unchecked,
      // The marker is a scheduling note: it never closes a requirement. It is surfaced so that a
      // Must resting on a task that "may slip" is visible.
      uncheckedMaySlip: unchecked.filter((id) => byId.get(id).slip),
      unknown,
      withoutFiles,
      open: unchecked.length + unknown.length + withoutFiles.length > 0,
    };
  });

  const covered = new Set(coverage.requirements.flatMap((requirement) => requirement.tasks));
  const must = requirements.filter((requirement) => requirement.priority === "Must");
  const other = requirements.filter((requirement) => requirement.priority !== "Must");
  const report = {
    mustOpen: must.filter((requirement) => requirement.open),
    mustClosed: must.filter((requirement) => !requirement.open),
    otherOpen: other.filter((requirement) => requirement.open),
    otherClosed: other.filter((requirement) => !requirement.open),
    planErrors,
    checkedWithoutFiles,
    todos,
    // Informational: tasks no requirement depends on (foundations, proofs, deliverables).
    tasksOutsideCoverage: [...byId.values()]
      .filter((task) => !covered.has(task.id))
      .map((task) => ({ id: task.id, checked: task.checked })),
  };
  const counts = {
    tasks: byId.size,
    tasksChecked: [...byId.values()].filter((task) => task.checked).length,
    requirements: requirements.length,
    must: must.length,
    mustOpen: report.mustOpen.length,
    mustClosed: report.mustClosed.length,
    otherOpen: report.otherOpen.length,
    otherClosed: report.otherClosed.length,
    planErrors: planErrors.length,
    checkedWithoutFiles: checkedWithoutFiles.length,
    todos: todos.length,
  };
  const ok =
    counts.mustOpen === 0 &&
    counts.planErrors === 0 &&
    counts.checkedWithoutFiles === 0 &&
    counts.todos === 0;
  return { ok, exitCode: ok ? 0 : 1, counts, ...report };
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/** Requirements that share a table row are shown on one line, as the plan writes them. */
function groupByRow(requirements) {
  const rows = new Map();
  for (const requirement of requirements) {
    const row = rows.get(requirement.line) ?? { ...requirement, ids: [] };
    row.ids.push(requirement.id);
    rows.set(requirement.line, row);
  }
  return [...rows.values()];
}

function describeBlockers(row) {
  const maySlip = new Set(row.uncheckedMaySlip);
  return [
    ...row.unchecked.map((id) => (maySlip.has(id) ? `${id} ◇` : id)),
    ...row.withoutFiles.map((id) => `${id} (checked, files missing)`),
    ...row.unknown.map((id) => `${id} (not in the task list)`),
  ].join(", ");
}

/** `count` is the number of items, which differs from the line count when rows are grouped. */
function section(title, count, lines) {
  return [`${title} (${count})`, ...(lines.length > 0 ? lines : ["  none"]), ""];
}

export function renderSummary(result) {
  const { counts } = result;
  return (
    `completion-check: ${result.ok ? "PASS" : "FAIL"} | ` +
    `Must open ${counts.mustOpen}/${counts.must}, Must closed ${counts.mustClosed}, ` +
    `Should/Could open ${counts.otherOpen}, plan errors ${counts.planErrors}, ` +
    `checked without files ${counts.checkedWithoutFiles}, TODO ${counts.todos} | ` +
    `tasks checked ${counts.tasksChecked}/${counts.tasks}`
  );
}

export function renderReport(result) {
  const openLine = (row) =>
    `  ${row.ids.join(", ")} [${row.priority}]: waiting on ${describeBlockers(row)}`;
  const closedLine = (row) => `  ${row.ids.join(", ")}: ${row.tasks.join(", ")}`;
  return [
    ...section("Must open", result.mustOpen.length, groupByRow(result.mustOpen).map(openLine)),
    ...section(
      "Must closed",
      result.mustClosed.length,
      groupByRow(result.mustClosed).map(closedLine),
    ),
    ...section(
      "Should / Could open, informational",
      result.otherOpen.length,
      groupByRow(result.otherOpen).map(openLine),
    ),
    ...section(
      "Plan errors",
      result.planErrors.length,
      result.planErrors.map(
        (error) => `  ${error.line ? `line ${error.line}: ` : ""}${error.message}`,
      ),
    ),
    ...section(
      "Checked without files",
      result.checkedWithoutFiles.length,
      result.checkedWithoutFiles.map(
        (task) => `  ${task.id} is checked but these are missing: ${task.missing.join(", ")}`,
      ),
    ),
    ...section(
      "TODO in audience-facing files",
      result.todos.length,
      result.todos.map((todo) => `  ${todo.file}:${todo.line} [${todo.marker}] ${todo.text}`),
    ),
    renderSummary(result),
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const USAGE = "usage: completion-check [--json] [--tasks <path>] [--root <path>] [--expect <path>]";

export function parseArgs(argv) {
  const options = {
    json: false,
    help: false,
    root: undefined,
    tasks: undefined,
    expect: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") options.json = true;
    else if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--tasks" || flag === "--root" || flag === "--expect") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${flag} needs a path\n${USAGE}`);
      }
      options[flag.slice(2)] = value;
      index += 1;
    } else {
      throw new UsageError(`unknown argument: ${flag}\n${USAGE}`);
    }
  }
  return options;
}

function readInput(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read ${what} at ${path}: ${error.message}`);
  }
}

/** Reads the plan, the expectations and the tree, and returns the evaluated result. */
export function check(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new UsageError(`root is not a directory: ${root}`);
  }
  const tasksFile = resolve(options.tasks ?? join(root, "TASKS.md"));
  const expectFile = resolve(options.expect ?? join(root, "scripts", "completion-expect.json"));

  const markdown = readInput(tasksFile, "the task list");
  const tasks = parseTasks(markdown);
  if (tasks.length === 0) throw new UsageError(`no task entry found in ${tasksFile}`);

  const result = evaluate({
    tasks,
    coverage: parseCoverage(markdown),
    expectations: parseExpectations(readInput(expectFile, "the expectations file")),
    pathExists: (path) => expectedPathExists(root, path),
    todos: scanAudienceFiles(root),
  });
  return { root, tasksFile, expectFile, ...result };
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }
    const result = check(options);
    console.log(options.json ? JSON.stringify(result, null, 2) : renderReport(result));
    return result.exitCode;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`completion-check: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
