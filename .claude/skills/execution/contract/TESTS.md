# TESTS.md — the test plan of /execution

Companion file (README.md 1.2). It refines the acceptance lists of LANES.md section 2 with fixtures, exact cases and
expected values; it never removes a LANES.md test. When this file and the core disagree, the core wins and the
disagreement is a contract question (section 12). A lane is done when every test this file assigns to it exists, has
run, and its report pastes the summary line (LANES.md 1).

Contents: 1 runner, tiers and isolation · 2 shared support · 3 unit tests per module · 4 hook tests · 5 CLI tests in
temp git repositories · 6 JavaScript tests · 7 contract conformance (live) · 8 end-to-end smoke on the fixture ·
9 planted defects for the integration review · 10 coverage matrices · 11 receipts · 12 open points.

---

## 1. Runner, tiers and isolation

### 1.1 Runner
`unittest`, the layout and runner of /harden's `scripts/tests` (checked: /harden uses `unittest` with
`test_*.py` files, `skipUnless` gating and a module docstring that names the run command). From the skill root:

```
python -m unittest discover -s scripts/tests -p "test_*.py" -v                 # fast tier
EXEC_SLOW=1 python -m unittest discover -s scripts/tests -p "test_*.py" -v     # + slow tier
EXEC_SLOW=1 python -m unittest discover -s scripts/tests/e2e -p "test_*.py" -v # end-to-end (section 8)
EXEC_CONTRACT_LIVE=1 python -m unittest discover -s scripts/tests -p "test_contract_*.py" -v
```
`scripts/tests/e2e/` has its own `__init__.py`-free layout and is discovered only with its own `-s` (the fast
command never imports it). Every test module starts with a docstring stating what it protects and its run command.

### 1.2 Tiers and gating
| tier | gate | content | budget on this machine |
|---|---|---|---|
| fast | always | pure functions, schema checks, hooks with stdin payloads, CLI on small temp repos with local bare remotes, Node syntax checks | whole suite ≤ 120 s; one test ≤ 10 s |
| slow | `EXEC_SLOW=1` | real `gates.py` runs, /harden's self-setup dry run (H4-H6), proof runs with installs, the e2e smoke | ≤ 15 min |
| live contract | `EXEC_CONTRACT_LIVE=1` | read-only checks against the sibling skills' real files (section 7) | ≤ 60 s |
| latency | unless `EXEC_SKIP_LATENCY=1` | hook p95 minus a same-run no-op p95 ≤ 130 ms × load; absolute ≤ 250 ms only with `EXEC_LATENCY=1` (HOOKS.md 10.1, revision 4) | ≤ 30 s |

A test that needs `node` or `git` or Git Bash uses `@unittest.skipUnless(<tool found>, "<tool> is needed")`; a
skipped test is reported in the lane's receipt with its reason. The slow and live tiers are run once by each lane
that owns such tests and their summary lines are pasted in the lane's report; they are never part of a CI workflow
(the completion check stays out of CI, CLAUDE.md rule 2).

### 1.3 Isolation (every test)
- Temp directories from `tempfile.mkdtemp(prefix="exec-test-")`, resolved with `Path.resolve()` (the Windows temp
  path contains a short name, `UTILIS~1`, that must never leak into a comparison), removed in `tearDown` with a
  link-safe remover (junctions first).
- Environment built by `_support.env_isolated()`: `EXEC_TEST=1` and `EXEC_NOW` fixed (EXEC_NOW alone is ignored by
  design, README.md 2), `CLAUDE_CONFIG_DIR` = a temp dir (never the real `~/.claude/`), `GIT_CONFIG_GLOBAL` = a temp
  gitconfig holding `user.name`/`user.email` of a test identity, `GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`,
  `EXEC_LOG_LEVEL=debug`, `CLAUDE_CODE_SESSION_ID` = `sess-orch-1`; **no** `PYTHONIOENCODING` and no `PYTHONUTF8`
  (they would hide the cp1252 failure of piped stdio on Windows, README.md 2; `test_encoding.py` runs the CLI and
  every hook with payloads and digests holding emoji, `→`, `≤` and U+202F and asserts valid UTF-8 envelopes and
  ASCII-escaped hook output); `HOME` and `USERPROFILE` unchanged (Git Bash needs them) but nothing is written there (a
  test asserts the mtime of `~/.claude/` is unchanged across the fast suite, `test_isolation.py`, B01).
- No network: `gh`, chain readers and URL fetches are fakes on `PATH` or local `http.server` instances on
  `127.0.0.1` with an ephemeral port. `test_isolation.py` runs the suite's network-sensitive helpers with a socket
  guard (`socket.socket.connect` patched to refuse non-loopback addresses) to prove it.
- Time only through `EXEC_NOW` / `--now`; randomness only through explicit seeds. A test never sleeps to wait for a
  clock; lock-timeout tests pass small timeouts.
- Git repositories: `_support.TempRepo` = a work tree plus a local bare `origin`, `main` branch, `core.autocrlf false`,
  `core.longpaths true`, an initial commit with a fixed author date.

### 1.4 Literals that must be built at runtime
Some strings would trip the owner's global guard (`~/.claude/hooks/guard.py`) when an agent later greps or commits
around the tests, or our own scanners when the skill's tree is scanned. Test sources and fixture files never contain
them literally; `_support.planted(name)` assembles them at runtime:

| name | assembled value (shape) | used by |
|---|---|---|
| `trailer.coauthor` | `"Co-" + "Authored-By: X <x@example.invalid>"` | trailer scan, commit-msg hook, merge refusal |
| `trailer.signoff` | `"Signed-" + "off-by: X <x@example.invalid>"` | same |
| `trailer.generated` | `"Generated " + "with [Claude Code](https://example.invalid)"` | same |
| `env.local`, `env.plain`, `env.example` | `"." + "env" + ".local"`, `"." + "env"`, `"." + "env" + ".example"` | H7, guard, writes-scope |
| `key.private` | a 64-hex string prefixed `"0x"` built from a seeded generator, and a PEM header built from parts | secret scan (positive control) |
| `nevershow.live` | read from the instantiated fixture's never-show file (`ns-embargo-live`), never typed | never-show scans |

Files the tests create with such names (an env file in a temp repo) are created by the test at runtime and removed
with the temp dir; nothing of the kind is committed to the skill.

### 1.5 Positive controls
Every negative assertion ("refuses", "never writes", "no hit", "never fires") has, in the same test method or the
same class, a positive control showing the mechanism can fire: the neighbouring allowed input passes, or the planted
violation is caught. A test whose positive control fails is itself a failure (`_support.assert_controlled`).

