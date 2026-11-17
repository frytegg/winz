# FRONTEND.md — the /frontend interface made executable

Companion of ARCHITECTURE.md 3.1, 3.2, 6.6, 11 and 19, SCHEMAS.md 6 (templates and instantiation), CLI.md `plan
instantiate`, `wave emit`, `completion generate`, `harden-ready` H14 and `preflight` PF-13, and the agreed /frontend
side: `~/.claude/skills/frontend/ARCHITECTURE.md` section 12 and `scripts/CONTRACTS.md` (sections 4, 6.1, 6.1b, 6.3).
It refines them and never contradicts them; section 13 lists the contract questions it raises, for /execution's core
and for the /frontend session.

Owners: B02 (`templates.py` frontend adapter, `catalogue.py`, `ingest.py` frontend block), B05 (`wavejs.py` fragment
inlining, fragment chains, briefs), B06 (`proof.py` plant specs, `merge.py` state-only tasks), B07 (completion gate
`FRONTEND.build`, harden-ready H14, preflight PF-13), B09/B10 (references/frontend.md, the board procedure in
references/manual-tasks.md).

Rule zero: there is **no generic UI template** and no fallback. A /frontend file /execution needs that is absent,
unreadable or invalid stops the command that needs it with E_DEPENDENCY_MISSING (exit 1) and a `dependency-missing`
decision for the owner (section 12) [owner decision /frontend, P-23].

---

## 1. What /execution reads from /frontend

Paths are absolute under `F = C:/Users/Utilisateur/.claude/skills/frontend` (`paths.other_skill("frontend")`).

| file | read by | used for |
|---|---|---|
| `F/assets/task-templates/frontend.json` | `plan instantiate`, `amend`, `validate` (P-21/P-23) | the FE-00..FE-21 templates (section 2) |
| `F/assets/schemas/task-templates.schema.json` | the same | validating frontend.json in its own format (2.1) |
| `F/assets/schemas/profile-frontend.schema.json` | `ingest`, `validate` | `x-external` of `profile.frontend` (section 7) |
| `F/assets/schemas/never-show.schema.json` | `execlib.nevershow.load` | canonical never-show format (section 8) |
| `F/assets/schemas/feature-catalogue.schema.json` | `catalogue` | second validation of the catalogue (section 5) |
| `F/assets/schemas/choices.schema.json` | `decision resolve` (FE-04/06), `answers ingest` (FE-21) | the shape of the `choices.json` entry the orchestrator writes (6.4) |
| `F/assets/wave-fragments/critique.js`, `directions.js` | `wave emit` | inlined verbatim (section 9) |
| `F/assets/schemas/critique-receipt.schema.json`, `directions-receipt.schema.json` | `wave ingest` | validating fragment receipts (9.4) |
| `F/scripts/frontend-check.mjs`, `F/scripts/critique.mjs`, `F/scripts/board.mjs` | proofs, `completion`, `harden-ready` H14 | gate commands (section 6) |
| `F/scripts/node_modules/` (playwright-core, axe) | proofs | presence only (PF-13 runs `node F/scripts/frontend-check.mjs --help`, exit 0 required) |
| `~/.claude/agents/frontend-critic.md`, `frontend-probe.md` | `agents status`, `wave emit` | agent types the fragments call (installed by /frontend, never by /execution) |
| `F/references/*.md` | briefs (`brief_refs`) | implementer reading; never `11-tells.md` (the template rule) |
| `F/references/03-directions.md` "Publishing the board (orchestrator only)" | the orchestrator (main thread) | H1 and H2 boards (section 10) |

Each read records the file's sha256 in the plan (`template_digest`, `params.fragment.sha256`) or the manifest
(`fragments[].sha256`), so a change on /frontend's side is visible as a digest change, never silently absorbed.

---

## 2. The template library: adapter and instantiation

### 2.1 Two formats, one adapter (core: README.md 9, SCHEMAS.md 6.2 step 1)
`frontend.json` follows **/frontend's own schema** (`task-templates.schema.json`: `depends`, `instances`, `params`
overrides, `stacks`, `pre_t0`, `runner`, `fragment`, string proofs). The core adopts this adapter (Q-F1, revision
2): `templates.load_library("frontend")`
1. reads frontend.json, validates it against /frontend's schema (`schema.validate_with`, unsupported keywords reported
   as W_SCHEMA_UNSUPPORTED_KEYWORD, never skipped silently) and records its sha256;
2. **specialises** it for the plan's parameter values (2.2), which removes every override and conditional;
3. **normalises** the result into /execution's template shape by the mapping of 2.3;
4. validates the normalised library against `task-template.schema.json`;
5. hands it to `templates.instantiate` (SCHEMAS.md 6.2). Steps 2-4 are pure and deterministic.
A failure in step 1 or 4 is E_DEPENDENCY_MISSING (the library is unusable as shipped) with the issues listed.
Format detection is by content, never by guess: a document whose `schema` is `"execution.task-templates/1"` is
already in /execution's format and goes straight to step 4 (TESTS.md 3.4's `frontend-sample.json` fixture is written
that way); a document with `library: "frontend"`, an integer `version` and a `templates[].runner` field is /frontend's
format and takes steps 1-4; anything else is E_DEPENDENCY_MISSING.

### 2.2 Parameters and specialisation
| parameter | values | source (in order) | used by |
|---|---|---|---|
| `mode` | full, small | `profile.frontend.mode` (authoritative; a draft value that differs is E_TEMPLATE_PARAM) | estimates, `small_mode.include`, `params.mode.*` overrides |
| `references` | on, off | planner draft `libraries[].params.references`, else `on` | `params.references.*` overrides |
| `stack` | vite-react, next, static-html, existing | `profile.frontend.stack` | `stacks[stack]` replaces, `add_resources`, `sections` |
| `ui_root` | repo-relative folder, no trailing slash, never `.` | planner draft (required) | `{ui_root}` |
| `design` | repo-relative folder | `profile.frontend.paths.design`, else `design` | `{design}` |
| `preview` | port 1024-65535 | planner draft (required when stack is next or existing) | `{preview}`, resource `port:<n>` |
| `build_prefix`, `serve_target` | strings | planner draft (required when stack is existing) | `{build_prefix}`, `{serve_target}` |
| `executor` | A, B | planner draft, else A | every FE task (TWO-DEV.md TD-V4) |

