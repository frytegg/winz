# FIX-MODE.md — `/execution --fix <harden report>`

Companion of ARCHITECTURE.md section 18 (owner decision Q4: fix mode in v1), CLI.md `fix`, `amend`, `decision
propose|resolve`, and MODULES.md `fixmode.py`. It specifies the report grammar CLI.md delegates here, the owner's
selection, the fix tasks with their proofs, the regression gate and the hand-over to the deliverable sub-plan. It
refines the core and never contradicts it; section 11 lists the contract questions it raises. Owners: B07
(`fixmode.py`), B02 (templates `EX-FIX-SELECT`, `EX-FIX-CODE`, `EX-FIX-REVERT`, `EX-FIX-GATE`), B10
(references/fix-mode.md).

Sources read for the grammar (2026-10-01): `~/.claude/skills/harden/assets/report-template.md`,
`references/reporting.md` RP-06/RP-07/RP-16/RP-17, `assets/findings.schema.json`. /harden never merges or pushes; it
leaves `harden/<date>` for the owner [skills F08].

---

## 1. Where fix mode sits in the run

```
build complete + harden-ready ── handover (hooks removed, run HANDED_OVER)
      │ owner types /harden, reviews the report, merges harden/<date> into main and pushes (manual)
      ▼
EX-HARDEN-REVIEW (manual, done when the merge SHA is on origin/main)
      ▼
/execution --fix <repo>/.harden/report.md          (run FIX)
      ▼
EX-FIX-SELECT (decision, kind fix-selection) ── none ──► EX-FIX-GATE (placeholder) ─► FE-21, deliverables
      │ some
      ▼
amend: fix tasks + replay + convergence + new EX-FIX-GATE, the not-started deliverable tail re-added after it
      ▼
waves (RUNNING) ─► new EX-FIX-GATE (regression) ─► FE-21 (H3) ─► recording ─► … ─► README screenshots last
```

From the start, every plan with a hackathon or deliverable sub-plan holds four execution-library tasks (B02):
`EX-HARDEN-PARK` (manual), `EX-HARDEN-REVIEW` (manual, depends on the build-complete gate), `EX-FIX-SELECT`
(decision, `decision_kind: fix-selection`, depends on EX-HARDEN-REVIEW) and `EX-FIX-GATE` (gate, phase fix, depends on
EX-FIX-SELECT; the **placeholder** regression gate). FE-21 and every deliverable task depend on EX-FIX-GATE
(`@fix-gate`, SCHEMAS.md 6.2) in addition to `@harden-review`, and P-17 enforces it. With no fix selected the
placeholder runs and nothing is amended.

---

## 2. Entering fix mode

The owner types `/execution --fix <path>` (references/fix-mode.md). The orchestrator:
1. Starts like a resumed run: launcher, `hooks install`, then, before ending that turn, the heartbeat (`heartbeat
   plan`, CronCreate, `heartbeat record`) and a background Bash `sleep 5` (its completion is the next turn: the owner
   may have walked away after typing the command); next turn `hooks canary`. run_state HANDED_OVER → FIX
   (`state.RUN_TRANSITIONS`).
2. Ingests the review: `exec.py answers ingest --task <EX-HARDEN-REVIEW id> --key <id>-merge --text-file <file with
   the merge SHA> --source terminal --by devA` (bring-back `{kind: sha, verify: sha-on-origin-main}`); the owner gives
   the SHA in his message or the orchestrator reads it from `git log -1 --format=%H origin/main` and shows it for
   confirmation. EX-HARDEN-REVIEW done.