### 1.6 Golden files
Golden outputs live under `scripts/tests/fixtures/<lane>/golden/`. They are compared byte for byte. Regeneration:
`EXEC_UPDATE_GOLDEN=1` writes `<name>.new` next to the golden and fails the test; a human (or the lane's verifier)
reviews the diff and renames. A test never overwrites a golden.

### 1.7 Envelope assertions (every CLI test)
`_support.run_exec(args, cwd, env)` returns `(exit_code, envelope, stderr_lines)` and asserts, for every call:
exactly one line on stdout; it validates against `envelope.schema.json`; `ok == (exit_code == 0)`; `exit_code` in
the envelope equals the process's; every stderr line is a JSON object with `ts` (UTC, milliseconds, `Z`), `level`,
`module`, `msg`; no stderr line contains a planted secret, an env value or the live never-show pattern.

---

## 2. Shared support (`scripts/tests/_support.py`, B01)

LANES.md B01 lists `TempRepo`, `fixed_now()`, `run_exec()` and the document builders. Added here (same file, B01):

| helper | purpose |
|---|---|
| `env_isolated(**overrides) -> dict[str, str]` | section 1.3 |
| `planted(name) -> str` | section 1.4 |
| `assert_controlled(test, negative: Callable, positive: Callable)` | section 1.5 |
| `ABSENT` sentinel; `payload(name, **overrides) -> dict` | load `fixtures/B08/payloads/<name>.json`, apply overrides, delete keys set to `ABSENT` |
| `run_hook(script, payload, env, cwd) -> (exit, stdout, stderr, ms)` | runs `bash scripts/hooks/py.sh <script>` exactly as the settings command does (Git Bash located like /harden's `gates.py` does), stdin = JSON |
| `state_dir(repo, *, executor="A", run_state="RUNNING", ...) -> Layout` | writes a minimal valid `.execution/` (plan, status, local/state.json, local/active) for hook and CLI tests |
| `fake_tool(dir, name, script) -> Path` | a fake `gh`, `node`, chain reader or `claude --version` on a temp `PATH`; `.cmd` shim on Windows |
| `http_fixture(routes) -> (url, close)` | local `http.server` returning canned bodies and statuses |
| `fixture_instance(dest=None, **flags) -> dict` | runs `exec.py fixture new` with `--now 2026-10-03T07:12:00Z` (B11 provides it; earlier lanes use the static copies of the rendered drafts in `fixtures/B01/fixture-rendered/`) |
| `canonical(obj) -> bytes`, `sha(b) -> str` | SCHEMAS.md 1.4, for expected values |

---

## 3. Unit tests per module

Test ids are `U-<area>-nn`; each is one test method (or one `subTest` row of a table-driven method).

### 3.1 Schema validator (`test_schema.py`, `test_schema_assets.py`, B01)
| id | case | expected |
|---|---|---|
| U-SCH-01 | `{"type":"integer"}` on `true`, `1`, `1.0`, `1.5` | fail, ok, ok, fail (bool is not integer; 1.0 is) |
| U-SCH-02 | `enum: [1]` on `1.0` and `true`; `const: {"a":[1,2]}` on `{"a":[1,2]}` and `{"a":[2,1]}` | ok, fail; ok, fail |
| U-SCH-03 | `$ref: "common.schema.json#/$defs/utc"` and a deep pointer `plan.schema.json#/$defs/task/properties/verify`; `~0`/`~1` escapes | resolved; issue paths are JSON pointers |
| U-SCH-04 | a ref cycle | E_SCHEMA_DEPTH at depth 64 |
| U-SCH-05 | `if/then/else` (never-show embargo needs `until_utc`); `oneOf` with two matching branches | the embargo without end fails; two matches fail ("exactly one") |
| U-SCH-06 | `additionalProperties: false` with `patternProperties`; `propertyNames` | a key matched by the pattern passes, an unmatched one fails |
| U-SCH-07 | `x-external` on the profile's `frontend` block | collected in `Report.externals`, not validated inline; `run_externals` validates against a temp copy of /frontend's schema and reports a missing file as `missing` (never a pass) |
| U-SCH-08 | a schema of ours using `format` or `dependentRequired` | E_SCHEMA_KEYWORD at registry load (exit 3 through the CLI) |
| U-SCH-09 | another skill's schema with `format: uri` | W_SCHEMA_UNSUPPORTED_KEYWORD naming the keyword; the keyword is skipped, the rest validated |
| U-SCH-10 | issue ordering | sorted by (instance_path, schema_path); `anyOf` failure reports the branch with fewest issues |
| U-SCH-11 | all 25 schemas load; each has `fixtures/B01/docs/<schema>.ok*.json` passing and `.bad*.json` failing with the expected first issue path | — |
| U-SCH-12 | `result-*` schemas contain no `$ref`; `bundle(name)` of every other schema contains no `$ref` either | — |
| U-SCH-13 | the rendered fixture profile (`fixtures/B01/fixture-rendered/profile.draft.json`) validates; the same with `notion.language: "en"` fails at `/notion/language` | positive control of the validator on a real document |

### 3.2 Globs, resources, graph (`test_globs.py`, `test_graph.py`, B01)
Truth table for `intersects(a, b)` (true = may intersect):

| a | b | expected |
|---|---|---|
| `src/queue/**` | `src/queue/model/*.ts` | true |
| `src/**/*.ts` | `src/**/*.css` | false (different literal suffixes) |
| `src/engine/**` | `src/ui/**` | false |
| `**` | `README.md` | true |
| `docs/*.md` | `docs/api/x.md` | false (`*` never crosses `/`) |
| `test/[ab]*.ts` | `test/c.ts` | true allowed (conservative), never false for a real overlap |
| `data/*.json` | `data/requests.json` | true |

`contains(outer, inner)`: `src/queue/**` ⊇ `src/queue/model/*.ts` true; `src/*` ⊇ `src/a/b.ts` false; equal globs
true; unsure → false. Property test (seeded corpus of 2,000 generated paths over 6 segment shapes): no false negative
for `intersects`, no false positive for `contains`. `is_manifest_glob`: `package.json`, `pnpm-lock.yaml`,
`.github/workflows/ci.yml`, `tsconfig.base.json` (root) true; `packages/a/src/x.ts` false; `**` true (it can match a
manifest).

Graph on the 7-task DAG of 3.5: `ancestors(T007) = {T001..T006}`, `descendants(T002) = {T004, T005, T006, T007}`,
`joined(T004, T006) = false`, `joined(T001, T007) = true`, `topo()` respects every edge and is stable (ties by id).

### 3.3 Plan invariants (`test_validate.py`, B02)
One pair `fixtures/B02/invariants/P-xx.{ok,bad}.json` per invariant P-01 … P-27 (LANES.md). Each `bad` fixture breaks
exactly one invariant and the test asserts exactly that code and nothing else (so a fixture that accidentally breaks
two invariants is caught). Required bad cases beyond the obvious ones:
- P-02: `T004` depending on `T005` with no cycle → E_DEP_ORDER.
- P-09: two unjoined tasks writing `src/queue/**` and `src/queue/model/*.ts` → E_WRITE_OVERLAP; the ok fixture adds the
  dependency.
- P-10: two unjoined tasks holding `wallet:hot` → E_RESOURCE_OVERLAP; two holding `browser` → ok (serialized, not
  ordered); a task writing `package.json` without `manifest` → E_MANIFEST_UNDECLARED.
- P-13: a code task with `negative_control.kind: not-applicable` → E_NEGATIVE_CONTROL.
- P-12: a proof spec (and, separately, a `gates.json` command) containing `--allow-skip` → E_PROOF_KIND.
- P-16: a frontend design template task released before `prework.until_utc` → E_PREWORK.
- P-17: FE-21 without the harden-review task as ancestor; FE-21 without the newest EX-FIX-GATE as ancestor; a recording
  task without EX-HARDEN-REVIEW as ancestor; a flip task without FE-21; README screenshots not after the deck or not
  after EX-DLV-PROSE → E_DELIVERABLE_ORDER (one bad fixture each).
- P-23: a `surface: ui` requirement covered by no FE-1x task → E_NO_FRONTEND.
- P-25: the spec file edited after validation (hash differs) → E_SPEC_UNVALIDATED.
- P-26: an approved plan with one task title changed and no amendment → E_PLAN_TAMPERED.
`validate --with-status`: a status file naming `T999` → E_STATUS_ORPHAN; a cut task no longer counts for P-04.

### 3.4 Template instantiation from /frontend libraries (`test_templates.py`, B02)
Two fixtures, both always run: `fixtures/B02/frontend-real-<sha8>.json`, a byte copy of the shipped `frontend.json` in
/frontend's own format (the adapter path of FRONTEND.md 2.1-2.4, end to end), and `fixtures/B02/frontend-sample.json`
below, written in our `task-template.schema.json` format for edge cases. The sample: library `frontend`, version
`1.0.0`, parameters `references` (enum on|off, default on), `mode` (enum
full|small, `from_profile: /frontend/mode`), `ui_root` (glob, default `ui`), `port` (port, default 5173). Templates:
FE-00 (code/build, prework_class research), FE-01 (manual/manual, `include: {param: references, in: [on]}`), FE-02
(research/build, same include), FE-03 (code/build, design; depends `{template: FE-02, when: {param: references, in:
[on]}}` and `{template: FE-00, when: {param: references, in: [off]}}`), FE-04 (decision), FE-05 (code/build, design;
depends FE-04 and `{ref: "@project-name"}`), FE-06 (decision), FE-07 (code/build, design; depends FE-04 and FE-06),
FE-08 (code/build; depends FE-07), FE-1x (`per: feature-group`, covers `group-requirements`, writes
`{ui_root}/src/sections/{group}/**`, depends FE-08 and `{ref: "@feature-tasks"}`, proof chaining `pnpm -C {ui_root}
build && node {frontend_skill}/scripts/frontend-check.mjs --json --gates coverage,render,tells --features {features}
--profile {profile_abs} --serve {ui_root}/dist`), FE-20 (gate/build; depends `{ref: "@all-instances:FE-1x"}`), FE-21
(manual/deliverable; depends FE-20, `{ref: "@harden-review"}` and `{ref: "@fix-gate"}`). Profile: the rendered
fixture profile; draft: the fixture's canned planner draft (FIXTURE.md 3.1) plus the execution-library tasks the refs
need.

| id | case | expected |
|---|---|---|
| U-TPL-01 | references on | FE-03 `depends_on` = [id of FE-02]; FE-01, FE-02 present |
| U-TPL-02 | references off | FE-01, FE-02 absent; FE-03 depends on FE-00 only |
| U-TPL-03 | FE-07 | depends on FE-04 and FE-06 in both cases |
| U-TPL-04 | `name_owner_confirmed: false` (fixture) | one `execution:EX-NAME` decision task; FE-05 depends on it; with `true`: no EX-NAME task, FE-05 depends only on FE-04 |
| U-TPL-05 | FE-1x per group | two instances (G1, G2), keys `frontend/FE-1x.G1`, `.G2`; `{features}` = `FR-001,FR-002,FR-006` and `FR-003,FR-007`; writes `ui/src/sections/G1/**`; covers = the group's ui requirements |
| U-TPL-06 | `@feature-tasks` | FE-1x.G1 depends on the draft's build tasks covering FR-001/FR-002 (not on any task covering only FR-004); a draft where G2's requirements are covered by no build task → E_TEMPLATE_DEP |
| U-TPL-07 | `@all-instances:FE-1x` | FE-20 depends on both instances |
| U-TPL-08 | FE-21 | phase deliverable; depends on FE-20, the harden-review task and the newest EX-FIX-GATE (both through the sample's refs and, for the real library, through the adapter's mapping of `manual:harden-review`); P-17 holds after `validate` |
| U-TPL-09 | prework | FE-03, FE-05, FE-07 (design) have `release_utc` = T0; FE-00..FE-02 (research) have none |
| U-TPL-10 | mode small vs full | the instance estimate is the template's `small` / `full` figures with `source: template:frontend` |
| U-TPL-11 | unknown placeholder `{uiroot}` in one template | E_TEMPLATE_PLACEHOLDER naming the template and field |
| U-TPL-12 | undeclared parameter in the draft | E_TEMPLATE_PARAM |
| U-TPL-13 | determinism | two instantiations with the same inputs and `--now` give byte-identical `plan.json`; `template_digest` equals sha256 of the template object |
| U-TPL-14 | ids | Kahn order with ties by (phase rank, priority, key); T-ids contiguous from T001; `key` kept on each task |
| U-TPL-15 | library absent (temp `frontend_skill` without the file) | exit 1 E_DEPENDENCY_MISSING, a `dependency-missing` proposal in decisions.md, no `plan.json`, no candidate containing any UI task from another source |
| U-TPL-16 | the real-format fixture (`frontend-real-<sha8>.json`) | the adapter validates it against /frontend's schema, specialises and normalises it, and the result validates against `task-template.schema.json`; instantiated with the fixture draft it passes `validate`; a document in neither format (`schema` absent, no `templates[].runner`) → exit 1 E_DEPENDENCY_MISSING with a proposal, no plan, no silent translation |
| U-TPL-17 | `nfr` covers rule | NFR-900 added once with `source: frontend:standard`; a second library template with the same `nfr.key` reuses it |
| U-TPL-18 | serial sections (stack static-html) | the first FE-1x depends on FE-09 and G2's instance on G1's |
| U-TPL-19 | a group whose ui requirements are all `planned` | its FE-1x instance exists without a `@feature-tasks` dependency (positive control: a group with one non-planned uncovered requirement → E_TEMPLATE_DEP) |

### 3.5 Scheduling (`test_schedule.py`, `test_due.py`, B03)
**Lognormal.** `lognormal(26.7, 46.0)` = (μ, σ) with μ = ln 26.7 = 3.2846635654062037 and σ = ln(46/26.7)/1.2816 =
0.4244521153892721 (assert to 1e-12). `lognormal(10, 10)` → σ = 0 and every sample equals 10 exactly.

**CPM on a 7-task DAG** (`fixtures/B03/dag7.plan.json`, durations = p50 minutes, all p10 = p50 = p90 so sampling is
exact, no release unless stated, `now` = 2026-10-03T08:00:00Z):

| task | p50 | depends on |
|---|---|---|
| T001 | 30 | — |
| T002 | 20 | T001 |
| T003 | 45 | T001 |
| T004 | 15 | T002 |
| T005 | 10 | T003, T004 |
| T006 | 25 | T002 |
| T007 | 20 | T005, T006 |

| task | ES | EF | LS | LF | slack |
|---|---|---|---|---|---|
| T001 | 0 | 30 | 0 | 30 | 0 |
| T002 | 30 | 50 | 40 | 60 | 10 |
| T003 | 30 | 75 | 30 | 75 | 0 |
| T004 | 50 | 65 | 60 | 75 | 10 |
| T005 | 75 | 85 | 75 | 85 | 0 |
| T006 | 50 | 75 | 60 | 85 | 10 |
| T007 | 85 | 105 | 85 | 105 | 0 |

Critical path T001 → T003 → T005 → T007, makespan 105 min.
- **With a release**: T006 `release_utc` = now + 70 min → T006 ES 70, EF 95; T007 ES 95, makespan 115; critical
  = [T006, T007] (slack 0), T005 slack 10, T003 slack 10.
- **With a deadline** `DL-x` at now + 100 min on T007 → negative slack −5 (no release) reported, zone red with K = 1.
- **Dispatcher** (`dispatch`, unary lanes, priority = (LST, −remaining path, −successors, id)): lanes = 1 → makespan
  165 (the sum); lanes = 2 → 110 with T003 started at 30 on lane 1, T002 at 30 on lane 2, T004 at 50, T006 at 65,
  T005 at 75, T007 at 90 (T004 beats T006 at 50: equal LST 60 and equal remaining path 45, more descendants under
  either reading of "successors", and a lower id); lanes ≥ 3 → 105 (equal to CPM).
- **Resources**: give T004 and T006 both `browser` with `browser_slots = 1` → they never overlap and lanes = 3 gives
  makespan 110; give them `wallet:hot` instead → `validate` refuses the plan (P-10) before scheduling.
- **Human calendars**: a manual task of 30 min owned by devA, ready at now, with devA awake only from now + 60 min →
  it starts at now + 60; a `talk` window splits nothing (a human task never runs across a non-awake window; it waits
  for a window long enough or the next one).

**Monte Carlo determinism** (`simulate`):
- same plan, `--seed 7 --samples 500`, twice → byte-identical stdout; `--seed 8` → a different histogram.
- default seed = `int(plan_digest[:8], 16)` → two runs without `--seed` are identical; amending the plan changes it.
- the global `random` state is untouched (`random.getstate()` equal before and after an in-process `simulate`), and
  `random.random` is never called (patched to raise during the test).
- hash-seed independence: `simulate` and `schedule` run in two subprocesses with `PYTHONHASHSEED=1` and
  `PYTHONHASHSEED=2` → byte-identical stdout.
- a running task with elapsed time samples only durations beyond its elapsed time; a task kind with a calibrated
  failure probability of 1.0 adds exactly `max_attempts - 1` extra implement-plus-verify cycles; a manual task adds the
  response latency inside awake windows.
- degenerate durations (p10 = p50 = p90) → every sample's makespan equals the dispatcher's (105 with lanes 3).
- P50 ≤ P80 ≤ P90 for every deadline; `criticality` of T001 is 1.0 in the degenerate case.

**Zones** (`zones()` on hand-made sim dicts): p_on_time 0.80 → green, 0.7999 → yellow, 0.50 → yellow, 0.4999 → red.
**Build-complete deadline**: the Origins numbers of LANES.md B03 (submission 2026-10-07T15:59:00Z) with every input of
the formula written in the test's docstring and the instant computed by hand there; plus the fixture: submission =
end, the same formula, and P-24 holds (the deadline is before the submission).
**Cut candidates**: order optional, P3, P2; never a task on the must-have critical path; a red zone produces a
proposal draft and never a cut.
**Readiness**: planned → ready only when every dependency is done (cross-executor: receipt on origin/main) and the
release is past (`--now` one second before → still planned).
**due** (`test_due.py`): a T-6h anchor on `event.deadline_utc` → the instant; a recurrence every 120 min until an
anchor → the right number of occurrences; an overdue latest start reported with `overdue_min`; a freeze becoming
active at its instant; all identical with `TZ` set to `Asia/Singapore` and to `Europe/Paris` in the subprocess
environment (UTC only).

### 3.6 Status transitions and the done check (`test_status.py`, B04)
Table-driven over SCHEMAS.md 4.2: one row per transition, fixture `fixtures/B04/transitions/<n>-<from>-<to>/` holding
the minimal state with the evidence. For each row: (a) with the evidence, the named command performs the transition,
appends history and one `task.status` event; (b) the same command without the evidence exits 4
E_TRANSITION_REFUSED and changes no byte of the status file; (c) a different command (not listed in the row) exits 4.
Specific rows:
- running → ready on a null agent: `reruns + 1`, `consecutive_reruns + 1`, `attempts` unchanged; the third
  consecutive rerun without usage-limit evidence → blocked-decision with a `retry-exhausted` proposal; with a
  `stop.failure` rate_limit event in the window → stays ready and run_state PAUSED_QUOTA.
- running → blocked-decision on `infra-error` (a dependency-missing proposal quoting the logged error).
- planned → running by `wave emit` for an in-wave dependent; running → planned by `wave ingest` on `skipped-dep` (no
  rerun counted).
- running → built from a landed merge receipt alone (no implementer result: the crash-after-push case), found in an
  earlier wave's results directory.
- running → built → verifying → done applied by `proof verdict` while the status still says `running` (no tick in
  between).
- failed → running by `wave ingest` for a prepared in-wave fix attempt.
- running (decision task with a file proof) stays running after `decision resolve` until `choices.json` is written,
  then `status` moves it to done.
- failed → blocked-decision at `attempts == max_attempts`: a `retry-exhausted` proposal exists.
- running (manual) → done only when every `bring_back` key has a verified answer; one unverified key keeps it running.
- `task set-status` to built, verifying or done: exit 4 for each target, from every source state.
- terminal states (done, cut, superseded): every outgoing transition refused.
**Done check**, seven sub-tests, each removing one condition of SCHEMAS.md 4.3 from an otherwise passing fixture:
receipt missing or verdict fail; receipt SHA not the landed SHA, or not an ancestor of origin/main (the bare origin
reset to an older commit); `proof_hash` from a previous plan version; run id pointing at another task's run or at a
run whose `expectation.met` is false; `by.agent_id` null or equal to the implementer's agent id; negative control
required and not met; `skip_markers_added` 1. Each blocks `done` with its own error item; the full fixture passes
(positive control). The same seven run again in the **cross-executor profile**, on a state clone that has the
tracked copies (`proofs/runs`, `proofs/impl`, `proofs/merge`) and no `local/` of the other machine: the full fixture
passes; removing a tracked copy blocks it.

### 3.7 Decisions, answers, manual posting, results (B04)
- `test_decisions.py`: dedup (same kind, title, tasks → same id, `deduplicated: true`); ids A in 001-499 and B in
  500-999 after a union merge of two clones; a second resolution exits 4 E_DECISION_RESOLVED; owner-only kinds refuse
  `--by exec@A`; approve-plan writes `approved.plan_sha256 = plan_digest`; cut → cut-proposed → cut, and refusal
  restores `previous_status`; the owner's quote is read from `--quote-file` and stored verbatim (a quote containing
  `-->`, a backtick or `$(...)` is escaped so the block header still parses, and nothing is executed); `--choice-file`
  holding `approve; rm -rf x` → exit 1 (not an option id); the `quota-override` effect lands in local state and is
  rebuilt by `events replay --rebuild-state`.
- `test_answers.py`: each verification method against a fake (chain reader exit 0 / 1, file exists / missing, choice
  in / out of options, regex, sha on / off origin/main, url 200 / 404 from `http_fixture`, owner-attest allowed only
  for text and transcript kinds); chain-reread forgeries: a value `0xab; echo pwned` refused by the strict pattern
  before any reader runs (the reader's argv log stays empty), a real hash whose reader JSON names another network, a
  `from` other than `verify.expect.from`, or a `block_time` before `posted.at_utc` → verification failed; immutability
  (same key, other bytes → exit 4 E_ANSWER_IMMUTABLE; same bytes → 0); `--scope-change` stores the answer, opens a
  proposal and unblocks nothing; `--relay` stores `<key>-relay-<executor>` and unblocks nothing; an answer holding a
  planted key is stored redacted (`[redacted:...]`) with the raw text only under `local/answers-raw/`.
- `test_manual.py`: `push_text_fr` ≤ 200 characters, names the task id, French (asserted against
  `assets/report-templates/push.fr.json` phrases); `manual post` twice without `--repost` → `already_posted`;
  decision tasks open their linked proposal with options from `manual.options_source`.
- `test_results.py`: schema failure leaves the file in the inbox and lists the issue paths; identical bytes → no-op;
  different bytes → exit 4 E_RESULT_IMMUTABLE; `recover_from_journal` on a fixture journal returns the results that
  were never `put`.

### 3.8 Notion diff by hash (`test_notion.py`, B09)
Fixture: a plan of 4 tasks (T001-T003 executor A, T004 executor B), status A with T001 done (receipt), T002 running,
T003 planned; profile with hub page id `hub-1` and database/data-source ids.
| id | case | expected |
|---|---|---|
| U-NOT-01 | `notion diff --init` | four separate stages (NOTION.md 7.1), never one batch: stage 1 the token and hub check (a real read before any write; adoption of databases a crashed init left), stage 2 the hub skeleton and the Tasks and Waves databases (DDL from `DDL_TASKS`, `DDL_WAVES`; `État` is SELECT, never STATUS), stage 3 the self-relation (after ids exist), stage 4 the views (`Tableau`, `À faire · Dev A`, `À faire · Dev B`, `À ingérer`, `Vagues`) |
| U-NOT-02 | first diff after init acks | one `create-pages` op with exactly T001-T003 (never T004: executor B's row), ≤ 100 rows per call (a 230-task plan gives 3 calls) |
| U-NOT-03 | ack the creates, diff again | `ops == []` (idempotent until something changes) |
| U-NOT-04 | T002 becomes built | exactly one `update-page` op, for T002, carrying only orchestrator-owned properties |
| U-NOT-05 | owner fields | no op of any batch ever contains `Réponse`, `Répondu`, `Décision` or `Pièces jointes` (scan of every op of every test); a verifier finding holding a planted key reaches no op unredacted |
| U-NOT-06 | `row_hash` | depends only on orchestrator-owned properties; changing an owner field in a captured fetch result does not change it; key order does not change it |
| U-NOT-07 | divergence | a fetched row whose orchestrator-owned State differs from the acked hash's value → a proposal, never an update op that overwrites it |
| U-NOT-08 | outbox | after a failed ack, the next batch is only the `token-check` real read; the outbox ops are replayed in the stage after that check is acked ok (a phone reconnect can report success while the token is still rejected), updates regenerated, creates preceded by the `view:board` map rebuild |
| U-NOT-09 | async | an ack whose result holds an async task id schedules a `get-async-task` stage; the dependent update waits for it |
| U-NOT-10 | poll | `notion poll-plan` emits one `query-data-sources` op in view mode on the To ingest view, never rows mode, plus one `fetch` per previous hit |
| U-NOT-11 | dates | Due is a date without zone plus "Due text" carrying the zone and both display zones |
| U-NOT-12 | every batch | validates against `notion-ops.schema.json`; batch ids follow `N-<stamp>-<executor>-<n>` |
| U-NOT-13 | unconfigured | `hub_page_id: null` → exit 1 E_NOTION_UNCONFIGURED |

### 3.9 Report rendering (`test_report.py`, B09)
Golden: `fixtures/B09/wave-W03/` (a state after a wave with 2 done, 1 failed then fixed, 1 manual task awaiting the
owner, zone yellow, quota 62 % five-hour / 71 % weekly, disk 3.1 GB, RAM 1.9 GB) → `golden/W03.fr.md`.
- Section headings, in order and exactly: `Fait`, `Prouvé`, `Ouvert`, `Ta prochaine action`, `Zone et P80`, `Pouls`.
- Single column: no Markdown table wider than 2 columns, no line longer than 100 characters (phone).
- Every instant shown in both display zones (SGT and Paris), never in UTC alone.
- `Prouvé` lists each done task with its proof link (receipt path or CI run URL); a task without a receipt never
  appears there (planted: a status `done` without receipt → absent from Prouvé, present in an "incohérence" line).
- `text_fr` ≤ 6,000 characters; `push_text_fr` ≤ 200 characters naming the task id when the owner must act, and
  null for a fixture where the owner has nothing to do.
- Rendered from files only: deleting the local schedule cache changes the Zone section to "inconnu", never to a
  number.
- `report --view` regenerates `EXECUTION.md` in TASKLIST style (owner, proof, latest date, status per task); English.
- Idempotent: two runs → byte-identical files.

### 3.10 Quota, governor (`test_quota.py` B03, `test_governor.py` B08)
- Snapshot fixture `{"captured_at_utc": "2026-10-03T07:00:00Z", "session_id": "s", "model": "m", "five_hour":
  {"used_percentage": 86, "resets_at": 1791014400}, "seven_day": {"used_percentage": 71, "resets_at": 1791360000}}`:
  `resets_at` converted to UTC exactly (assert the instant); five-hour 86 ≥ 85 → `critical-only`; age 20 min with
  `max_age_s` 900 → `unknown` with W_SNAPSHOT_STALE and no invented percentage; missing file → `unknown`; weekly
  projection short of the plan's P80 need plus the reserve → `pause` and a `quota` decision draft (exit 1); five-hour
  100 % → `pause` with `pause_until_utc` = its reset, and with an `extra-usage` override → `normal`; weekly 100 % with
  the override → `normal`; a `stop.failure` rate_limit event newer than the snapshot → `pause` until the five-hour
  reset even with a 40 % snapshot; a null storm likewise.
- Governor: PowerShell JSON fixtures (captured once from this machine and stored) → lanes = min(profile max,
  floor((disk − floor) / footprint)); RAM under the floor → pause with reason; `.harden/active` → pause; commit
  free < 4 GB → lanes 1; a reading that fails → exit 3; the sweep's candidates never include a path outside the
  project's scratch root and lane worktrees (a planted orphan with another project's path is ignored; one with ours
  is listed).

### 3.11 Never-show and integrity scanners (`test_nevershow.py` B01, `test_integrity.py` B06)
- Never-show with the fixture file at `now` = 2026-10-03T07:12:00Z: `ns-embargo-live` active, `ns-embargo-expired`
  inactive; at `now` = end + 24 h + 1 s the live one becomes inactive; NFKC + lower() (`Ｈａｒｂｏｒ ＤＥＳＫ` matches
  case-insensitively; a literal entry `straße` does not match `STRASSE`, because lower() keeps ß as /frontend's JS
  toLowerCase() does, Q-F9); the regex entry is case-sensitive (`qc-int-123` no hit, `QC-INT-123` hit); scope filter (the
  regex entry is `repo` only: never returned for `rendered`); `Hit` has `entry_id`, file and line, and no field holds
  the matched text (asserted over the dataclass fields and over the CLI stderr).
- Scanners, each with its plant and its clean control: trailers (the three planted trailers; a commit message that
  merely names the rule, "no attribution trailers", is clean, mirroring guard.py's trailer-only regex); secrets (the
  planted key shapes); never-show (live pattern); writes-scope; protected; test-integrity (`.only(` added, an
  assertion removed, `vitest.config.ts` changed); todo-judge-facing (`TODO` in README; `<!--todo-ok-->` exempts the
  line). `with_positive_control`: a scanner patched to always return clean makes the scan `fail` with "blind scan".

### 3.12 Completion, harden-ready, hand-over, fix mode, preflight (B07)
- `test_completion.py` (node required): `completion generate` on fixture plans → script; run on fixture states:
  (a) every gate ok → exit 0, `ok: true`; (b) one gate `skipped` (FRONTEND.build where the fake frontend-check exits
  1 with a skipped gate) → `ok: false`, exit 1; (c) a gate whose check throws → `fail` with "the check itself
  failed"; (d) `--phase build` → exit 0 while every harden and deliverable gate is open; (e) `--phase all` → exit 1;
  (f) the output validates against `completion-gates.schema.json`; (g) generation is byte-identical; (h) the
  generated script contains no `skipped`-to-ok mapping: a mutation test replaces the state computation of one gate
  by the BNB behaviour ("skipped in --json mode" reported ok) and the test suite must fail on it (U-CMP-08 runs the
  mutated script and asserts the suite's checker reports the defect); (i) no file under `.github/` of any fixture
  references `completion-check`.
- `completion run` recomputes `ok` from the gates of the selected phase and refuses an output whose `ok` disagrees
  (planted: a forged script printing `ok: true` with a skipped gate) with exit 3 E_GATES_OUTPUT (SCHEMAS.md 8:
  "`ok` is true iff every gate of the selected phase(s) is ok").
- `test_hardenready.py`: H1 with `.harden/active` → exit 4; H2 a stray untracked file → fail naming it; H3 `it.only(`
  → fail, `it.skip(` → reported, not failing; H7 env file found by name (`planted("env.local")` created in the temp
  repo) with `builtins.open` and `Path.read_text` spied: the file is never opened; H9 the time arithmetic on fixed
  instants; H14 with a fake frontend-check that exits 1 on a skipped gate → fail; H14 and the `FRONTEND.build` gate pass
  `--phase small` when `profile.frontend.mode` is small and `--phase build` when it is full (argv of the fake); every check writes nothing under
  `.harden/` (the directory never exists after the run); H4-H6 on a tiny Python project through the real harden
  scripts (`EXEC_SLOW=1`), asserting `finalize` never received `--install` (argv recorded by a wrapper).
- `test_handover.py`: open gates → exit 1 listing them, nothing changed; green fixture reports → the hand-over data
  (final SHA, `type_this`, time left in SGT and Paris), `harden-profile.draft.json` in the state dir and never in the
  product tree, hooks entries removed, marker deleted; run twice → same data.
- `test_fixmode.py`: `fixtures/B07/harden-report.md` parses into items of the three sections with id, title, file,
  line, severity; a report with a renamed section → exit 1 E_REPORT_FORMAT (never guessed); a selection becomes an
  amend patch with fix tasks (phase fix, each with a proof and a dependency on the harden-review task) and one
  regression gate task; unselected items recorded with the reason; no resolved decision → exit 4.
- `test_preflight.py`: each PF check with a patched environment and fake tools (`claude --version` printing
  `2.1.285` → PF-01 fail; `2.1.286` → ok); /frontend parts missing → PF-13 fail with fix text "decision for the
  owner"; a skipped check keeps `ok: false`, lists its id in `open` and exits 1 (never the BNB "skipped reported as
  ok"); `--confirm PF-18,PF-22` turns them ok with the confirmation in detail and exits 0; PF-20 measured from a
  `hooks.canary` event (`bypassPermissions` ok, `default` fail); PF-25 with a fake `gh` reporting PUBLIC → fail;
  PF-26 with a fake `Date` header 90 s off → fail; PF-27 with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` set → fail; PF-28
  with `EXEC_NOW` set and no `EXEC_TEST` → fail; preflight writes nothing.
- `test_hardenready.py` (in addition): `--after-harden` skips H8 and passes H9 with `harden_end_latest_utc` in the past
  when the deliverables' P80 fits; the report records `profile`.
- `test_completion.py` (in addition): `--phase build,harden` evaluates both phases; `FRONTEND.build` is generated
  with `--state` and `--out`; the generated script has no `--allow-skip`.

### 3.13 Agents, SKILL.md, references (B10)
- `test_agents.py`: rendering substitutes absolute paths (no `${CLAUDE_SKILL_DIR}` left); every template has
  `model`, effort, explicit `tools`, and `disallowedTools` containing every name of the list in LANES.md B10 (the test
  holds the list); the hook command is the absolute `py.sh` launcher; `install` into a temp `CLAUDE_CONFIG_DIR`
  refuses a foreign file without `--force`; `status` reports current, stale (marker version older), missing and
  foreign; /frontend's two agents are reported, never written.
- `test_skill_md.py`: frontmatter keys exactly `name`, `description`, `argument-hint`, `disable-model-invocation:
  true`, and no `model` or `hooks`; the first 20,000 characters contain the headings of SKILL-OUTLINE.md 2.1-2.8, the
  sentence that tells Claude to call the Workflow tool once per wave, the EXEC definition line and the heartbeat
  prompt's shape (`execution heartbeat: run python "<SKILL_DIR>/scripts/exec.py" status and follow
  <SKILL_DIR>/references/tick.md`); `test_heartbeat.py` (B08) checks `heartbeat plan` prints it with this machine's
  absolute paths, and the cron minutes for offsets 7 (`7,27,47`), 45 (`5,25,45`) and 59 (`19,39,59`) with
  `every_min` 20, and for `every_min` 15 and 30.
- `test_references.py`: every `exec.py <words>` in SKILL.md and `references/*.md` is a command of `cli.COMMANDS` with
  options CLI.md defines; every skill-relative path mentioned exists; no `TODO`, `TBD` or `FIXME`; every reference
  named in SKILL.md's pointer table exists and every reference file is named there.

### 3.14 Fixture (`test_fixture_new.py`, `test_fixture_data.py`, `test_fixture_neutrality.py`, B11)
- Data: `tools/gen_data.py` into a temp dir → the three files byte-identical to `evals/fixture/repo/data/`; summary
  `median_capacity_last7_eth` 2891.84, `unfinalized_eth_last_frame` 38863.77, `backtest_unfinalized` [].
- Rule 2.1 reference implementation (in the test, decimal arithmetic) on the data: demo request 48259 → k = 4 / 7 /
  10; the four eligible backtest rows → three within one frame (SC-002 true); eight rows "insufficient data".
- `fixture new --now 2026-10-03T07:12:00Z` → times of FIXTURE.md 4.2 exactly; every creation check C-01..C-10
  passes; the last frame of the shifted series is 2026-10-02T12:00:00Z; a second instance with the same flags in
  another empty dir → identical trees after dest-prefix normalisation; `--variant b` → slug `queue-clock-b`, nothing
  else differs; `--two-dev` → two devs, `repo-b` cloned; `--frontend-mode full` → stack `vite-react`, rounds 3.
- Refusals: non-empty dest → exit 1; dest inside a git work tree → exit 2; an unknown token planted in a temp copy
  of the template → exit 1 (E_FIXTURE_TOKEN or E_SCHEMA, FIXTURE.md Q-FX-2); /frontend's schema absent (temp
  `frontend_skill`) → exit 1 E_DEPENDENCY_MISSING; `--with-remote` with a fake `gh` whose `auth status` fails → exit
  3 and no `gh repo create` call (argv log).
- Neutrality: the forbidden names of FIXTURE.md 1 appear in no template file and no instance file (positive control:
  a planted forbidden name in a temp copy is found).

---

## 4. Hook tests (B08)

### 4.1 Payload fixtures (`scripts/tests/fixtures/B08/payloads/`)
Minimal payloads with every key Claude Code 2.1.286 was observed to send (research: cc-skills-hooks F13-F14). When
HOOKS.md records real payloads captured in the rehearsal, those replace these files and the tests stay unchanged.

`stop.base.json` (field names as the hooks documentation states them; payloads captured in the rehearsal replace
these files):
```json
{"session_id": "sess-orch-1", "transcript_path": "C:/tmp/exec-test/t.jsonl", "cwd": "<REPO>",
 "prompt_id": "p-1", "permission_mode": "bypassPermissions", "effort": "medium", "hook_event_name": "Stop",
 "stop_hook_active": false, "last_assistant_message": "Wave W03 launched.",
 "background_tasks": [{"id": "bg-1", "type": "workflow", "status": "running", "description": "queue-clock-w03"}],
 "session_crons": [{"id": "cron-1", "schedule": "7,27,47 * * * *",
   "prompt": "execution heartbeat: run python \"<SKILL>/scripts/exec.py\" status and follow <SKILL>/references/tick.md", "recurring": true}]}
```
`session_start.base.json`: `{"session_id", "transcript_path", "cwd", "hook_event_name": "SessionStart", "source":
"compact"}`. `session_end.base.json`: `{..., "hook_event_name": "SessionEnd", "reason": "clear"}`.
`stop_failure.base.json`: `{..., "hook_event_name": "StopFailure", "error": "overloaded", "error_details": "..."}`.
`pre_tool.base.json`: `{"session_id", "transcript_path", "cwd", "hook_event_name": "PreToolUse", "tool_name": "Bash",
"tool_input": {"command": "git status"}}` (agent variants add `"agent_id": "agent-7", "agent_type":
"execution-implementer"`). `user_prompt.base.json`: `{..., "hook_event_name": "UserPromptSubmit", "prompt": "où en
est-on ?"}`. `<REPO>` is replaced by the test's temp repo. The marker written by `state_dir()` binds `sess-orch-1`.

### 4.2 Stop gate (`test_stop_gate.py`)
Every case asserts: exit 0; stdout empty or exactly one JSON object; never a `decision` key; the hooks-state file and
the files of `local/hook-events/` as listed.

| id | payload and state | expected |
|---|---|---|
| H-STOP-01 | base (workflow running) | allow (empty stdout); event `stop.allow` reason running; counter unchanged |
| H-STOP-02 | `background_tasks: []`, `session_crons: []`, run_state RUNNING, nothing awaited, `local/schedule.json` ready [T005, T006] | continuation `{"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "execution: the plan is open and nothing is armed (continuation 1/4). Ready: T005, T006. ..."}}` with the absolute exec.py command, ≤ 600 chars; counter 1; event `stop.continue` |
| H-STOP-03 | `background_tasks` ABSENT, local state has wave W03 launched and not finished, heartbeat recorded by `sess-orch-1` | allow (row 7: absent = unknown, the launched wave and the heartbeat count) |
| H-STOP-19 | ready none, `session_crons` holding the heartbeat, run_state RUNNING, nothing awaited | allow, reason `idle-armed`, counter 0 (no false STUCK while waiting for dev B's receipt or a release instant) |
| H-STOP-20 | ready none, `session_crons: []` | continuation whose text names only the heartbeat (no "Ready:" list) |
| H-STOP-21 | awaiting [T004], `session_crons` ABSENT, heartbeat recorded 1 day ago by `sess-orch-0` (a previous session id) | continuation (a recorded cron of another session is not armed) |
| H-STOP-22 | `background_tasks` ABSENT, a launched wave, no heartbeat | continuation |
| H-STOP-23 | governor decision `pause` in local state, ready [T005], heartbeat armed | allow (`idle-armed`: nothing can launch) |
| H-STOP-04 | `background_tasks: []` (present and empty), same local state as 03 | continuation (an empty array is a real "nothing running": the notification turn after the wave ended; the context tells the orchestrator to ingest) |
| H-STOP-05 | `background_tasks` ABSENT, no launched wave, nothing awaited, no heartbeat | continuation (absent never counts as running) |
| H-STOP-06 | awaiting [T004], heartbeat in `session_crons` | allow |
| H-STOP-07 | awaiting [T004], `session_crons: []` | continuation naming "arm the heartbeat" |
| H-STOP-08 | awaiting [T004], `session_crons` ABSENT, heartbeat recorded by `sess-orch-1` 2 days before `EXEC_NOW` | allow; recorded 8 days before → continuation |
| H-STOP-09 | awaiting [T004], a recurring cron whose prompt is something else | continuation (the prompt must start with `execution heartbeat`) |
| H-STOP-10 | run_state PAUSED_QUOTA + heartbeat | allow |
| H-STOP-11 | run_state BUILD_COMPLETE or HANDED_OVER, nothing armed | allow |
| H-STOP-12 | counter escalation: `stop_hook_active: true`, nothing armed, counter 0 → 1 → 2 → 3 → 4 over four calls (each a continuation; the fourth carries the French push text from `push.fr.json`, ASCII-escaped in the JSON); fifth call | fifth = allow + `stuck {reason, source: stop-gate}` in hooks-state + event `stop.stuck`; the next `exec.py status` reports run_state STUCK |
| H-STOP-13 | after H-STOP-12's state (counter 4), a Stop with `stop_hook_active: false` | counter reset to 0, then a continuation (counter 1) |
| H-STOP-14 | session mismatch (`session_id: "sess-other"`) | exit 0, empty stdout, hooks-state and hook-events byte-identical before/after |
| H-STOP-15 | agent payload (`agent_id` present) | same as 14 |
| H-STOP-16 | no `local/active` | exit 0, empty stdout, no file created under `.execution/` |
| H-STOP-17 | corrupt marker (truncated JSON) | fail open: exit 0, empty stdout, one JSON line in `local/hook-errors.log` with the exception type |
| H-STOP-18 | `cwd` is a subdirectory of the repo; and `CLAUDE_PROJECT_DIR` set with `cwd` elsewhere | the marker is found both ways (`hookcore.locate`) |

### 4.3 Session hooks (`test_session_hooks.py`)
| id | case | expected |
|---|---|---|
| H-SS-01 | SessionStart compact, orchestrator, `local/digest.txt` of 1,500 chars written 12 min before | `additionalContext` = age line + digest + the re-read instruction, ≤ 2,000 chars |
| H-SS-02 | digest of 5,000 chars | truncated to ≤ 2,000 chars with the re-read instruction kept at the end |
| H-SS-03 | no digest file | one run_state line from local state + the instruction |
| H-SS-04 | SessionStart startup from another session | nothing |
| H-SS-05 | clear re-key: SessionEnd(reason clear, `sess-orch-1`) at t, then SessionStart(source clear, `sess-orch-2`) at t + 60 s | marker `session_id = sess-orch-2`, `previous_session_ids = [sess-orch-1]`, event `hooks.rekeyed`; the context holds the resume line (`exec.py resume`, CronList) and absolute paths; then a Stop from `sess-orch-2` is handled as the orchestrator and one from `sess-orch-1` is ignored |
| H-SS-06 | same with SessionStart at t + 121 s | no re-key; `sess-orch-2` is a foreign session (nothing printed) |
| H-SS-07 | SessionStart(clear) with no prior SessionEnd(clear) | no re-key |
| H-SS-08 | SessionEnd with reason `logout` or from another session | `rekey_armed_until_utc` unchanged |
| H-SF-01 | StopFailure `error: overloaded` for the orchestrator | hooks-state `stuck = {reason: "stop-failure: overloaded", source: stop-failure}`, event `stop.failure {error, error_details, keys}`, empty stdout |
| H-SF-03 | StopFailure `error: rate_limit` for the orchestrator | no stuck; event `stop.failure`; the next `exec.py quota` pauses until the five-hour reset |
| H-SF-04 | H-SF-01 followed by a Stop of the same session | the next `exec.py status` drops the stuck record (a helper's error, the turn went on) and never reports STUCK |
| H-SF-02 | StopFailure from another session | nothing |

The hooks read time from `EXEC_NOW` only when `EXEC_TEST=1` is also set (positive control: `EXEC_NOW` alone is
ignored); otherwise from the system clock.

### 4.4 PreToolUse guard (`test_pre_tool_guard.py`)
Deny output is exactly `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
"permissionDecisionReason": "<CODE>: <one line>"}}` with exit 0; an allow prints nothing. Every deny row has an allow
neighbour in the same subTest.

| id | caller | tool input | expected (allowed neighbour) |
|---|---|---|---|
| H-PT-01 | main thread | Bash `python <skill>/scripts/exec.py hooks canary --nonce <marker nonce>` | allow + marker bound to the payload session + events `hooks.bound`, `hooks.canary` (wrong nonce: allow, nothing bound) |
| H-PT-02 | agent | the same command with the right nonce | allow, nothing bound (binding only from the main thread) |
| H-PT-03 | anyone | `git push --force origin main`, `git push -f`, `--force-with-lease`, `--mirror`, `--delete`, `git push origin +main` | E_GUARD_FORCE_PUSH (`git push origin HEAD:main` allowed) |
| H-PT-04 | anyone | `git filter-branch`, `git filter-repo`, `git reset --hard origin/main` | deny (`git reset --hard HEAD~0` inside a scratch clone is out of this guard's scope: allowed) |
| H-PT-05 | anyone | `git push origin HEAD:main` with `flags.push_frozen` true | E_GUARD_PUSH_FROZEN (false: allow) |
| H-PT-06 | anyone | `cast send ... --rpc-url https://eth-mainnet.example.invalid` while `flags.mainnet_open` false | E_GUARD_MAINNET_CLOSED (`--rpc-url https://hoodi.example.invalid`: allow) |
| H-PT-07 | anyone | `curl https://wq-api.lido.fi/v2/request-time` ; WebFetch url on that host | E_GUARD_ENDPOINT (another host: allow) |
| H-PT-08 | agent | Read / Grep / Glob under `<private>/research/probes/`, Bash `cat <that path>` | E_GUARD_FENCE_READ (`<private>/research/README.md`: allow) |
| H-PT-09 | main thread | Write `.execution/plan.json`, Edit `.execution/status/A.json`, Bash `echo x > .execution/events.jsonl` | E_GUARD_STATE_PATH (Write `.execution/local/planner/x.json` and `.execution/local/profile.draft.json`: allow) |
| H-PT-10 | agent (implementer) | Write outside the repo (`C:/Users/Utilisateur/x.txt`) | E_GUARD_WRITE_OUTSIDE (a path under `fences.allow_write_outside`: allow) |
| H-PT-11 | agent (implementer) | Write `.execution/local/inbox/W03/T005.implementer.a1.json` | allow; Write `.execution/proofs/T005.json` → E_GUARD_STATE_PATH |
| H-PT-12 | agent | Write `.claude/settings.local.json`, `.githooks/commit-msg`, `.git/config` | E_GUARD_PROTECTED |
| H-PT-13 | agent (implementer) | Write a path matching `plan.protected` (`tests/acceptance/**`) | E_GUARD_PROTECTED (same path by execution-test-designer: allow) |
| H-PT-14 | agent, table over SCHEMAS.md 5.3 | for each agent type × each `exec.py` command word of CLI.md 9 | allowed iff the table lists it; otherwise E_GUARD_COMMAND_ROLE (full matrix, one subTest per cell) |
| H-PT-15 | agent (verifier, reviewer, critic, probe) | `git commit`, `git push`, `git rebase`, Write in `src/` | deny; Write in its inbox: allow |
| H-PT-16 | agent | `mcp__claude_ai_Notion__notion-update-page`, `mcp__claude_ai_Gmail__send_message`, PushNotification, CronCreate, CronDelete, RemoteTrigger, SendMessage, Monitor | E_GUARD_CONNECTOR; the same Notion tool from the main thread: allow |
| H-PT-17 | agent_type `general-purpose` / `workflow-subagent` | implementer-forbidden actions and `exec.py merge` | denied (strictest rules: implementer minus merge) |
| H-PT-18 | anyone | Read of `planted("env.example")` | never denied by this guard (the global guard is the authority on secrets) |
| H-PT-19 | anyone | a deny whose command holds a planted key | the `guard.deny` event's command excerpt ≤ 120 chars and redacted (the key shape absent) |
| H-PT-20 | no marker / corrupt marker | anything | allow (silent; corrupt: one hook-errors.log line) |
| H-PT-21 | main thread of another session (marker bound to `sess-orch-1`, payload `sess-x`) | `exec.py wave emit`, `exec.py decision resolve` | E_GUARD_RUN_LEASE (`exec.py status --digest` and `exec.py resume --takeover`: allow) |
| H-PT-22 | main thread, orchestrator | `exec.py proof verdict ...`, `exec.py merge --by verifier ...`, `exec.py snapshot ...` | E_GUARD_COMMAND_ROLE (A10; `exec.py status`: allow) |
| H-PT-23 | main thread, orchestrator | PowerShell `Set-Content C:\repo\.execution\plan.json x`; PowerShell `python exec.py status` | E_GUARD_STATE_PATH (backslash path normalised); E_GUARD_COMMAND_ROLE (A11) (PowerShell `Get-Date`: allow) |
| H-PT-24 | agent (implementer) | Bash `python -c "open('.execution/proofs/T1.json','w').write('x')"`; `cp x .execution/status/A.json` | E_GUARD_STATE_PATH (B9) (`python ".../exec.py" --state ".execution" result put ...`: allow) |
| H-PT-25 | agent whose payload `session_id` is another session's, `agent_session_scoped` true | a write outside the repo | allow, nothing logged (foreign agent: a /harden or /frontend session's subagent); with `agent_session_scoped` false and no `.harden/active` → denied; with `.harden/active` present → allowed |
| H-PT-26 | agent (verifier) | `exec.py proof verdict --task T005 --run <id> ...` | allow + a `guard.attest {agent_id, agent_type, command, task, run}` event |
| H-PT-27 | agent (implementer, FE task) | Write `.execution/frontend/brief.json` | allow (B1 exception); the same by a verifier → E_GUARD_PROTECTED |

### 4.5 UserPromptSubmit, install, latency
- `test_user_prompt.py`: prompt starting `<task-notification>` → nothing; the owner's prompt in the orchestrator
  session → one line `execution: RUNNING, 1 waves running, awaiting T004; run exec.py status first.`; another
  session → nothing.
- `test_hooks_install.py`: a settings file with foreign hooks and comments-free JSON → foreign entries byte-identical
  after install and after uninstall; tagged entries replaced idempotently (install twice: identical file);
  `switchModelsOnFlag` saved and restored (absent before → absent after; `false` before → `false` after); the
  exclude line added once; an invalid JSON settings file → exit 1 E_SETTINGS_INVALID and the file untouched; the
  marker has a fresh 16-hex nonce and `session_id: null`; every command string is `bash
  "C:/Users/Utilisateur/.claude/skills/execution/scripts/hooks/py.sh" <hook>.py # execution-hook v1` (absolute, no
  `${CLAUDE_SKILL_DIR}`).
- `py.sh`: a missing hook script → exit 0 (never 2); a path with a space; `MSYS_NO_PATHCONV=1` set and unset (the
  /harden pattern, `test_agent_hook_command.py`); `PYTHONUTF8=1` reaches the script.
- `test_hook_latency.py`: p95 of 30 runs per hook through `py.sh`, with a plan of 120 tasks in the state, relative to a same-run no-op baseline (≤ 130 ms × load); the absolute ≤ 250 ms check behind `EXEC_LATENCY=1` (revision 4).
- `test_hook_concurrency.py` (B08, Windows): 16 guard processes started at once, each denying one call, while a loop
  in another process rewrites `local/state.json` through `jsonio.write_json_atomic`: 16 distinct event files in
  `local/hook-events/`, none lost or merged; no `PermissionError` escapes the writer (its retry absorbs every
  collision) and every hook either decided or failed open with one log line.
- `test_exec_argv.py` (B01): `exec.py` run through Git Bash with an argument `/x` (a `--quote-file` path is not the
  point: a value that starts with `/`) arrives unchanged with `MSYS_NO_PATHCONV=1`; the launcher sets it.

---

## 5. CLI tests in temp git repositories

### 5.1 Merge queue (`test_merge.py`, B06)
Setup: `TempRepo` (work tree + bare origin) with a minimal plan whose task T005 writes `src/engine/**`, a `gates.json`
with one offline gate (`python -c "import sys; sys.exit(0)"`), and the task's proof a command proof.
| id | case | expected |
|---|---|---|
| C-MRG-01 | landed path (single-tree): a commit touching only `src/engine/eta.mjs` | exit 0; receipt `outcome: landed`, `landed_sha` = origin/main, `push_attempts` 1, every scan `ok` with `positive_control.caught: true` where the scan has one |
| C-MRG-02 | **simulated non-fast-forward**: a `pre-push` hook installed in the test's work tree pushes, on its first invocation only (marker file), a commit from a second clone to the bare origin, then exits 0 | the first push is rejected (classified `rejected_non_ff` whatever the exact git text: "fetch first", "non-fast-forward" or "failed to update ref"); merge loops to step 1, rebases, re-runs gates and the task proof on the new tree, pushes again: exit 0, `push_attempts` 2, the other clone's commit is an ancestor of `landed_sha` |
| C-MRG-03 | the same hook on every invocation | `push-rejected-exhausted` after 3 attempts, exit 1, origin unchanged by us |
| C-MRG-04 | unit level: `merge_task` with a fake `Git` whose `push_head` returns `rejected_non_ff` twice then ok | three attempts, landed; the fake records fetch → rebase → gates → proof → push in that order each time |
| C-MRG-05 | conflict (worktrees mode): origin changed the same line | exit 1, `outcome: conflict`, `conflict_files` = [the file], `git status` clean (rebase aborted) |
| C-MRG-06 | policy refusals, each from a clean base: planted trailer in the message; live never-show pattern in an added line; planted key; push after `push_freeze_utc`; a write to a protected glob | exit 4 each, origin unchanged; the never-show refusal's stdout and stderr contain the entry id and file:line, never the pattern text |
| C-MRG-07 | writes-scope (worktrees mode): a lane commit touching `README.md` for a task whose writes are `src/engine/**` | exit 1 `scan-failed` |
| C-MRG-08 | third merge call in the same run (`a1r0`); then a rerun (`a1r1`) | exit 4 E_MERGE_ATTEMPTS; the rerun's first call is accepted (the counter is per run) |
| C-MRG-09 | a landed task merged again | exit 4 E_ALREADY_LANDED, and its data is the landed receipt (found in another wave's results) |
| C-MRG-14 | **single-tree with neighbours**: the shared checkout holds T005's changes in `src/engine/**` and T006's uncommitted changes in `src/cli/**`; merge T005 with `--message-file` | landed; the landed commit holds only `src/engine/**`; the shared checkout's HEAD, index and every file (T006's included) are byte-identical before and after; no rebase or stash ran in it; gates ran in an integration worktree under scratch with a `node_modules` junction; the worktree is gone afterwards |
| C-MRG-15 | single-tree, origin moved meanwhile (another clone pushed) | the commit is rebuilt on the new origin/main from the same paths and lands; `push_attempts` 2 |
| C-MRG-16 | crash after push: the test kills merge between the push and the receipt (a fault-injection hook in `merge_task`) | `local/merge-pending/<task>.a1r0.json` remains; the next `status` finalises a `landed` receipt from it; a rerun's merge returns E_ALREADY_LANDED with that receipt and never pushes a second copy |
| C-MRG-17 | conventional scan: a message `Revert "x"` or `updated stuff` | exit 4 E_NOT_CONVENTIONAL (positive control: `fix(engine): use the median capacity` passes) |
| C-MRG-18 | the live never-show pattern in a commit **message** (no added line holds it) | exit 4 E_NEVER_SHOW naming the entry id and the commit SHA, never the text |
| C-MRG-19 | budget: `agent_command_budget_s` 5 with a gate step measured at 10 s | exit 3 E_TIME_BUDGET before the gates step starts; nothing pushed; a later call with the default budget lands |
| C-MRG-20 | `merge` invoked from a linked worktree (`<repo>/.claude/worktrees/w1`) without `--repo`/`--state` | the receipt, the events and the merge lock land in the main repository's `.execution/` (resolve_repo through `--git-common-dir`) |
| C-MRG-21 | a gate whose output says `ENOSPC` | exit 3 E_ENV (a rerun), never `gate-failed` |
| C-MRG-22 | state-only task (writes under `.execution/frontend/**`, empty product diff) | landed, `mode: state-only`, `landed_sha` = origin/main, `push_attempts` 0, scans ran with positive controls |
| C-MRG-10 | no `gates.json`, task of phase build | exit 1 E_NO_GATES; phase contract → allowed with `gates.exit_code: null` and a note |
| C-MRG-11 | `--by orchestrator` from a payload marked as an agent (env stub) | exit 4 |
| C-MRG-12 | the out-dir rule | gates ran with `--out-dir <state>/local/merge-gates/T005-a1/gates`, whose parent holds no `active`; a planted `active` there → refused before running |
| C-MRG-13 | every receipt | validates against `merge-receipt.schema.json` |

### 5.2 Proof runs and verdicts (`test_proof.py`, B06)
| id | case | expected |
|---|---|---|
| C-PRF-01 | command proof `printf 'proof-ok\n'` (bash), landed SHA | exit 0; run in a clone outside the repo (`checkout.path` under the scratch root, `removed: true`); `output_sha256` = sha256 of `output.log` bytes = sha256 of the command's captured stdout (`b"proof-ok\n"`) |
| C-PRF-02 | hashing is stable | two runs → same `output_sha256`, different `run_id`s (`<task>-<sha8>-<stamp>-<n>`, n increments within a second) |
| C-PRF-03 | `proof_hash` | equals `proof_digest(task)`; recording `negative_control.recorded` does not change it; editing `cmd` does |
| C-PRF-04 | pre-implementation control | run on the merge receipt's `origin_before` → the proof fails → `negative_control.met: true`, exit 0; a control that passes → `met: false`, exit 1; a task landed as **three** commits: the control runs on `origin_before`, not on `<sha>^` (which holds two of the task's commits) |
| C-PRF-09 | long paths | a checkout holding a 270-character path clones and runs (`core.longpaths` on the clone) |
| C-PRF-10 | resources | a fake governor reading below the floor → exit 3 E_ENV before any clone; two concurrent proof runs serialise on the `disk-heavy` lock; `--keep` checkouts are deleted by the verdict |
| C-PRF-11 | snapshot reachability | a proof run on a `refs/exec/<task>/td-a1r0` snapshot SHA (not on any branch) checks it out in the clone (the clone fetched `refs/exec/*`) |
| C-PRF-12 | `EXEC_ENV_FILE` | a tx-kind task's command proof sees `EXEC_ENV_FILE` (its value the policy's env file path) and nothing else from the parent environment; a command naming the env file directly → exit 4; `~/.claude/hooks/guard.py` (run on the command text) allows `node --env-file="$EXEC_ENV_FILE" x.js` |
| C-PRF-13 | file proof `json_checks` | each check kind honest and forged (a pick naming no folder, a non-UTC `answered_at`, a channel outside the enum, fewer than two confirmed references, a non-http url) |
| C-PRF-05 | planted-defect control | the patch at `patch_path` applied in the checkout only (the work tree untouched) → proof fails → met |
| C-PRF-06 | gates.py path | the command ran through /harden's gates.py with a one-gate config in the run dir and `inherit_env: false` (an env var set in the test is not visible to the command unless allowlisted) |
| C-PRF-07 | forbidden command | a proof spec naming `planted("env.local")` or a denied command → exit 4 before anything runs |
| C-PRF-08 | timeout | a proof sleeping beyond `timeout_s` → `timed_out: true`, exit 1, the child tree gone |

**Planted forgeries, one per checker** (each must make the expectation `met: false` and exit 1; each with its honest
control passing):

| checker | forgery | honest control |
|---|---|---|
| command | the command prints `PASS` and exits 1 | prints `PASS`, exits 0 |
| command (json) | exit 0 but `expect.json` pointer `/ok` is `false` | `/ok` true |
| command (regex) | exit 0, stdout lacks `stdout_regex` | stdout matches |
| tx | fake reader: hash unknown (exit 1); hash found on another chain id (exit 1); tx found with status failed (exit 1) | reader exit 0 for the recorded hash |
| tx | the hash comes from the implementer's own claim instead of `hash_from` | refused: the run reads only `hash_from` (answer file or checkout file) |
| ci | fake `gh`: success for a different head SHA; conclusion `skipped`; status `in_progress`; workflow file name differs | success for this SHA and workflow |
| file | file present with `json_pointer` value wrong; below `min_bytes`; `must_match` absent; a path escaping the checkout (`../x`) refused | the right value |
| url | `http_fixture` returns 200 with a body lacking `must_contain`; 404; a redirect to another host | 200 with the text |
| human-attest | answer file present with `verification.ok: false`; an answer of another task's key | verified answer of this key |

Verdict refusals (`proof verdict`, exit 4, nothing written): pass on a run with `expectation.met: false`
(E_VERDICT_MISMATCH); run of another task; run SHA ≠ the landed merge receipt's SHA; SHA not on origin/main after
fetch (E_NOT_ON_MAIN: the bare origin reset); stale `proof_hash` after an amendment; negative control required and
absent; findings file failing its schema → exit 1; no `guard.attest` for (task, run) → exit 3 E_ATTESTATION_MISSING;
an attestation whose agent id equals the merge attestation's → refused. Positive: **a verdict while the status file
still says `running`** (no tick ran after the merge) is accepted, takes the SHA from the merge receipt, moves the
status running → built → verifying → done itself, writes the tracked copies `proofs/runs/`, `proofs/impl/`,
`proofs/merge/`, and prints `receipt_sha256`. A second verdict moves the first receipt to `proofs/history/`.

### 5.3 Completion gates, skipped = open (`test_completion_cli.py`, B07)
In a temp repo with a generated `completion-check.mjs` (node required):
- a gate the script cannot evaluate (the state dir's harden-ready report missing) → that gate `skipped`, `ok: false`,
  exit 1, and the human summary lists it under "open"; `--json` prints the same state (never ok: the BNB defect).
- `--phase build` with every build gate ok and `HARDEN.report` + `DLV.*` open → exit 0.
- `REQ.FR-002` with its covering task done but the receipt SHA not an ancestor of HEAD → fail.
- `TODO.judge` with `TODO` in README → fail; with `<!--todo-ok-->` on the line → ok.
- `NEVERSHOW.repo` with the live pattern in a tracked file → fail (no text in the output); expired pattern → ok.
- `PLAN.chain` with a tampered approved plan → fail.
- the script reads only the state dir and the repo: run with the network guard and a read-only `HOME` → same result.

### 5.4 Other CLI tests in temp repos
- `test_amend.py` (B02): two clones of one bare state remote amend concurrently: one push wins; the other is rejected
  (non-fast-forward), drops only its amend commit (`reset --keep HEAD~1`), pulls with rebase, re-applies,
  re-validates and lands version n+2; the chain (P-26) holds; an unpushed status commit made before the lost CAS is
  still there afterwards and pushed; renumbering, deletion, a dependency on a higher id → exit 4; changing the other
  executor's task → exit 4 E_AMEND_IN_FLIGHT (TD-A6); the same decision applied twice → exit 4 E_AMEND_APPLIED; three
  rejections (a pre-push hook as in C-MRG-03) → exit 1 E_CAS_REJECTED with the local state repo untouched.
- `test_sync.py` (B08): A and B append events and decisions in their clones; `sync` on both → union merge with no
  conflict, every line kept once; both edit `plan.json` outside `amend` → exit 1 E_STATE_CONFLICT, rebase aborted;
  `sync` interleaved with a `proof verdict` and event appends from another process → no "unstaged changes" failure, no
  torn or lost line; a planted key in a verifier finding's evidence → exit 4 E_SECRET_IN_STATE, nothing committed;
  a fake `gh` answering PUBLIC → exit 4 E_STATE_REMOTE_PUBLIC, nothing pushed.
- `test_init.py` (B08): create; re-run → `created: false`, no byte changed; join from the state remote as B; another
  project's state → exit 1 E_STATE_MISMATCH; `--pre-t0 --state <dir>` then `--import-from` at T0 copies `frontend/` and
  knowledge files and never an approved plan; `.git/info/exclude` gets each line once; a PUBLIC remote (fake `gh`) →
  exit 4, nothing cloned; `.githooks/commit-msg` written, `core.hooksPath` set, and the hook rejects a planted
  `Co-Authored-By:` message and a non-conventional one and accepts `feat(x): add y` (run through `git commit` in the
  temp repo).
- `test_resume.py` (B04, in addition): a different `CLAUDE_CODE_SESSION_ID` → R1 reports it and nothing is rebound;
  `resume --takeover` moves the old id to `previous_session_ids`, nulls `session_id`, writes a new nonce and clears the
  recorded heartbeat; a `launching` wave with no run and no inbox activity after 10 min → abandoned, tasks ready, never
  re-emitted; with inbox activity → a decision; R9 acks an unacked Notion batch as `crash-unknown`.
- `test_wave_emit.py` (B05, in addition): two live manifests sharing a wallet and a lane → the second emit refuses the
  overlapping task and subtracts the first wave's writers from `limits`; two emits racing for the next id → distinct
  ids (O_EXCL); a `built` task with a dead verifier is emitted with chain `[verifier]`; a gate task gets a gate merge
  receipt at emit.
- `test_wave_ingest.py` (B05, in addition): a re-ingest is byte-identical (keyed DX and claims rows, calibration
  recomputed); a merge receipt from an earlier wave is found; `skipped-dep` → planned; `infra-error` → blocked-decision.
- `test_e2e_*` (section 8) reuse these mechanisms on the fixture.

---

## 6. JavaScript tests (B05, B07)

- **Syntax**: every emitted `waves/Wnn.js` (from several fixture manifests: one task, ten tasks with in-wave deps, an
  FE critique task, a relaunch with `args.skip`), the planner workflow template rendered, and every generated
  `completion-check.mjs` pass `node --check` (`skipUnless` node).
- **Forbidden tokens** (`test_wavejs.py`): `wavejs.static_check` and an independent regex grep in the test both run
  over every emitted script: `Date\.now`, `Math\.random`, `new\s+Date\s*\(\s*\)`, `\brequire\s*\(`,
  `^\s*import\s|\bimport\s*\(`, `\bprocess\.`. Each token planted alone (in code, in a comment, inside an inlined
  fragment) is caught with its line number; `new Date(args.now_utc)` is allowed (positive control); the U+2028 and
  U+2029 characters in a task title are escaped by `js_literal` and the script still passes `node --check`.
- **Fragments**: a fake `critique.js` containing `Math.random` → `wave emit` refuses (exit 1 with the token and the
  fragment file) and writes nothing; the inlined fragments' sha256 in the manifest equals the source file's.
- **Harness** (`scripts/tests/js/wave-harness.mjs`, B05): defines `agent`, `parallel`, `pipeline`, `log`, `phase`,
  `args` as globals with a scripted fake `agent()` (results keyed by label; `null` to simulate a dead agent), evaluates
  the generated script with `new Function`, and prints `{calls: [...], result}` as JSON. `test_wave_harness.py`
  asserts LANES.md B05's list, plus: the fake `agent()` throws if it is called with a `model` or `effort` missing; a
  task's verifier never starts before its implementer's merge outcome is `landed`; concurrency counters never exceed
  `limits.writers`, `limits.verifiers`, `limits.browser_slots`; the script never reads the clock (the harness defines
  `Date` as a throwing proxy for argless use).
- **Completion template** (`test_completion.py`): the generated script imports only `node:` built-ins (grep), exits 0
  iff ok, and prints JSON on stdout only.

---

## 7. Contract conformance, live (`test_contract_*.py`, `EXEC_CONTRACT_LIVE=1`, read-only)

Run by B11 and by the integration review; each test reads the sibling skills' real files and never writes.

| id | check | today (2026-10-01) |
|---|---|---|
| L-01 | the live `~/.claude/skills/frontend/assets/task-templates/frontend.json` goes through the adapter (validated against /frontend's `task-templates.schema.json`, specialised for each mode × references × stack, normalised) and the result validates against our `task-template.schema.json`; its sha256 is compared with the pinned fixture copy's (a difference is reported, so the copy is refreshed deliberately) | expected to pass once B02's adapter exists |
| L-02 | the rendered fixture profile's `frontend` block validates against /frontend's `profile-frontend.schema.json`; the bare mode-B block too | passes (checked while writing this contract) |
| L-03 | our `never-show.schema.json` and /frontend's give the same verdict on the fixture file and on planted edge cases (missing `note`, embargo without end, an id with 64 characters, an id starting with `.`, a `source` of spaces, unknown class) | equal on every case (the mirror is exact since revision 2); the only difference left is `format`, which our subset skips and `nevershow.load` checks by compiling the regex |
| L-04 | /frontend's `feature-catalogue.schema.json` accepts the catalogue golden of FIXTURE.md 3.1; ours accepts it too | — |
| L-05 | `assets/wave-fragments/{critique,directions}.js` exist, define `async function feCritique(api, input)` / `feDirections`, and pass our forbidden-token check and `node --check` once wrapped | — |
| L-06 | `scripts/frontend-check.mjs` exists and `--help` exits 0 listing `--json --gates --features --profile --root --serve --start --url --phase --state --out` | present since 2026-10-01 (it writes `<state>/gates/<UTC>.json` even with `--out`: FRONTEND.md 6.1) |
| L-07 | /harden's `gates.py`, `infer_profile.py`, `prescan.py`, `inventory.py`, `harden_agents.py` accept the flags `hardenbridge` passes (`--help` parsed for each flag name) | — |
| L-08 | `~/.claude/hooks/guard.py` refuses every planted trailer our `scan_trailers` catches, and our scan catches every message of guard's own test corpus (`~/.claude/hooks/test_guard.py`) that guard refuses (equivalence on that corpus) | — |
| L-09 | `/hackathon` `assets/claims.md` and `assets/dx-journal.md` table headers equal the columns `wave ingest` appends; a DX row carries Who, a reproduce line and `UNVERIFIED`; claim ids are `C-nnn` | — |
| L-10 | the usage snapshot written by `statusline.py` (a copy, never the live file) parses with `quota.read_snapshot` | — |

---

## 8. End-to-end smoke on the fixture (`scripts/tests/e2e/`, `EXEC_SLOW=1`, B11)

Everything that does not need an interactive Claude session runs here, with canned agent results written to the
inboxes by the test (playing each role) and real git, real exec.py, real gates.py and real node. One temp root per
test file; `--now` advances explicitly at each step.

| step | command(s) | assertions |
|---|---|---|
| E-01 | `fixture new --dest <tmp>/qc --now 2026-10-03T07:12:00Z` | FIXTURE.md 8 checks; data shifted; one commit |
| E-02 | `init --project queue-clock --executor A --state-remote <tmp>/qc/remotes/state.git` | state skeleton, excludes, INIT |
| E-03 | `preflight --for rehearsal` with fake `claude`, `gh` and readings | exit 1 only for the checks the test makes fail on purpose (PF-01 with a 2.1.285 fake), then 0; skipped checks listed |
| E-04 | `ingest --spec ... --profile-draft ... --policy-draft ... --propose-spec-validation`; `decision resolve` (spec validated, `--by devA --quote-file <file holding "ok spec">`) | profile/policy written; `missing` empty; spec decision bound to the hash |
| E-05 | `hooks install` then a simulated PreToolUse binding (H-PT-01 through `run_hook`) and `hooks canary --nonce` | bound |
| E-06 | `plan instantiate --draft fixtures/B11/planner-draft.json --propose-approval` twice: with the pinned real-format /frontend library copy (section 3.4, through the adapter) and with the contract-format sample, each at a temp `frontend_skill` | `validate` ok for both; catalogue = FIXTURE.md 3.1 golden; EX-NAME present; FE design tasks released at T0; FE-21 after EX-HARDEN-REVIEW and EX-FIX-GATE; approval proposal in French |
| E-07 | `schedule --seed 1`; `decision resolve` approve-plan | ready set = the contract-wave tasks; zones present; run_state RUNNING |
| E-08 | `wave emit` → `node --check` + forbidden-token grep on W01.js; `wave launched --run-id r1`; canned results: implementer commits (real files: the engine with the worked example test), `merge`, verifier `proof run` + `proof verdict`; `wave ingest --finished`; `status` | W01 tasks done with receipts on origin/main; events and calibration updated |
| E-09 | a second wave with three file-disjoint lanes (engine, CLI, data views) | no overlap of writes in the manifest; all land; one task's first attempt carries the mean-for-median defect (FIXTURE.md 9): verifier fail → attempt 2 with the findings in the brief → pass |
| E-10 | a null agent for one task (the harness result `null`) | rerun, attempts unchanged, done after the relaunch with `args.skip` |
| E-11 | `manual post --all-ready` (FE-01, EX-NAME) then `answers ingest` (terminal text) and `decision resolve` | French push texts ≤ 200 chars; tasks done; dependents ready |
| E-12 | merge with the live never-show pattern planted | exit 4, nothing pushed |
| E-13 | `notion diff --init`, fake acks, `notion diff --wave W02`, `report --wave W02` | ops staged; report golden-shaped; no owner field in any op |
| E-14 | delete `local/state.json` mid-wave; `events replay --rebuild-state`; `resume` | local state equal to the pre-deletion one on every rebuilt field; the launched wave classified `relaunch` (different session) |
| E-15 | two-dev: `fixture new --two-dev` instance, B's `init --executor B` in `repo-b`, a cross-executor dependency satisfied by A's receipt on origin/main; `sync` both; a concurrent amend resolved by the push CAS | as in section 5.4 |
| E-16 | `completion generate`; `completion run --phase build` with the /frontend gate faked green; `harden-ready --only H1,H2,H3,H7,H11`; `handover` | build exit 0 while harden and deliverable gates stay open; hand-over printed from receipts (final SHA, `/harden`, time left in SGT and Paris), hooks uninstalled, marker gone |
| E-17 | `fix --report fixtures/B07/harden-report.md --list`, then `--select ... --decision D-0xx` | fix tasks and the regression gate added by amend; run_state FIX; a fix wave lands; build gates re-run green |
| E-18 | the whole run's files | every JSON validates; every text file LF; no `.harden/` anywhere; nothing written under the real `~/.claude/`; `git log` of the product repo has no attribution trailer and only conventional subjects |
| E-19 | single-tree wave with three file-disjoint lanes writing at once in one checkout | each lands its own paths only; no agent commit in the shared checkout; after ingest the shared checkout is re-synced (`reset --mixed origin/main`) and `git status` is clean |
| E-20 | a wave whose every agent is null (the harness returns null for all) | `null_storm`, run_state PAUSED_QUOTA until the snapshot's reset; no relaunch before it |

Not covered here (needs an interactive session; `evals/REHEARSAL.md` walks the owner through them): a real Workflow
launch and its completion wake-up; the Stop gate inside a live session (only its script is tested); the heartbeat
cron firing and being restored on resume; `/compact` and `/clear` with the SessionStart output reaching the model;
Remote Control prompts and phone answers; PushNotification delivery; the Notion MCP calls themselves; usage-limit
nulls from real agents; the safety-classifier model switch; a terminal kill and `claude --resume` with bypass.

---

## 9. Planted defects for the integration review (LANES.md 6)

The reviewer plants each defect on a scratch branch, runs the suite, and records which test failed. A defect no test
catches is a gap and becomes a fix task.

| defect | must be caught by |
|---|---|
| a skipped gate reported ok (the BNB defect) in the completion template | U-CMP (3.12 b, h), 5.3 first bullet |
| `proof verdict` accepting pass on a failed run | 5.2 verdict refusals (E_VERDICT_MISMATCH), U done check |
| the Stop gate treating an absent `background_tasks` as empty | H-STOP-03, H-STOP-05 |
| a scanner without its positive control (blind) | 3.11 `with_positive_control` test |
| a heredoc-written CRLF file in the skill | `test_encoding.py` (B01: every file of the skill tree is UTF-8 without BOM, LF only, final newline) |
| `stop_hook_active` true not incrementing the counter | H-STOP-12 |
| `Math.random` in a wave template | section 6 forbidden-token test |
| a never-show hit printing the matched text | C-MRG-06, 3.11 |
| the guard binding a session from an agent's tool call | H-PT-02 |
| `finalize --install` passed by hardenbridge | `test_hardenbridge.py` argv spy |
| `done` set without the SHA on origin/main | 3.6 done check (ancestor sub-test) |
| a Notion op writing the `Réponse` field | U-NOT-05 |
| single-tree merge rebasing or resetting the shared checkout | C-MRG-14 |
| a thrown `agent()` call classified as a rerun | `test_wave_harness.py` case 2 |
| `proof verdict` refusing a verdict because the status still says `running` | 5.2 positive verdict case |
| preflight reporting `ok` with a skipped check | `test_preflight.py` |
| the hooks writing events by append to a shared file | `test_hook_concurrency.py` |

---

## 10. Coverage matrices (kept in `scripts/tests/coverage.json`, checked by `test_coverage_matrix.py`, B11)

`coverage.json` maps every item below to the test ids that exercise it; the test fails when an item has no test id
or names a test that does not exist (`unittest` loader). Items:
- every command of CLI.md 9 (≥ 1 success test and ≥ 1 failure test with its exit code);
- P-01 … P-27 (ok + bad fixture each);
- every row of SCHEMAS.md 4.2 and the seven done conditions;
- H1 … H14 in both harden-ready profiles, PF-01 … PF-29 (a skipped PF check counts when the test asserts it is listed
  in `open` and keeps `ok` false);
- every row of HOOKS.md 4.1 (rows 0-9) and 8.4 (A1-A11, B1-B9, C rows), and every bullet of MODULES.md 6.2-6.6;
- every error code of README.md 6 (raised by ≥ 1 test, except E_INTERNAL which `test_cli.py` raises through an
  injected exception);
- every proof type (honest + forgery);
- every rehearsal criterion of ARCHITECTURE.md 17 (an e2e step or a REHEARSAL.md step).

This is the completion check of the build itself (CLAUDE.md rule 2): it is red until every item has a test, and it
stays out of any CI workflow.

---

## 11. Receipts

A lane's report pastes, for each tier it ran: the command, the summary line (`Ran N tests in Xs`, `OK` or the
failure counts, with skips and their reasons), the exit code, Python and Node versions, and the `git rev-parse HEAD`
of the skill tree. Claims without that receipt do not count (LANES.md 1).

---

## 12. Open points

Settled in revision 2 (README.md 10): Q-T-1 the adapter is core (L-01, U-TPL-16 now assert it works on the real
format; a document in neither format is refused); Q-T-2 small mode's single FE-1x after FE-09 comes from /frontend's
library through the adapter (the sample keeps per-group instances for the per-group cases); Q-T-3 hooks honour
`EXEC_NOW` only with `EXEC_TEST=1`; Q-T-4 `completion run` recomputes `ok` (CLI.md); Q-T-5 the code is
`E_WAVE_FORBIDDEN_TOKEN`; Q-T-6 the fixtures use the documented field names and are replaced by captured payloads at
the rehearsal; Q-T-7 French display is NOTION.md 9.4 (`report.fr_display`); Q-T-8 the added test modules are in
LANES.md 2 and 4.