Specialisation, per template, in this order (the file's own `rules`):
1. **Select**: drop the template when `mode` is small and `small_mode.include` is false, or when
   `params.references.<value>.include` is false.
2. **Override**: apply `params.<param>.<value>` for the plan's values: `depends` are appended to `depends`,
   `writes` replaces `writes`, `instances` replaces `instances`.
3. **Stack**: apply `stacks[stack].replace` (each `{from, to}` as a literal, all occurrences, in list order) to
   `proof.spec` and to every string of `fragment.input`; append `stacks[stack].add_resources` to every template whose
   `proof.spec` contains `--serve` or `--start`.
4. **Serial sections**: when `stacks[stack].sections` is `serial`, mark FE-1x for chaining (2.4 step 6).

### 2.3 Normalisation (field by field)
| /frontend field | normalised /execution field |
|---|---|
| `library`, `version` (integer 1) | `library: "frontend"`, `version: "1.0.0"` (`<n>.0.0`), `schema: "execution.task-templates/1"` |
| `id` | `id` (`FE-00`..`FE-21`, `FE-1x`) |
| `title`, `description` | same, placeholders kept for 2.4 |
| `kind`, `phase` | same (they fit matrix 3.1 and the placements of SCHEMAS.md 3.1: FE-00 code/build, FE-01 manual/manual, FE-02 research/build, FE-03/05/07/08/09/1x code/build, FE-04/06 decision/decision, FE-20 gate/build, FE-21 manual/deliverable) |
| `pre_t0` true | `prework_class: "research"`; false and kind code/gate → `"design"` (every such template makes a visual); manual/decision → `"none"` |
| `instances` (after override) | `per: "feature-group"` or `null` |
| (selected) | `include: true` |
| `depends` entry `FE-xx` | `{template: "FE-xx", required: true}`; when FE-xx is per-group and the dependent is single: `{ref: "@all-instances:FE-xx"}` |
| `depends` entry `decision:project-name` | `{ref: "@project-name"}` |
| `depends` entry `manual:harden-review` | `{ref: "@harden-review"}` and `{ref: "@fix-gate"}` (FE-21 waits for the regression gate too, so the owner never signs off a preview the fix wave then changes; P-17) |
| `covers.depends_on_covering_tasks: true` | an extra `{ref: "@feature-tasks"}` |
| every template | an extra `{ref: "@spec-approved"}` for FE-00 (the root); others inherit it through their dependencies |
| `covers.rule: "feature-group"` | `covers: {rule: "group-requirements"}` (single-instance FE-1x in small mode: `{rule: "ui-requirements"}`) |
| `covers.rule: "none"` | `covers: {rule: "nfr", nfr: {key: "frontend-judged-ui", title: "Judged UI built and gated by /frontend", text: "The judged UI is built through /frontend's templates and passes frontend-check at its mode's phase (build in full mode, small in small mode).", priority: "P1", required: true}}` (one shared NFR, `surface: "none"`, numbered NFR-900 upward by SCHEMAS.md 6.2 step 5) |
| `writes` | mapped by 2.5 |
| `resources` | same; `port:{preview}` → `port:<preview>` |
| `estimate.full/small` `{p10,p50,p90}` | `estimate.full/small` `{p10_min,p50_min,p90_min}`; `estimate.verify` and `basis` → `params.verify_estimate`, `params.estimate_basis` |
| `model`, `effort` | same; `verify: {model: "opus", effort: "high"}` |
| `proof` (string spec) | 2.6 |
| `brief_refs` | same (absolute already) |
| `manual` (string `bring_back`) | 2.7 |
| `runner: "fragment"`, `fragment` | `params.fragment = {file, function, input, sha256}` (2.4 step 9; section 9) |
| — | `required: "from-requirements"` and `priority: "from-requirements"` for FE-1x; `required: true`, `priority: "P1"` for the others; `max_attempts: 2`; `owner: "agent"` or `"devA"` (manual/decision) |
| — | `template_digest` = sha256 of canonical JSON of the **original** /frontend template object |

### 2.4 Instantiation (SCHEMAS.md 6.2, frontend specifics)
1. **Groups**: the plan's feature groups that hold at least one `surface: ui` requirement, in group-id order. A
   `surface: ui` requirement id must match `FR-\d{3,}` (/frontend's catalogue schema), else E_GROUP.
2. **Per-group expansion** (FE-1x, full mode): one instance per group; `{group}` = `G1`; `{features}` = the group's
   ui requirement ids in plan order joined by `,` with no space; `feature_group` = the group; `params.group` = the
   group (P-05); key `frontend/FE-1x.G1`.
3. **Single expansion** (FE-1x in small mode, and every single template): `{group}` = `all`, `{features}` = every ui
   requirement id; `feature_group: null`.
4. **Covers**: per-group → the group's ui requirements; small-mode FE-1x → every ui requirement; others → the shared
   NFR.
5. **Dependencies** (resolved now, never at runtime):
   - `references: on` → FE-03 depends on FE-02 (and FE-02 on FE-01, FE-01 on FE-00); `off` → FE-01/FE-02 dropped and
     FE-03 depends on FE-00.
   - FE-07 depends on FE-04 and FE-06 (unconditional in the library: FE-07 after FE-06).
   - FE-05 depends on FE-04 and `@project-name`: the `execution:EX-NAME` decision task when
     `profile.project.name_owner_confirmed` is false (Origins: rename pending), dropped when true.
   - FE-1x depends on FE-08 (full) or FE-09 (small) and on `@feature-tasks`: every non-template draft task and every
     execution-library build task whose `covers` intersect the instance's feature ids; zero matches is
     E_TEMPLATE_DEP naming the group (the planner must give each ui feature a build task; a pure-UI feature gets a
     data or fixture task that covers it).
   - A group whose ui requirements are all `status_expected: planned` gets its FE-1x instance without the
     `@feature-tasks` dependency (it renders the planned labels; SCHEMAS.md 6.2 step 6).
   - FE-20 depends on every FE-1x instance (`@all-instances:FE-1x`) and FE-09.
   - FE-21 depends on FE-20, `@harden-review` and `@fix-gate`; every recording task of the execution library depends
     on FE-21 (SCHEMAS.md 6.2 step 6) and FE-21 is phase deliverable, so P-17 puts it after the build gate, /harden's
     review and the fix gate.
6. **Serial chain** (stack `static-html` or `existing`): the first FE-1x instance also depends on FE-09 and the
   instance of group G(k) on the instance of G(k-1), in group-id order (/frontend's rule, adopted in SCHEMAS.md 6.2
   step 6).
7. **Placeholders** (closed list; anything else is E_TEMPLATE_PLACEHOLDER):

| /frontend placeholder | value at instantiation |
|---|---|
| `{ui_root}`, `{design}`, `{preview}`, `{build_prefix}`, `{serve_target}`, `{mode}`, `{references}` | the parameter |
| `{group}`, `{features}` | step 2/3 |
| `{state}` | absolute `<state_dir>/frontend` (after T0 the main checkout's `.execution/frontend`) |
| `{private_dir}` | `profile.workspace.private_dir` |
| `{profile}` | absolute `<state_dir>/profile.json` (`{profile_abs}`) |
| `{implementer_agent}` | `execution-implementer` |
| `{task_id}` | the T-id, substituted after ids are assigned (SCHEMAS.md 6.2 step 8) |
| `{workdir}` | **kept literally** in `params.fragment.input` and substituted by `wave emit` (9.2) |

8. **Executor and lane**: every FE task gets `params.executor`; code tasks get the plan's frontend lane (2.5).
9. **Fragment tasks** (FE-03, FE-20): `params.fragment = {file, function, input, sha256}` with `input`'s strings
   substituted (except `{workdir}`), `{"$from": "<path>"}` values kept for `wave emit`, and the runner and designer
   agents completed with `agentType: "execution-implementer"` when /frontend's input names none (a workflow agent
   without an agent type would keep the Notion and other write-capable connectors: every agent must be a defined type
   with `disallowedTools`, ARCHITECTURE.md 6.6). Critic and probe keep `frontend-critic` and `frontend-probe`.
10. **Imported pre-T0 work** (section 11): FE-00, FE-01 and FE-02 instances get `params.imported: true` when
    `init --import-from` brought the matching files.
11. Validation (`exec.py validate`) then runs every invariant; same inputs give byte-identical tasks.

### 2.5 Writes and the frontend lane
`plan.json` writes are repository-relative globs (common.schema.json `glob`). The mapping:
| template write | plan write |
|---|---|
| `{state}/<path>` | `.execution/frontend/<path>` (repo-relative, the state repo being at `<repo>/.execution`) |
| `{profile}` (FE-01) | none (owner task; the profile is patched by exec.py, 6.4) |
| `{private_dir}/frontend/captures/**` (FE-02) | none in `writes`; kept in `params.external_writes`; `validate` requires `policy.fences.allow_write_outside` to contain `<private_dir>/frontend/captures` (else E_PREWORK naming the missing fence) |
| `{ui_root}/**` (FE-08, FE-20; FE-1x in small mode) | for stacks vite-react and next: `{ui_root}/src/**`, `{ui_root}/public/**`, `{ui_root}/index.html`, `{ui_root}/*.config.*`, `{ui_root}/app/**`; for static-html and existing: `{ui_root}/**` |
| other `{ui_root}/...`, `{design}/...`, `brand/**` | substituted as is |

Why `{ui_root}/**` is narrowed for package stacks: it can match `{ui_root}/package.json`, a manifest (SCHEMAS.md 7.3)
that belongs to the contract lane. The UI package's manifest and its single install are made by the contract wave
(`execution:EX-CONTRACT`, ARCHITECTURE.md 6.2: one install by one agent), from the stack named in the profile; FE-08
keeps its `manifest` resource (it serialises with other manifest holders) and reports `blocked: decision` if it needs a
dependency the contract wave did not declare. A static folder (static-html) must not hold a package.json (validate
E_MANIFEST_UNDECLARED otherwise). Contract question Q-F3 informs /frontend.

The planner declares one **frontend lane** (executor = `params.executor`) whose globs cover every FE write:
`{ui_root}/**` (or the narrowed list), `{design}/**`, `brand/**`, `.execution/frontend/**`. FE-07 and FE-09 both write
`{design}/provenance.json`, and FE-08/FE-20 overlap FE-1x: all are joined by dependency paths, so P-09 holds.

### 2.6 Proofs
| /frontend proof | plan proof |
|---|---|
| `type: command`, string `spec` | `{type: "command", spec: {cmd: <spec after substitution and stack replaces, with ` --out "$EXEC_PROOF_OUT"` appended to every `frontend-check.mjs` invocation>, shell: "bash", cwd: ".", install: <true iff cmd contains "pnpm -C">, timeout_s: max(60, max_runtime_min × 60) + (600 if install else 0), env_allowlist: ["PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PNPM_HOME", "FRONTEND_CHROMIUM", "EXEC_PROOF_OUT"]}, expect: {summary: <expect text>, exit_code: 0}, max_runtime_min, negative_control: 2.8}` (`proof run` sets `EXEC_PROOF_OUT` = `<run dir>/frontend-out` in the one-gate config's `env`, so large outputs and the report copy land in the run directory) |
| FE-01 `type: file`, `{profile}#/frontend/references` | `{type: "file", spec: {path: "<profile abs>", json_pointer: "/frontend/references", json_checks: [{pointer: "", check: "min-items", where: {owner_confirmed: true}, value: 2}, {pointer: "/*/url", check: "url"}, {pointer: "/*/source", check: "non-empty"}]}}` (at least two entries with `owner_confirmed: true`, each with an http(s) url and a non-empty source: /frontend's expect, checked as JSON, never by a regex over text) |
| FE-04, FE-06 `type: file` on `choices.json#/H1|H2` | kept as a file proof (matrix 3.3 allows `file` for decision tasks): `{type: "file", spec: {path: "<state>/frontend/choices.json", json_pointer: "/H1", json_checks: [{pointer: "/pick", check: "dir-exists", base: "<state>/frontend/directions"}, {pointer: "/answered_at", check: "utc"}, {pointer: "/channel", check: "enum", values: ["notion", "remote-control", "ask-user-question", "terminal"]}]}}` (FE-06: `/H2` and base `<state>/frontend/brand/candidates`); evaluated by exec.py when the decision resolves and at every `status` until the orchestrator has written the entry (SCHEMAS.md 4.2), so FE-07 never starts on a missing or dangling choice |
| FE-21 `type: file` on `choices.json#/H3` | `{type: "file", spec: {path: "<state>/frontend/choices.json", json_pointer: "/H3", json_checks: [{pointer: "/signed_off", check: "equals", value: true}, {pointer: "/changes", check: "equals", value: []}, {pointer: "/answered_at", check: "utc"}, {pointer: "/channel", check: "enum", values: ["notion", "remote-control", "ask-user-question", "terminal"]}]}}` plus validation of the H3 entry against /frontend's `choices.schema.json` |

Commands run from the root of a clean checkout of the landed SHA (CLI.md `proof run`), where `{state}` and
`{profile}` are absolute paths into the main checkout's state repo, so a verifier reads the same state the
implementer wrote. frontend-check never builds; the build is chained before it. Exit 0 iff every requested gate is
ok; a requested gate that is skipped exits 1 (CONTRACTS.md 4) — the command-proof runner reads only the exit code.

### 2.7 Owner tasks (`manual`)
| template | plan `manual` |
|---|---|
| FE-01 | `steps` substituted; `bring_back: [{key: "<T>-refs", kind: "text", description: <bring_back text>, verify: {method: "regex", spec: "^(?:(?:keep|replace|drop|add) [^\\n]+\\n?)+$"}}]`; `options_source: null`; `options: []`; `where: "phone"` |
| FE-04 | `bring_back: [{key: "<T>-pick", kind: "choice", verify: {method: "choice-in-options"}}]`; `options_source: "<state>/frontend/directions/"`; `options: []` (filled at `manual post` from the folders present, excluding `generic`: `A`, `B`, `C`) |
| FE-06 | same with `options_source: "<state>/frontend/brand/candidates/"` (options `1`..`n`) |
| FE-21 | `bring_back: [{key: "<T>-signoff", kind: "text", verify: {method: "regex", spec: "^(?i:oui|yes)\\b"}}]`; `where: "laptop"` |
`latest_start_utc` = the task's CPM latest start computed at instantiation on P50 durations against
`DL-build-complete` (FE-21: against the recording task's latest start), moved earlier into dev A's previous `awake`
window when it falls outside one (P-14 warning otherwise); `decision_deadline_utc` = latest start + the template's
owner P90; `push_text` rendered by `manual.push_text_fr` (≤ 200 characters, names the T-id). A `non` to FE-21 fails the
regex: the answer is kept, the task stays open, the orchestrator first writes `H3 = {signed_off: false, changes:
[<the owner's numbered list, one string per item>], answered_at, by, channel, source}` into `choices.json` (the shape
/frontend's `choices.schema.json` provides for a refusal; `answers ingest` data `frontend_choice`), then proposes a
decision (kind `amendment`) whose option `fix` adds fix tasks (phase fix) from that list and supersedes FE-21 with a
new instance after them (P-02 forbids adding dependencies to the existing one; FIX-MODE.md 6 uses the same pattern).

### 2.8 Negative controls (plant specs; core since revision 2: CLI.md `proof run --negative-control`)
/frontend states each control in prose ("Delete X: gate Y must fail"). P-13 needs `planted-defect` for code tasks and
`forgery` for gates, and the plant must not damage the real state. The adapter maps each control to
`{kind: "planted-defect" | "forgery", description: <the /frontend text>, patch_path:
"negative-controls/<key>.plant.json", expect_nonzero: true}` (FE-20 → `forgery`; the others → `planted-defect`), and
`plan instantiate` writes the plant file from the built-in table `templates.FE_PLANTS`:

| template | plant ops |
|---|---|
| FE-00 | `json-set` `{state}/brief.json` `/hero/source` = `""` |
| FE-02 | `delete` the first file listed under `receipts` in `{state}/refs-index.json` |
| FE-03 | `delete` `{state}/directions/<last direction letter>/hero-mobile.png` |
| FE-05 | `delete` the 16 px render of candidate `1` under `{state}/brand/candidates/1/` |
| FE-07 | `json-set` `{design}/tokens.json` `/color/tokens/0/usage` = `""` (checkout file) |
| FE-08 | `regex-replace` in the checkout file holding `data-hero="h1"`: its text → `PLANTED` |
| FE-09 | `regex-replace` `{ui_root}/public/icon.svg`: remove every `@media (prefers-color-scheme` block |
| FE-1x | `regex-replace` in `{ui_root}/src/sections/{group}/**`: the first `data-feature="<first id of {features}>"` → `data-planted="x"` |
| FE-20 | `json-set` `{state}/critique/receipt.json` `/ok` = `false` |

Plant file format: `{"version": 1, "ops": [{"op": "json-set" | "delete" | "regex-replace", "target": "state" |
"checkout", "path": "<path relative to the state's frontend dir or to the checkout>", "pointer": "...", "value": ...,
"pattern": "...", "replacement": "...", "glob": "..."}]}`. `proof run --negative-control` applies it **only to
copies**: ops on `target: state` copy `<state>/frontend` to `<scratch>/proof/<run_id>/frontend-copy` and replace the
absolute state path inside the proof command with the copy's path; ops on `target: checkout` apply to the clean clone.
The real state is never touched (tested). A plant whose target is missing (for example a direction folder that small
mode never drew) uses the last existing item; none at all is `exit 3` with "the plant has no target", never a pass.

---

## 3. Chains, workspaces and merging of FE tasks

### 3.1 Chains (wave manifest `chain`)
| FE task | chain |
|---|---|
| FE-00, FE-02, FE-05, FE-07, FE-08, FE-09, FE-1x | `["implementer", "verifier"]` (implementer ends with `exec.py merge`) |
| FE-03 | `["fe-directions", "integrator", "verifier"]` |
| FE-20 | `["fe-critique", "integrator", "verifier"]` |
| FE-01, FE-04, FE-06, FE-21 | never in a wave (owner tasks: `manual post`, answers, decisions) |

The fragment step, the `integrator` step and the receipt hand-off are specified by WAVES.md section 6 (this file
does not restate them): the wave script copies the fragment's returned receipt to
`<state>/local/inbox/<wave>/<task>.fe-<role>.a<n>.json` for `wave ingest`; the `integrator` is one
`execution-implementer` agent (sonnet, low) that runs only the `exec.py merge` command of its brief and returns the
merge receipt unchanged; then the verifier re-runs the template's proof on the landed SHA. A receipt with `ok: false`
ends the chain as `failed` (or `rerun` when an agent inside returned null), WAVES.md 6.3.

### 3.2 Workspace of fragment tasks (WAVES.md 6.2)
Fragment agents share one checkout across many agent() calls, so `{workdir}` is never an agent-managed worktree:
- feDirections (FE-03) runs in the main checkout: it writes only the /frontend state directory (3.3).
- feCritique (FE-20) runs in an exclusive worktree `<scratch_root>/<project>/fe/<task>-a<n>` on branch
  `exec/<task>-a<n>`, created from origin/main by the step's `prepare` command, because its rounds commit fixes and
  restore the best-so-far with a revert of `<best>..HEAD`, which must never touch another lane's commits; the emitter
  passes `commands.restore` = `git revert --no-commit {sha}..HEAD && git commit -F <restore message file>` (a
  conventional `revert:` message; git's default `Revert "..."` would fail merge's conventional scan, WAVES.md 6.2);
  the worktree is prepared by `exec.py fe-workspace` per run key `a<n>r<k>`; the integrator lands the branch with
  `merge --worktree <wt> --branch exec/<task>-a<n>r<k>`, and merge removes the worktree link-safely.

### 3.3 State-only tasks (FE-00, FE-02, FE-03, FE-05; core since revision 2: CLI.md `merge`, SCHEMAS.md 4.2)
Their writes lie entirely under `.execution/frontend/**`; their product diff is empty. `exec.py merge` recognises a
task whose writes are all under `.execution/` and whose `origin/main..HEAD` diff is empty: outcome `landed`,
`landed_sha` = the fetched `origin/main`, `push_attempts: 0`, offline gates not run (`gates.exit_code: null`, note
`state-only task: product tree unchanged`), scans run on the empty diff (each still with its positive control), the
task's own proof run as usual. The state files themselves reach the state remote through `sync` (TWO-DEV.md 2.3)
and their history is the state repo's.

### 3.4 Guard
Agents of FE tasks write `.execution/frontend/**` (SCHEMAS.md 5.1). HOOKS.md rule B1 allows it to
`execution-implementer` only (FE task implementers and the fragment runners and designers, which 2.4 step 9 and
WAVES.md 6.2 give that agent type); verifiers, reviewers, critics and probes are denied. Every agent call of an FE
task therefore names an agent type: a generic workflow agent would be both refused here and free of the
`disallowedTools` list. TWO-DEV.md TD-V4 keeps one writer machine.

---

## 4. Briefs of FE tasks (B05)

Every FE implementer brief names: the task's `brief_refs` (absolute, /frontend's references, never `11-tells.md`),
`<state>/frontend/brief.md` (from FE-01 on), the feature catalogue path, the profile path, the never-show path, the
claims ledger path, the routes file `{design}/routes.json` (FE-1x), and for imported tasks (section 11) the sentence
"Outputs exist from before kickoff: re-run the proof, fix only what fails, never redo captures." It states the
standing rules of ARCHITECTURE.md 6.6 and: build only inside your writes; never edit `{design}/waivers.json`, the
checker, the proofs or another group's section; mark every feature root `data-feature="<FR id>"` and every rendered
figure with `data-ledger` or `data-source` (CONTRACTS.md 6.6); a dependency or asset the task forbids is a `blocked`
result with `kind: decision`, never a workaround.

---

## 5. The feature catalogue (`execlib.catalogue`)

- Content: one entry per requirement with `surface: ui`, in `requirements` order: `{id, group, title, priority}` plus
  `status_expected` when not null (SCHEMAS.md 6.3). Ids are `FR-\d{3,}` (2.4 step 1).
- Written to `profile.paths.feature_catalogue` (absolute; default `<state_dir>/feature-catalogue.json`) by `plan
  instantiate`, `amend` and `catalogue`, with `jsonio.write_json_atomic` (2-space indent, keys sorted within each
  entry, array in plan order, LF, final newline): the same plan gives the same bytes.
- Validated against /execution's `feature-catalogue.schema.json` and /frontend's (`minItems: 1`). A plan with no ui
  requirement writes no catalogue and has no FE-1x; FE-00..FE-09/20/21 then still apply only if the spec names a
  judged surface (`profile.frontend.judged_surface`), else the planner leaves the frontend library out and P-23 holds
  trivially.
- `profile.frontend.paths.feature_catalogue` must equal `profile.paths.feature_catalogue` (section 7).
- /frontend reads it, maps each id to a route in `{design}/routes.json` and renders `data-feature="<id>"`; the
  `coverage.features` gate with `--features <ids>` is the per-group proof.

---

## 6. Proof commands, checkpoints and the build gate

### 6.1 The proof of every instance
The proof command of an instance is **the template's `proof.spec` after substitution and the stack's replaces**
(2.2-2.6), plus ` --out "$EXEC_PROOF_OUT"` on each `frontend-check.mjs` call; nothing is restated here, so this file
can never drift from frontend.json (tests assert against the library itself). One worked example, copied verbatim
from frontend.json (FE-07, 2026-10-01), then as instantiated with `S` = `<state_dir>/frontend`, `P` =
`<state_dir>/profile.json`:
```
template: node C:/Users/Utilisateur/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates tokens,ip.fonts,ip.hotlinks --profile "{profile}" --root . --state "{state}"
instance: node C:/Users/Utilisateur/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates tokens,ip.fonts,ip.hotlinks --profile "P" --root . --state "S" --out "$EXEC_PROOF_OUT"
```
Stack `next`: the stack's replace turns `--serve "<ui>/dist"` into `--start "pnpm -C <ui> start --port <preview>"
--url http://127.0.0.1:<preview>` (resource `port:<preview>`). Stack `static-html` (Origins small mode): no build
prefix, `--serve "<ui>"`. Every UI proof holds the `browser` resource (at most `browser_slots` at once, one while RAM
is low). frontend-check also always writes its report to `S/gates/<UTC>.json` (measured: `--out` adds a copy, it does
not move it); `frontend/gates/` is machine-local in the state repo (`.gitignore`, SCHEMAS.md 1.1), so verifier runs
never create a second writer of a synced path.

### 6.2 `FRONTEND.build` in the completion check and H14
`completion generate` adds the gate `FRONTEND.build` (phase build) when the plan has frontend tasks; it runs, from the
repository the check runs in, the FE-20 command without the receipt check (CLI.md `completion generate`):
`<build prefix> node F/scripts/frontend-check.mjs --json --phase <fe-phase> --profile "P" --root <repo> --state "S"
--out <temp dir> <target>` and requires exit 0; a skipped gate inside is open (exit 1). `<fe-phase>` is `build` when
`profile.frontend.mode` is full and `small` when it is small (/frontend CHANGELOG v1.1: `--phase small` runs render,
a11y, coverage, firstview, tells and ip; the full build phase would fail a small-mode UI on its brand gates). The EX-GATE-BUILD and EX-FIX-GATE
proofs that run the completion check have `install: true` (the gates.json install runs in the verifier's clean clone
first; without `node_modules` the chained build could never pass, P-18). `harden-ready` H14 runs the same command on
HEAD of the fresh clone H6 installed (HANDOVER.md H14). A missing checker makes the gate `fail` with detail
`frontend-check missing`, never `skipped`-as-ok.

### 6.3 The three owner checkpoints
H1 = FE-04 (decision), H2 = FE-06 (decision), H3 = FE-21 (manual, deliverable). The frontend lane waits on them;
every other lane keeps running (they are ordinary graph nodes).

### 6.4 Writing the owner's answers back to /frontend
- FE-04/FE-06: the orchestrator resolves the decision (`decision resolve --id D --choice-file <file> --source
  notion|remote-control|terminal --by devA --quote-file <file>`, CLI.md 0.7). `decision resolve` prints in its data
  `frontend_choice: {path: "<S>/choices.json", key: "H1" | "H2", value: {pick, change, answered_at, by, channel,
  source}}` (`change` = the one sentence after the pick in the quote, else `""`; `channel` = the source; `source` =
  `.execution/decisions.md#<D>`), and the orchestrator writes it into `choices.json` with the Write tool, merging the
  existing keys, `version: 1`, per /frontend's `choices.schema.json` (exec.py itself never writes `frontend/`,
  SCHEMAS.md 5.1; the guard lets the orchestrator write that one file, HOOKS.md 8.4). The task reaches `done` only
  once its file proof (2.6) evaluates ok on what was written.
- FE-21: after `answers ingest` accepts `oui`, the same procedure writes `H3 = {signed_off: true, changes: [], url:
  <preview URL>, answered_at, by, channel, source: ".execution/answers/<key>.md"}` (`answers ingest` data
  `frontend_choice`); FE-21's file proof then reads it. A `non` writes the refusal shape first (2.7).
- FE-01: after `answers ingest` accepts the reply, the orchestrator turns each line into a references patch
  (`keep` → `owner_confirmed: true`; `replace` → new url, `source: "owner <answer key>"`, confirmed; `drop` → entry
  removed; `add` → new confirmed entry) and runs `exec.py ingest --patch <patch> --answer <key>` (CLI.md `ingest`:
  allowed without a decision only for pointers under `/frontend/references` and a verified FE-01 answer).

---

## 7. The profile `frontend` block

- Built by `ingest` from the orchestrator's draft, validated by `profile.schema.json` (only `mode` and `run_mode:
  "A"` checked there) and in full by /frontend's `profile-frontend.schema.json` (`x-external`, `on_missing:
  decision`): its required fields `judged_surface`, `stack`, `hosting` have no default and are listed in `missing`
  when absent, never invented.
- One truth per fact (CONTRACTS.md 6.1): top-level `prework {code, designs, until_utc}` is authoritative;
  `frontend.prework_designs` only overrides `designs`; `phase_b.claims_ledger` is the claims ledger;
  `workspace.private_dir` is the captures folder. `ingest` writes the mirrors /frontend reads and `validate` checks
  equality (E_SCHEMA on a mismatch): `frontend.paths.claims_ledger = phase_b.claims_ledger`,
  `frontend.paths.never_show = paths.never_show`, `frontend.paths.feature_catalogue = paths.feature_catalogue`,
  `frontend.paths.spec = paths.spec`, `frontend.paths.research = paths.research`, `frontend.workspace.private_dir =
  workspace.private_dir`. `frontend.paths.design` stays repo-relative.
- `frontend.critique` is read by feCritique through `{"$from": "frontend.critique"}` at wave emission; small mode
  caps rounds at 1 inside the fragment.
- `frontend.sponsors` (preferred) or `sponsor_allowlist` (deprecated alias) name entries of /frontend's sponsor
  allowlist; /execution never reads that file.
- Origins values (for the approval summary, owner to confirm at approval against the 20 % UX & Design weight
  [origins F07]): `mode: small`, `stack: static-html`, `hosting: gh-pages`, `judged_surface: site`, `format.video`
  set (the demo is a recording), `review_surface: claude-design`, `references` from the brief's customers.

---

## 8. The never-show list, used by both skills

- One JSON file at `profile.paths.never_show`, outside every repo, in /frontend's format (canonical: its
  `never-show.schema.json`; ours mirrors it exactly: `note` optional, the id pattern
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, `source` with a non-space character, and an `embargo` entry requires a
  `until_utc` string; our subset validator skips `format`, so the regex-compiles check is done by `nevershow.load`).
  `nevershow.load` validates against both and reports W_NEVER_SHOW_SCHEMA_DRIFT on a disagreement.
- An entry is active iff `until_utc` is null or after now (`clock`, UTC); both skills use the same instant rule.
- /execution scans scope `repo|both`: every merge (added lines of the diff, the tree and the new commit messages,
  `merge` scan `never-show` with a positive control), the `NEVERSHOW.repo` completion gate, and the public flip task,
  whose proof scans the whole history (`git log --all -p` and every commit message: an embargo recorded after a
  commit was made would otherwise publish through history); /frontend scans scope `rendered|both` on rendered text
  (`coverage.nevershow`).
- **Regex dialect**: /frontend evaluates `regex: true` patterns as JavaScript, /execution as Python `re`. To keep one
  meaning, `nevershow.load` rejects (E_SCHEMA, entry id named, never its pattern) a regex entry that uses a construct
  the two engines read differently: `(?P`, `(?<name>`, `(?i)` or any inline flag group, lookbehind `(?<=` / `(?<!`,
  backreferences (`\1`-`\9`, `\k<`), `\A`, `\Z`, `\z`, possessive or atomic groups, `\p{`; and requires it to compile
  in Python. The accepted subset, agreed with /frontend (Q-F9, 2026-10-01): character classes, quantifiers,
  alternation, non-capturing groups, anchors, `\b \d \w \s`. Case-insensitive matching: both sides fold NFKC then
  lower-case (Python `lower()`, JS `toLowerCase()`, never `casefold()`), and regex entries get the ignore-case flag
  when `case_sensitive` is false.
- Hits are reported by entry id and file:line only, never the matched text (SCHEMAS.md 8).

---

## 9. Wave fragments, inlined by `wave emit`

### 9.1 Loading (`wavejs.load_fragment`)
Reads `F/assets/wave-fragments/<name>.js`, computes its sha256, checks it declares exactly one top-level `async
function feCritique(api, input)` (resp. `feDirections`), and runs the forbidden-token check on the source **with
comments and string literals removed** (both shipped files mention `import`, `Date.now`, `Math.random` and `new Date`
in their header comment, which is not code). A forbidden token in code, a missing function or an unreadable file is
E_DEPENDENCY_MISSING with a `dependency-missing` decision; never a stand-in implementation.

### 9.2 Inlining and input (WAVES.md 6.1-6.2)
The wave emitter inlines each fragment the wave needs, verbatim, at the template's `/*@@FRAGMENTS@@*/` marker,
records `{name, source_path, sha256}` in `manifest.fragments`, and calls it with `api = {agent: <tracked callAgent>,
parallel, pipeline, log}` and the input resolved at emission: `params.fragment.input` as instantiated (2.4 step 9),
`{workdir}` per 3.2, `{"$from": "frontend.critique"}` read at JSON pointer `/frontend/critique` of the profile (absent →
E_DEPENDENCY_MISSING naming the field). `wave launched` refuses a script whose bytes differ from the manifest's
`script_sha256`; a fragment changed after emission does not affect a launched wave (its copy is inlined), and the
next emission records the new sha256.

### 9.3 Agents inside fragments
Every role gets an explicit agent type, model and effort (WAVES.md 6.2): designer and implementer
`execution-implementer` opus/high; runner `execution-implementer` sonnet/low; critic `frontend-critic` and probe
`frontend-probe`, opus/high. FE-20 holds the `browser` resource for the whole task (WAVES.md semaphore `BROWSER`), and
the governor keeps it the only browser task while free RAM is under `ram_floor_gb + 1` GB.

### 9.4 Receipts
`wave ingest` validates the receipt the script copied to the inbox (`<task>.fe-directions.a<n>.json`,
`<task>.fe-critique.a<n>.json`) against /frontend's `directions-receipt.schema.json` / `critique-receipt.schema.json`
(and, for feCritique, recomputes the `fnv1a32` checksum and compares it with `<state>/frontend/critique/receipt.json`).
An invalid receipt is E_RESULT_RECEIPT_MISMATCH and the task is failed for that attempt. The verdict still rests only
on the verifier's proof run of the landed SHA, never on a receipt.

---

## 10. Publishing the review board (orchestrator only)

When FE-04 (H1) or FE-06 (H2) becomes ready:
1. `exec.py manual post --task <FE-04 id>` (status → running, options filled from the folders, push text).
2. The orchestrator, in the main thread, follows `F/references/03-directions.md` section "Publishing the board
   (orchestrator only)" for `review_surface: claude-design` (canvas create, PNG assets, one publish, no read-back,
   the canvas kept private). For `review_surface: board`, the board path printed by board.mjs is the link and the
   task's `where` becomes `laptop`; for `terminal`, the orchestrator shows the board images in the terminal at the
   owner's next prompt. A workflow agent never publishes (undocumented permission behaviour) [FD07-F22].
3. The push (PushNotification, ≤ 200 characters) names the task id and carries the canvas link; the Notion row of the
   task shows the link in its body (`manual post --link <url>`, CLI.md).
4. Answers come only through the Notion `Décision` field of the row or a Remote Control reply; canvas comments are
   not answers. Then 6.4.
The frontend lane waits; every other lane keeps running.

---

## 11. Before T0: pre-T0 runs and their import

Events that forbid designs before kickoff (Origins) allow only research before T0: FE-00 (brief), FE-01 (confirm
reference URLs) and FE-02 (captures and the pattern ledger) — never a token, a logo or a mock [origins F03-F04].
1. **Pre-T0 state**: `exec.py init --pre-t0 --project <slug> --executor A --state <private_dir>/execution-pre`; the
   profile is ingested there (`project.product_repo.path: null`), with `frontend.paths.*` and the never-show path set.
2. **Runs** (never /frontend's mode B: it asks through AskUserQuestion and keeps its state in `<repo>/.frontend`,
   against owner decision /frontend "mode A only" and the agreed answer channels): `exec.py plan instantiate --pre-t0`
   instantiates only the /frontend templates marked `pre_t0` (FE-00, FE-01, FE-02) with `{state}` =
   `<private_dir>/frontend` (/frontend's own Prework rule), into a pre-T0 plan that is never approved. `exec.py wave
   emit --pre-t0` runs FE-00 and FE-02 as /execution template tasks in a pre-T0 wave: chain `[implementer]` (no product
   repo, so no merge and no verifier), agents of type execution-implementer whose writes are only
   `<private_dir>/frontend/**` (the pre-T0 profile's `policy.fences.allow_write_outside` names that directory), the
   brief stating "pre-T0 research: run your proof, record your result; nothing lands and nothing is done before T0".
   `wave ingest` records the results and leaves the tasks `planned` (event `wave.ingested` with `pre_t0: true`). FE-01
   is posted with `manual post` through Notion or Remote Control (the agreed channels), and its verified answer patches
   the pre-T0 profile through `ingest --patch --answer <key>` (6.4). The pre-T0 runs leave no receipt that counts as
   done.
3. **Import at T0**: `exec.py init --project <slug> --executor A --state-remote <url> --import-from
   <private_dir>/execution-pre` copies the knowledge files and `<private_dir>/frontend/` into `.execution/frontend/`
   (captures are not copied: they stay in the private folder until purged), and records the copied files with their
   sha256 in `local/import.json`.
4. **At instantiation** FE-00, FE-01 and FE-02 get `params.imported: true` when, respectively,
   `.execution/frontend/brief.json`, `frontend.references` with at least two `owner_confirmed: true`, and
   `.execution/frontend/{refs-index.json, pattern-ledger.json}` exist; their estimates become verify-sized (p10/p50/p90
   = 2/5/12 min); FE-01 is still posted, with the push `T0xx : références confirmées avant T0, réponds « garder » ou
   corrige` (the owner keeps the decision; the cost is one reply).
5. They then run, merge (state-only) and are verified like any task: the pre-T0 outputs become done only through a
   verifier's proof run after T0.
6. P-16 still holds: FE-00 is kind code, so its T0 instance is released at `prework.until_utc` even though its
   template is `pre_t0` (the pre-T0 run is outside the plan).

---

## 12. When /frontend's files are missing or wrong

| what | detected by | result |
|---|---|---|
| `frontend.json` absent, unreadable, or invalid in either format (2.1 steps 1 and 4) | `plan instantiate`, `amend`, `validate` | E_DEPENDENCY_MISSING, exit 1; planning stops |
| `profile-frontend.schema.json` absent | `ingest` (x-external `on_missing: decision`), `validate` | E_DEPENDENCY_MISSING; profile written only if our schema allows it, no plan |
| `never-show.schema.json` absent | `nevershow.load` (x-external `on_missing: warn`) | W_NEVER_SHOW_SCHEMA_DRIFT; our mirror schema still validates; scanning continues |
| `feature-catalogue.schema.json` absent | `catalogue` | warning; our schema validates |
| `choices.schema.json` absent | `decision resolve` of FE-04/06, FE-21 ingest | E_DEPENDENCY_MISSING; the answer is kept, the `choices.json` write waits for the decision |
| a wave fragment absent, changed into invalid code, or without its function | `wave emit` | E_DEPENDENCY_MISSING, exit 1, nothing written; other tasks of the wave are emitted without it |
| `frontend-check.mjs`, `critique.mjs` or `board.mjs` absent, or `node frontend-check.mjs --help` exit ≠ 0 | `preflight` PF-13, `validate` (P-23), `wave emit` | PF-13 fail ("décision pour le propriétaire"); planning and emission of FE tasks refused |
| `frontend-critic` / `frontend-probe` agent missing | `agents status` (`frontend_agents`), PF-13, `wave emit` for FE-20 | refused; /frontend's own installer is the fix (`node F/scripts/install-agents.mjs`), run by the owner |
| a gate the plan requests no longer exists in frontend-check | the proof (frontend-check exits 2 on an unknown gate) | proof failure (exit ≠ 0), never a pass; the verifier's finding names the gate |
| a referenced `brief_refs` file missing | `validate` P-21 (warning), `wave emit` (E_BRIEF_REF_MISSING) | the task is not emitted |

Every E_DEPENDENCY_MISSING opens one `dependency-missing` decision (deduplicated by file) with the options:
`wait` (« J'attends que /frontend soit réparé ; le reste du plan continue »), `cut-ui` (« Couper les exigences UI
concernées » — becomes a `cut` proposal, owner-only), recommended `wait`. There is no option that builds a UI another
way. The rest of the plan keeps running (decision 2).

---

## 13. Contract questions raised by this file

For /execution's core: all settled in revision 2 (README.md 10) — Q-F1 the adapter, Q-F2 serial sections, Q-F4 plant
files applied to copies by `proof run --negative-control`, Q-F5 state-only merges, Q-F7 `frontend_choice`, Q-F8
`ingest --patch --answer`, Q-F10 `manual post --link`, Q-F13 `S/frontend/choices.json` orchestrator-writable.

For the /frontend session, all answered on 2026-10-01:
- **Q-F14** when `--out` is given, frontend-check will write ONLY there and leave `<state>` untouched (lands when
  /frontend's build resumes; until then /execution keeps `frontend/gates/` machine-local and git-ignored).
- **Q-F15** /frontend's fragment prompts will not dictate commit messages ("commit under your own commit rules"), so
  the conventional-commit check of `merge` applies.
- **Q-F3** confirmed: /execution narrows FE-08/FE-20 writes, and the UI package manifest and install belong to its
  contract wave.
- **Q-F9** folding is NFKC then lower-case on both sides (Python `lower()`, JS `toLowerCase()`, never `casefold()`);
  regex entries get the ignore-case flag when `case_sensitive` is false; the regex subset is section 8's.
- **Q-F11** /frontend adds `canvas_url`, `type_release` and `published_at` to `choices.schema.json`; until that lands
  /execution writes only the schema's current fields (6.4).
- **Q-F12** kept as a manual task, bridged by `ingest --patch --answer` (Q-F8).
- **Q-F1** /execution adapts /frontend's own template format (2.1); /frontend announces every change to the shape of
  frontend.json, and B02's pinned copy is refreshed then.

Coordination after 2026-10-01 13:00: /frontend runs on a second Claude account, and cross-session messages do not
cross accounts. /frontend records shape changes in `~/.claude/skills/frontend/CHANGELOG.md` and its state in
`HANDOFF.md`; /execution records its side in this section; the owner relays. Read on 2026-10-01: HANDOFF.md section 3
matches this file; from CHANGELOG v1 and v1.1, FE-09 (brand files, after FE-06 and FE-08), the symbolic dependencies
`decision:project-name` and `manual:harden-review` (2.1) and the `file` proofs of FE-01/04/06/21 (3.3, 6.4) were
already covered; the new `--phase small` (render, a11y, coverage, firstview, tells, ip) is absorbed: `FRONTEND.build`
and H14 pass `--phase small` in small mode and `--phase build` in full mode (section 6).

2026-10-02, revision 4 (owner effort policy: subagents never above `high`): /frontend's template schema still allows
`xhigh` as a task effort. The adapter (2.1) clamps any template or agent-role effort above `high` to `high` and emits
W_EFFORT_CAPPED naming the template id; /execution's plan schema refuses `xhigh` and `max`. For the /frontend session
(relayed by the owner): cap your templates' efforts at `high` so the warning never fires.

## 14. Tests
B02 `test_templates.py` against the **real** frontend.json when present (skipped with a printed reason otherwise), plus
a pinned copy of it in /frontend's own format (`fixtures/B02/frontend-real-<sha8>.json`, its sha256 in the file name)
that always runs through the adapter, and the contract-format sample for edge cases: specialisation for each mode ×
references × stack; references on → FE-03 after
FE-02, off → after FE-00 and FE-01/FE-02 absent; FE-07 after FE-06; `@project-name` only when unconfirmed; FE-1x per
group with `{features}` without spaces, single in small mode after FE-09; serial chaining for static-html;
`@feature-tasks` by covers intersection and E_TEMPLATE_DEP on zero; `{workdir}` survives instantiation; runner and
designer get `execution-implementer`; writes mapped and narrowed; `manual:harden-review` maps to `@harden-review` and
`@fix-gate`; FE-04/FE-06/FE-21/FE-01 file proofs with `json_checks` (a pick naming no folder fails, a non-UTC
`answered_at` fails, a confirmed entry without an http(s) url fails); the instantiated plan passes `validate`;
byte-identical output; absent library → E_DEPENDENCY_MISSING plus decision; a document in neither format →
E_DEPENDENCY_MISSING (never a silent translation). B05 `test_wavejs.py`: the shipped
fragments pass the comment-stripped token check, and a fragment with `Date.now()` in code fails it. B06
`test_proof.py`: each plant op on a copy, the real state untouched (sha256 before and after), a missing target exits
3. B07 `test_completion.py`: `FRONTEND.build` fails when the fake checker skips a gate.