3. Parses: `exec.py fix --report <path> --list` (section 3), shows the French summary (5.1), and posts EX-FIX-SELECT
   (`manual post`, which opens the linked proposal of the template's `decision_kind`, here `fix-selection`).
4. Waits for the owner (Notion `Décision` field or a Remote Control reply), resolves the decision, then runs `fix
   --select` (section 6) or, for `none`, nothing more: EX-FIX-SELECT done makes the placeholder EX-FIX-GATE ready.

Preconditions of `fix` (exit 4 with the reason, nothing written): the plan is approved; `.harden/active` absent
(/harden finished); the report's head SHA (header line, 3.2) is an ancestor of `origin/main` after `git fetch`
(E_NOT_ON_MAIN: "merge the harden branch first"); EX-HARDEN-REVIEW is done.

---

## 3. Parsing the report (`fixmode.parse_report`)

### 3.1 Input
- `--report PATH`: the Markdown report, normally `<repo>/.harden/report.md` (untracked; /harden excludes `.harden/`
  through `.git/info/exclude`).
- Its sibling `findings.json` in the same directory, when present, is **authoritative** for each finding's fields
  (file, line, severity, tier, class, status, commit, review, evidence, notes); the Markdown gives grouping, order and
  owner-facing text. Absent → W_FINDINGS_ABSENT and the Markdown is used alone (items keep `source: report-only`).
- Decoding: UTF-8 (a BOM stripped with W_BOM), `\r\n` normalised to `\n`. HTML comments `<!-- … -->`, including
  multi-line ones, are removed before parsing (the template's guidance lives in comments).

### 3.2 Document structure (E_REPORT_FORMAT with the line number when violated; never guessed)
- Line 1 matches `^# Hardening report: (?P<project>.+)$`.
- A header line matches ``^Commit range `(?P<base>[0-9a-f]{7,64})\.\.(?P<head>[0-9a-f]{7,64})` on branch
  `(?P<branch>[^`]+)` · run (?P<run_utc>\S+) \((?P<runtime>[^)]*)\) · mode (?P<mode>\S+) · phase (?P<phase>.+)$``.
  `phase` must be the final one (contains `8`): a Phase 5 report ("report first") has no commits yet and is refused
  (E_REPORT_FORMAT "phase 5 report: wait for the final report").
- H2 headings (`^## (.+)$`), exact text. Required, in this relative order: `Summary`, `Applied, review before merge`,
  `Needs your decision`, `Applied`, `Not fixed or deferred`, `Open owner items`. Others (`Scope, baseline and
  method`, `Informational and nits`, `Autonomous decisions`, `Reverted by end-to-end verification`,
  `Before/after`, `Limits`, `Residual risk`, `Appendix`) are allowed and ignored. A duplicate required heading is an
  error.
- A section body that is exactly `None.` (after trimming, comments removed) has no items.
- A Markdown table is: a header row, a separator row `^\|(\s*:?-{3,}:?\s*\|)+$`, then rows until a line that does not
  start with `|`. Cells are split on `|` not preceded by a backslash and trimmed; a row with a different cell count than
  its header is an error.

### 3.3 Section "Applied, review before merge"
Table header exactly: `| # | Commit | Subject | Finding | Review kinds | Behaviour change (old -> new) | Option;
alternatives | Demonstrating test or proof | Undo |`. Per row:
- `Commit`: `` `<sha 7-64 hex>` ``; `Undo`: `` `git revert <same sha>` `` (a mismatch is an error).
- `Finding`: one finding id (`^[A-Za-z0-9][A-Za-z0-9._-]*$`), optionally followed by ` (partial)` or ` (reverted)`.
- `Review kinds`: comma-separated subset of `breaking-api, additive-api, contract-source, money-path,
  owner-judgement, behavioural, whole-repo-format`.
- `Option; alternatives`: `<option>; <alternatives text>` where option ∈ `direct, lossless-variant, record-only,
  documented-default`.
- Item id: `REV:<finding>`; a second row for the same finding is `REV:<finding>#2`, and so on.
The line `Contract sources changed on this branch: <list>.` after the table is parsed into
`contracts_changed` (`None.` → empty).

### 3.4 Section "Needs your decision"
Three H3 subsections, each optional, exact headings:
- `### Awaiting your approval (T1 batches)`: a table with header `| Batch | Findings | Severity (c/h/m/l/nit) |
  Highest fix risk | Class | Example | Your decision |` (item `BATCH:<slug of Batch>`, slug = lowercase, runs of
  non-alphanumerics → `-`), then finding entries (item `T1:<finding>`).
- `### Report-only (T2: owner judgement)`: finding entries (item `T2:<finding>`).
- `### Questions (suspected, not proven)`: finding entries with ` (unproven)` after the severity (item `Q:<finding>`).
Finding entry: a line `^\*\*(?P<id>[A-Za-z0-9][A-Za-z0-9._-]*)\*\* · (?P<severity>critical|high|medium|low|nit)(?:
\(unproven\))? · (?P<title>.+)$` followed by bullet lines `^- \*\*(?P<label>[^*]+?):\*\* (?P<value>.*)$` up to the next
blank line or entry. Labels used: `Where`, `Severity`, `Confidence`, `Evidence`, `Rule`, `Proposed change`, `Why
report-only`, `Owner action`, `Proposed first step (for the owner; not applied by this pass)`, `Evidence so far`,
`What would confirm or refute it`, `Question for you`. Several labels may share one bullet separated by ` · **` (the
Questions entries do): the splitter cuts on ` · **<Label>:** `. `Where` must start with `` `<file>:<line>` ``
(file repository-relative, line ≥ 1); an entry without it is an error. Unknown labels are kept in `extra` with
W_REPORT_LABEL.

### 3.5 Section "Open owner items"
Table header exactly `| Kind | Value or decision | Where to change it | Finding ids |`. `Kind` ∈ `partial finding,
owner-tunable value, kept implicit-input fallback, release decision (kind 2 fix, external consumers), newly rejected
input class, other owner decision`. `Finding ids`: ids separated by commas or spaces (at least one). For `partial
finding`, the value cell is parsed with ``re-run `(?P<cmd>[^`]+)`: exit (?P<exit>-?\d+)`` (the still-reproducing
command). Item id: `OWN:<n>`, n = 1-based row index.

### 3.6 Section "Not fixed or deferred" (context, not selectable)
Table header `| Id | Severity | Status | Reason | Evidence of the attempt |`, Status ∈ `blocked, reverted, deferred,
partial`. Parsed into `context` so the summary can show them; not selectable in v1 (contract question Q-X3).

### 3.7 Cross-check with findings.json
When findings.json exists: it parses as JSON with `version: 1`, `base_sha` equal (prefix) to the header's base, and a
`findings` array; every finding id parsed from the Markdown exists there (else E_REPORT_FORMAT "unknown finding id
<id>"); the item takes `file`, `line`, `severity`, `tier`, `class`, `status`, `commit`, `review`, `evidence`,
`notes`, `blocking`, `unblock_condition` from it. A disagreement between the Markdown and the JSON on file:line or
severity is W_REPORT_MISMATCH and the JSON wins. Statuses: REV items must be `applied` or `partial`; T1/T2 items
`verified`, `reported`, `approved` or `deferred`; Q items `deferred`; anything else is W_REPORT_MISMATCH.

### 3.8 Output (`fix --list` data, also written to `local/fix/<report sha8>.items.json`)
```json
{"report": {"path": "...", "sha256": "...", "project": "...", "base": "...", "head": "...", "branch": "harden/2026-10-07", "mode": "auto", "findings_json": true},
 "items": [{"id": "T2:H-007", "section": "needs-decision", "kind": "t2", "finding_ids": ["H-007"], "title": "...", "file": "src/escrow/settle.ts", "line": 88,
            "severity": "high", "tier": "T2", "class": "behavioural", "blocking": true, "proposed_change": "...", "owner_action": "...",
            "evidence": [{"kind": "repro", "ref": "...", "detail": "..."}], "commit": null, "review": null, "actions": ["fix"], "recommended": true}],
 "context": [{"id": "H-011", "status": "reverted", "reason": "..."}],
 "contracts_changed": [], "warnings": [...]}
```
`actions` per kind: REV → `["revert", "alt"]` (no default: the owner must say which); T1, T2, BATCH, Q → `["fix"]`;
OWN → `["set", "keep"]`, and `partial finding` OWN → `["finish"]`. `recommended` = blocking, or severity critical or
high, or a `partial finding` OWN item. Items are ordered as in the report (RP-06 order).

---

## 4. The fix-selection decision

`fix --list` also writes `local/fix/<report sha8>.options.json`, the options the orchestrator passes to `decision
propose --kind fix-selection --task <EX-FIX-SELECT id> --title "Correctifs après /harden" --options-file <it>
--recommended recommended --deadline-utc <EX-FIX-SELECT decision_deadline_utc>`:
| option id | label (French) | consequence |
|---|---|---|
| `none` | Aucun correctif | Le contrôle de non-régression tourne, puis les livrables (H3 d'abord). Tous les éléments sont consignés comme non retenus. |
| `blocking` | Corriger les éléments bloquants | Exactly the ids listed (blocking items only), then the regression gate. |
| `recommended` | Corriger la sélection recommandée | The ids with `recommended: true` (REV items excluded: they need an explicit action). |
| `custom` | Ma sélection | The owner writes the ids and actions in « Réponse » / the reply, grammar 4.1. |
Each option's `consequence` lists its ids explicitly, so the resolution's quote plus the option fully determine the
selection. The proposal prose (French) is the summary of 5.1. The decision is owner-only (`--by devA`).

### 4.1 Selection grammar (the `custom` quote and `fix --select`)
`<item>[=<action>[:<value>]]` separated by commas or new lines, case-sensitive ids, e.g.
`T2:H-007, BATCH:error-handling, REV:H-003=revert, REV:H-009=alt:keep the old error string, OWN:2=set:30s, OWN:4=keep`.
- `fix`, `finish` and `revert` take no value; `alt` takes the alternative to implement (one of the review row's
  alternatives, quoted or paraphrased; free text); `set` takes the value; `keep` records the current value.
- A value cannot contain a comma or a new line; longer values go through `--select-file PATH` (a JSON list of
  `{id, action, value}`, CLI.md `fix`).
- Unknown id, an action not in the item's `actions`, or a REV item without an action: exit 2 (E_USAGE) naming it.

---

## 5. What the owner sees

### 5.1 Summary (French, rendered by `fixmode` into the proposal prose and the push)
```
Rapport /harden <branch> fusionné (<head8>). <n> éléments à trancher :
- À revoir (déjà appliqués) : <k> — REV:H-003 (cassant, API) …
- Bloquants : <ids>
- T1 en attente : <batches with counts>
- T2 (ton jugement) : <ids with severity>
- Questions non prouvées : <ids>
- Réglages pour toi : OWN:1 … (<kind en français>)
Recommandé : <ids>. Non sélectionnables : <n> (non corrigés ou reportés, voir le rapport).
Réponds : « none », « blocking », « recommended », ou ta liste (ex. T2:H-007, REV:H-003=revert).
```
Push (≤ 200 chars): `T0xx : /harden fusionné, <n> correctifs possibles (<b> bloquants). Choisis : none / blocking /
recommended / ta liste.`

### 5.2 Items not selected
`fix --select` records every parsed item that is not selected, with the owner's reason (`--reason-unselected-file`,
else the decision's quote): in the `fix.selected` event (`{decision, selected: [{id, action, value}], unselected:
[{id, reason}], report_sha256}`) and in a decisions.md block of record `note` (decision.schema.json: same id as the
fix-selection decision, `reason` and `items`; not a proposal). They appear in the next French report under "Ouvert" as
`non retenu`.

---

## 6. From selection to fix tasks (`fix --select ... --decision D`)

### 6.1 Procedure
1. Checks: D is resolved, kind `fix-selection`, by devA; the selection equals the chosen option's id list, or, for
   `custom`, every selected `<item>[=action]` appears in the resolution's quote (whitespace-insensitive); the report's
   sha256 equals the one in `local/fix/<sha8>.items.json` (the report did not change since `--list`).
2. Expands `BATCH:<slug>` into its `T1:<finding>` items (dropping duplicates).
3. Builds the amend patch (6.2-6.6) and calls `amend.cas_amend(ctx, D, patch)` (fetch, apply, validate, commit,
   push, retry ≤ 3; CLI.md `amend`).
4. run_state stays FIX until the first fix wave launches (→ RUNNING, reason `fix wave`).
`fix --select none` (option `none`): no patch, no amendment; EX-FIX-SELECT is completed by the resolution and the
placeholder EX-FIX-GATE becomes ready.

### 6.2 One task per selected item
Common fields: `phase: "fix"`, `owner: "agent"`, `executor` = the executor of the lane that contains every write (no
such lane, or two lanes: the item becomes a `spec-gap` decision "la correction de H-007 touche deux couloirs", not a
task), `depends_on: [<EX-FIX-SELECT id>]`, `max_attempts: 2`, `priority`: critical/high → P1, medium → P2, low/nit →
P3; `required: true`; `covers`: the requirement ids of the plan tasks whose `writes` intersect the finding's file,
else the NFR `execution:standard` key `harden-findings-fixed` (added once, NFR-9xx); `brief_refs`: the harden report
path, `<state>/fix/<item slug>.md` (the item's text and evidence, written by `fix`; a new state path, contract
question Q-X9), and `~/.claude/skills/harden/references/reporting.md`.

| item and action | template | kind | writes | proof (`proof_author: template`) | negative control |
|---|---|---|---|---|---|
| T1, T2, BATCH members, `=fix` | `execution:EX-FIX-CODE` | code | the finding's `file` (and `end_line` range's file), plus the fix test path (6.3) | command: the fix test (6.3), `expect.exit_code: 0` | `pre-implementation`: the proof at the test-designer's commit (the fix not yet applied) must fail; recorded by the test-designer step |
| Q `=fix` | `EX-FIX-CODE` with `params.unproven: true` | code | as above | as above | as above; if the test-designer cannot make the test fail (the suspicion does not reproduce), it returns `confirmed: false` in its notes and the task goes `blocked-decision` with options `drop` (« Abandonner : non reproduit ») and `investigate` |
| OWN `partial finding` `=finish` | `EX-FIX-CODE` | code | the `Where to change it` file(s) + fix test | command: the fix test, and the row's re-run command with `expect.exit_code: 0` (chained with `&&`) | `pre-implementation` (the re-run command fails today: it is the row's evidence) |
| OWN `=set:<value>` | `EX-FIX-CODE` with `params.value` | code | the `Where to change it` file(s) + fix test | command: the fix test, which asserts the new value | `pre-implementation` |
| OWN `=keep` | none | — | — | — | recorded only (5.2) |
| REV `=revert` | `execution:EX-FIX-REVERT` | code | the files of the commit (`git show --name-only --format= <sha>` at `fix` time) | command (bash): `git log --format=%B -n 200 \| grep -qF "This reverts commit <full sha>."` | `pre-implementation`: on the merge receipt's `origin_before` the line is absent, grep fails |
| REV `=alt:<text>` | `EX-FIX-CODE` with `params.alternative` | code | the commit's files + fix test | command: the fix test asserting the alternative behaviour | `pre-implementation` |

EX-FIX-REVERT's description tells the implementer, in its lane worktree, to run `git revert --no-commit <sha>` (never
a reset), resolve no conflict by hand (a conflict is `blocked: decision`), write a message file whose first line is
`revert: <subject> (<finding id>)` and whose body holds the line `This reverts commit <full sha>.` (what the proof
greps), and commit with `git commit -F <file>`: one conventional commit, never git's default `Revert "..."` message,
which merge's conventional scan refuses. A `breaking-api` or `contract-source` REV item gets, in its task description, the
review row's behaviour-change line, and a contract source change also adds the sentence "the deployed contract keeps
the old behaviour until the owner redeploys" to the French report.

Estimates: EX-FIX-CODE reference class build (6.2/26.7/46.0 min), EX-FIX-REVERT p10/p50/p90 = 3/8/20 min; model opus,
effort high for blocking or critical items, medium otherwise; verify opus high.

### 6.3 The fix test
- Written by the test-designer step of the task's chain (`["test-designer", "implementer", "verifier"]`) in the
  shared checkout and recorded with `exec.py snapshot` (a commit object on origin/main at `refs/exec/<task>/td-a<n>r<k>`,
  no branch moved; CLI.md), from the finding's evidence (`repro` command, `test` id, `source` trace) and `Proposed
  change` / `What would confirm or refute it`. It must fail on the snapshot (the recorded negative control). The
  implementer starts from it (worktrees: `git checkout <snapshot> -- <test path>`, committed first in its lane).
- Path and command, derived from the plan's `gates.json` test gate (the gate named `test`, else the one with a
  `count_regex`); `<slug>` = the finding id lowercased with every non-alphanumeric run replaced by `_`; `<dir>` = the
  finding file's directory:

| test runner in the gate command | test path | proof `cmd` |
|---|---|---|
| `vitest` | `<dir>/__fix__/<slug>.test.ts` (`.test.js` when the repo has no tsconfig) | `pnpm exec vitest run <path>` |
| `jest` | `<dir>/__fix__/<slug>.test.ts` | `pnpm exec jest <path>` |
| `node --test` | `<dir>/__fix__/<slug>.test.mjs` | `node --test <path>` |
| `pytest` | `<dir>/test_fix_<slug>.py` | `python -m pytest -q <path>` |
| `unittest` | `<dir>/test_fix_<slug>.py` | `python -m unittest <path>` (run from the repo root) |
| `go test` | `<dir>/fix_<slug>_test.go` | `go test ./<dir> -run TestFix_<slug> -count=1` |
| `cargo test` | `<crate root>/tests/fix_<slug>.rs` (crate root = nearest folder above with Cargo.toml) | `cargo test --test fix_<slug>` (cwd = crate root) |
| anything else (forge, aiken, a custom script) | — | the item becomes a `spec-gap` decision « Où placer le test de non-régression de H-007 ? », never a guess |

- `install: true` when the gate config has an install step. `timeout_s` 600.
- Tamper check (verifier brief): the test file's blob at the landed SHA (`git rev-parse <landed>:<path>`) must equal
  the blob recorded by the test-designer's snapshot (its result's `commit` and `file_blobs`), else the verdict is fail
  with finding "fix test changed after the test-designer". New test lines count only once seen failing [par F47]: the
  recorded negative control is that observation.
- These tests are new files next to the code, so they are not in `plan.protected` and P-20 holds (the implementer's
  writes include the path); the tamper check replaces the protection. Every fix test is also replayed at HEAD by the
  replay task (6.5), so a later fix that breaks an earlier one is caught.

### 6.4 Writes, lanes and overlap
The fix tasks are validated like any amendment (P-08 lane containment, P-09 overlap between tasks not joined by a
path). Two selected items touching the same file get a dependency in report order (the later depends on the earlier),
added by `fix` before validation, so they never run concurrently.

### 6.5 The regression gate and the deliverable tail
The patch also contains, after the fix tasks:
1. `EX-REPLAY` (new instance, gate, verify phase): depends on every fix task; its verifier agents replay every done
   task's proof on HEAD of a fresh clone with `--by replay` (H13 needs proof runs of the **new** HEAD).
2. `EX-CONVERGE` (new instance): depends on every fix task; a convergence pass for the new HEAD (the completion gate
   `CONVERGENCE` requires a result for HEAD).
3. `EX-FIX-GATE` (new instance, gate, phase fix, executor A): depends on 1 and 2. Proof (`command`, cwd `.`,
   `install: true` so the `FRONTEND.build` gate can build in the clean clone): `node "<state_dir>/completion-check.mjs"
   --json --phase build,harden` with `expect.exit_code: 0` (both phases: the `FIX.<task>` and `HARDEN.report` gates are
   phase harden, and a regression gate that skipped them would let the deliverables start on unfinished fixes), run
   by a verifier like every gate task. Before emitting the wave that holds it, the orchestrator runs `exec.py
   harden-ready` on the current origin/main HEAD (automatically the `--after-harden` profile: H8 not run, H9 against
   the remaining deliverables' P80, so a fix cycle near the deadline can still pass; CLI.md, HANDOVER.md 1.4) and
   `exec.py completion generate` (the `FIX.<task>` gates list the new fix tasks). Negative control (`forgery`): the
   same command against a forged copy of the state where one fix task's receipt has `verdict: fail` must exit 1.
4. **Supersede and re-add the tail**: the placeholder EX-FIX-GATE and every task that has it as an ancestor and is
   `planned` or `ready` (FE-21 and the deliverable sub-plan: deck lock, recording, /prose, slides, Drive, form, flip,
   tag, README screenshots) are superseded, and re-added as new instances (same templates, same parameters, new ids above
   the maximum) whose dependencies are remapped: a dependency on a superseded task points to its new instance, a
   dependency on the placeholder EX-FIX-GATE points to the new EX-FIX-GATE. Deliverable tasks already running or done
   are left alone (a task is never moved backwards). This is the only legal shape: dependencies may point only to
   lower ids (P-02), and the fix tasks are new. P-17 holds on the new instances (the build gate and EX-HARDEN-REVIEW
   stay ancestors; README screenshots stay last).
5. The completion check is regenerated after the amendment (`completion generate`, A only).

### 6.6 Patch shape
```json
{"add_requirements": [{"id": "NFR-9xx", "title": "harden findings selected by the owner are fixed", "...": "..."}],
 "add_tasks": [{"key": "fix/T2-H-007", "template": "execution:EX-FIX-CODE", "params": {"item": "T2:H-007", "finding": "H-007", "test_path": "src/escrow/__fix__/h_007.test.ts", "unproven": false}, "...": "plan-draft task fields"},
               {"key": "fix/replay", "template": "execution:EX-REPLAY", "...": "..."},
               {"key": "fix/converge", "template": "execution:EX-CONVERGE", "...": "..."},
               {"key": "fix/gate", "template": "execution:EX-FIX-GATE", "...": "..."},
               {"key": "tail/frontend-FE-21", "template": "frontend:FE-21", "...": "re-instantiated"}],
 "supersede": ["T041", "T042", "T043"],
 "change": [], "reassign": [], "gates_json": null, "proofs": []}
```
Deterministic: the same report, selection and plan give the same patch bytes (keys sorted, items in report order).

---

## 7. Running the fix tasks

- They run as ordinary waves (`schedule`, `wave emit`, …) under every rule: merge scans and gates, independent
  verifiers, max 2 attempts then a `retry-exhausted` decision, quota and governor.
- The wave manifest chain for EX-FIX-CODE is `["test-designer", "implementer", "verifier"]`; for EX-FIX-REVERT
  `["implementer", "verifier"]`.
- The French wave report lists the fix tasks under their finding ids (`T051 · H-007 corrigé · preuve …`).
- /harden is not run again by /execution (never invoked); the owner may run it again on the new HEAD himself; a second
  report starts a second fix cycle on the re-added tail (the new EX-FIX-SELECT is part of the re-added tail only when
  the owner asks for a second cycle, through an amendment).

## 8. Hand-over to the deliverable sub-plan

When the new EX-FIX-GATE is done, the re-added FE-21 (H3) becomes ready and is posted first; the recording tasks
depend on it, then EX-DLV-PROSE (the owner types /prose), the README screenshots come last, and the push freeze and
tag follow (ARCHITECTURE.md 13). run_state is RUNNING throughout. When every deliverable task is terminal and
`exec.py completion run --phase all` exits 0, the orchestrator runs `exec.py handover --final` (CLI.md: the final
French report, `hooks uninstall`, RUNNING → HANDED_OVER with reason `deliverables complete`).

---

## 9. Exit codes and events of `fix`
- `--list`: exit 0 parsed (warnings allowed); 1 E_REPORT_FORMAT (data holds every error with its line); 4 the
  preconditions of section 2. Writes only `local/fix/*`. Event `fix.parsed {report_sha256, items, warnings}`.
- `--select`: exit 0 amended; 1 the amendment is invalid (P-xx codes) or E_CAS_REJECTED; 2 selection grammar; 4 no
  resolved fix-selection decision, a quote mismatch, or a changed report. Events `fix.selected`, `plan.amended`,
  `run.state`.

## 10. Tests (B07 `test_fixmode.py`, fixtures under `scripts/tests/fixtures/B07/`)
- A sample final report rendered from /harden's template with one item of every kind (REV with two rows for one
  finding, a T1 batch of two, T2, Q, three OWN kinds including a partial), a matching findings.json, and comments
  left in: parses into the exact item list.
- Each structure error alone (missing required H2, wrong table header, entry without `Where`, Undo SHA mismatch,
  phase 5 header, id absent from findings.json) → E_REPORT_FORMAT with its line.
- A Markdown/JSON disagreement → W_REPORT_MISMATCH and the JSON value.
- Selection: each option; a custom quote that omits an id → exit 4; REV without action → exit 2; BATCH expansion.
- The patch: one EX-FIX-CODE per item with the test path of each runner row, EX-FIX-REVERT proof text, two items on
  one file chained, replay + converge + new gate (its proof `--phase build,harden` with `install: true`), the tail
  superseded and re-added with remapped dependencies, the amended plan passes `validate` (P-02, P-17, P-18),
  byte-identical patch for identical inputs.
- EX-FIX-REVERT end to end in a temp repo: the landed commit's first line is `revert: ...`, its body carries `This
  reverts commit <full sha>.`, merge's conventional scan passes (positive control: git's default `Revert "..."`
  message is refused with E_NOT_CONVENTIONAL).
- A fix cycle whose `harden_end_latest_utc` is already past still lets EX-FIX-GATE pass (`harden-ready
  --after-harden`).
- `none` → no amendment and the placeholder gate becomes ready.
- `test_e2e_fix.py` (B11): the sample report → selection → fix tasks done with canned agents → regression gate →
  FE-21 posted.

## 11. Contract questions raised by this file
Settled in revision 2 (README.md 10): Q-X1 `@fix-gate` and the adapter mapping; Q-X2 the template field
`decision_kind`; Q-X3 "Not fixed or deferred" items stay context-only in v1; Q-X4 `--select-file`; Q-X5 the `note`
record; Q-X6 `handover --final` (RUNNING → HANDED_OVER, reason `deliverables complete`); Q-X7 the warning codes; Q-X8
fix tasks follow their lane's executor; Q-X9 the `fix/` and `local/fix/` paths (SCHEMAS.md 1.1).
