# HANDOVER.md — the harden-ready gate, the /harden profile draft, the hand-over message

Companion of ARCHITECTURE.md 1.2 (exit contract), CLI.md `harden-ready` and `handover`, MODULES.md `hardenready.py`,
`handover.py` and `hardenbridge.py`, and SCHEMAS.md 2 (P-18: the build gate needs an ok harden-ready report for
HEAD). It gives the exact commands and flags, read from /harden's scripts on 2026-10-01 (`gates.py`, `prescan.py`,
`inventory.py`, `infer_profile.py`, `harden_agents.py`, `run_state.py`, `validate_profile.py`,
`assets/profile.schema.json`), and never contradicts the core; section 6 lists the contract questions. Owner: B07
(`hardenready.py`, `handover.py`, `assets/harden-profile.template.json`), B09 (`assets/report-templates/handover.fr.md`),
B10 (references/handover.md).

Standing rules (README.md 8, [skills F02-F12, F17, F37]):
- /execution **never invokes /harden** (it is `disable-model-invocation: true`), never writes `.harden/`, never runs
  `infer_profile.py finalize --install` (`hardenbridge.finalize` asserts the argv), never writes or promotes a /harden
  profile in the repository. The owner types `/harden`.
- Everything below is read-only toward the product repo. Outputs go under a scratch directory outside every git work
  tree and under `.execution/local/harden-ready/`.
- A gates.py `--out-dir` never has a sibling file named `active` (gates.py reads `<out-dir>/../active` as a forbidden
  commands marker) [skills F11]; `hardenbridge.assert_out_dir_safe` checks it before every call.
- The hand-over text is printed by script from receipts and files, never written by the model [skills F17].

---

## 1. The harden-ready gate (`exec.py harden-ready`)

### 1.1 Notation
`H` = `C:/Users/Utilisateur/.claude/skills/harden` (absolute). `PY` = `python` on Windows (`python3` elsewhere).
`R` = the product repo root. `ST` = the state dir. `SC` = `<machine.scratch_root>/<project>/harden-ready-<stamp>`
(`--scratch` overrides; must not exist, must not be inside a git work tree). `HEAD` = `git -C R rev-parse HEAD`.
Each check yields `{id, title, ifDropped, state ok|fail|skipped, detail, phase: "build", evidence}`; `skipped` means
"not measured" and is open (the command exits 1). Every subprocess goes through `procutil.run` with an explicit
timeout; its exit code, a 2,000-character tail and its duration go into `evidence`.

### 1.2 When it runs
Only from the orchestrator (main thread), when no wave is running and no merge holds the merge lock (H2 and H6 measure
the working tree and the remote as they are), after the replay task (`EX-REPLAY`) for the current HEAD is done. The
build-complete gate task (`EX-GATE-BUILD`) and every `EX-FIX-GATE` are emitted only after an ok report for the current
origin/main HEAD exists (FIX-MODE.md 6.5).

Two profiles (CLI.md `harden-ready --after-harden`): **pre-harden** (the hand-over gate, every check below) and
**after-harden** (automatic in run_state FIX or once EX-HARDEN-REVIEW is done): /harden has already run, so H8 is not
run and H9's time check becomes `now + deliverables_p80_min ≤ submission deadline` (`local/schedule.json`
`build_complete.deliverables_p80_min`; the disk check stays). Otherwise the fix wave's regression gate could never
pass near the deadline: after /harden, `now + harden_budget_min` is almost always past `harden_end_latest_utc`. The
report records `profile`; the completion gate `HARDEN.ready` accepts an `after-harden` report only once
EX-HARDEN-REVIEW is done.

### 1.3 Order and dependencies
H1 first; with `R/.harden/active` present the command stops at once with exit 4 (E_POLICY, "a /harden run is
active"), runs nothing else and writes a report whose other checks are `skipped`. Then H2, H3, H7, H8, H10, H12, H13,
H11 (cheap, independent), then H4 → H5 → H6 → H14 → H9 (each needs the one before; when H1 or H2 failed, H4-H6, H14
and H9 are `skipped` with detail `not run: H2 failed (a dirty tree makes the self-setup probe meaningless)`). With
`--only`, the named checks and the ones they need run. Total budget: 45 minutes (`harden_ready.max_min`, profile
override); a check past its own timeout is `fail` with detail `timeout after <n> s`.

### 1.4 The checks

**H1 — HEAD exists, pushed, no run active.**
`git -C R rev-parse --verify HEAD` exits 0; `git -C R fetch origin` then `git -C R rev-parse HEAD` equals
`git -C R rev-parse origin/main`; `R/.harden/active` does not exist. ifDropped: "/harden would start on a commit nobody
else has, or next to a run already in progress."

**H2 — clean tree outside `.harden/`.**
`git -C R status --porcelain=v1 --untracked-files=all` prints no line whose path is outside `.harden/`. Positive
control in the same run: `git -C R check-ignore -q .execution/plan.json` and `git -C R check-ignore -q
.claude/settings.local.json` both exit 0 (the excludes are in place, so a clean status is meaningful). ifDropped: "an
autonomous /harden run would silently fall back to report-only on a dirty tree [skills F02]."

**H3 — no committed focus marker.**
`git -C R grep -nE "(\b(it|test|describe|context|suite)\.only\s*\(|\bf(it|describe|context)\s*\(|\.only\s*\()" --
<test pathspecs>` finds nothing, where the pathspecs are `:(glob)**/*.test.*`, `:(glob)**/*.spec.*`,
`:(glob)**/test/**`, `:(glob)**/tests/**`, `:(glob)**/__tests__/**`, `:(glob)**/__fix__/**`. `git grep` exit 1 (no
match) is ok, exit 0 is fail (the hits are the evidence), any other exit is fail. Skip markers (`\.skip\s*\(`,
`\bx(it|describe)\s*\(`, `@pytest.mark.skip`, `#[ignore]`) are counted into `detail` only. Positive control: the regex
matches the planted line `it.only("x", () => {})` in memory. ifDropped: "a committed .only would make /harden
report-only [skills F04] and hide every other test."

**H7 — no auto-loaded env file in the tree (by name, never opened).**
Walk `R` (skipping `.git`, `node_modules`, `.execution`, `.harden`, `target`, `dist`, `.venv`, `venv`) with
`os.scandir`, never following links, and match **file names** against `^\.env(\..+)?$` and `^\.dev\.vars$`, except
`.env.example`, `.env.sample`, `.env.template` and `.env.*.example`. Any match (tracked, untracked or ignored) is a
fail listing the relative paths only; the fix text names the parking task: `EX-HARDEN-PARK : déplace ces fichiers hors
du dépôt (le profil de l'événement les charge par chemin)`. No file is opened, read, copied or hashed (tested with an
`open()` spy). Positive control: the matcher on the names `.env.local` (hit) and `.env.example` (no hit). ifDropped:
"Next.js or Vitest would load a real env file during /harden's gates, and self-setup would exclude the gate or ban the
command [skills F05]."

**H8 — /harden's agents installed and current.**
`PY H/scripts/harden_agents.py status --json` exits 0. ifDropped: "/harden would fall back to substitute agents and
miss defects [skills F14]."

**H10 — contract and validator sources frozen, or scoped out.**
Sources = tracked files (`git -C R ls-files`) matching `profile.harden.exclude_globs`, `**/*.sol`, `**/*.vy`, and the
globs of `profile.freezes` of kind `validator` or `contract`. None → ok (`no contract or validator source`). Else:
- frozen: the freeze task (`execution:EX-FREEZE-VALIDATOR`) is done with receipt SHA `F`, and `git -C R log --format=%H
  F..HEAD -- <those paths>` prints nothing → ok, `frozen at <F8>`;
- otherwise → ok only if the scope can exclude them: `scope_out` = those globs, and `scope_paths` (2.3) is non-empty
  and contains none of them; detail `not frozen: /harden <paths> excludes <globs>`. An empty remaining scope is fail.
ifDropped: "/harden's lenses would edit validator code they cannot judge (it knows .sol and .vy only, not Aiken)
[skills F09], or change a contract whose deployed bytecode then differs from the source."

**H12 — the CI run of the offline gates is green on HEAD.**
The workflow file comes from the plan's `execution:EX-CI` task (`proof.spec.workflow`); none → `skipped`.
`gh run list --commit <HEAD> --workflow <file> --json conclusion,status,databaseId,headSha --limit 5` (cwd `R`), newest
entry with `headSha == HEAD`: `status == "completed"` and `conclusion == "success"` → ok; in progress → fail with
detail `en cours (run <id>)` (the orchestrator arms a background watcher, then re-runs `harden-ready --only H12`);
none → fail. ifDropped: "/harden's self-setup trusts commands CI runs literally without secrets [skills F05]; a red or
missing run removes that evidence."

**H13 — every proof replayed on a fresh clone of HEAD.**
For every task with status `done` in either status file whose proof type is `command`, `tx`, `ci`, `file` or `url`
(manual, decision and human-attest tasks excluded; the replay task itself excluded), there is a proof run
`ST/local/proof-runs/<task>/<run>/run.json` with `by.role == "replay"`, `sha == HEAD`, `checkout == "clone"`,
`proof_hash` equal to the current plan's, and `expectation.met == true`. Missing runs are listed (fail). The runs are
written by the `EX-REPLAY` task's verifier agents (executor A, so they exist on A's machine for B's tasks too). ifDropped:
"a proof that passed on an older commit would be taken as still passing on the commit handed to /harden."

**H11 — README factual, `.env.example` complete, no TODO in judge-facing files.**
(a) The `execution:EX-README` task has a replay run of HEAD as in H13 (none or not met → fail).
(b) Env names read by tracked source files (not tests, not `.execution/`): the union of the matches of
`process\.env\.([A-Z_][A-Z0-9_]*)`, `process\.env\[["']([A-Z_][A-Z0-9_]*)["']\]`,
`import\.meta\.env\.([A-Z_][A-Z0-9_]*)`, `os\.environ\[["']([A-Z_][A-Z0-9_]*)["']\]`,
`os\.(?:environ\.get|getenv)\(\s*["']([A-Z_][A-Z0-9_]*)["']`, `env::var\("([A-Z_][A-Z0-9_]*)"\)`,
`os\.Getenv\("([A-Z_][A-Z0-9_]*)"\)`, `Deno\.env\.get\("([A-Z_][A-Z0-9_]*)"\)`, minus the platform names `PATH, HOME,
USERPROFILE, APPDATA, LOCALAPPDATA, TEMP, TMP, PWD, SHELL, LANG, TZ, CI, NODE_ENV, GITHUB_ACTIONS`; every remaining
name must be a key of `R/.env.example` (lines `^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=`; reading the template is
allowed). Names read and no `.env.example` → fail; missing names listed (never values).
(c) Judge-facing files (`profile.paths.judge_facing`, default `README.md`, `docs/**/*.md`): no line matching
`(\*\*TODO\*\*|\*\*Still TODO\*\*|^\s*-\s*\*\*TODO|TODO\s*[—-]\s|\bTBD\b)` unless it contains `<!--todo-ok-->` (the
BNB pattern), plus `\bTODO\b|\bFIXME\b|\bXXX\b|lorem ipsum` with the same exemption. Positive control: a planted line
`**TODO** x` is caught in memory.
ifDropped: "/harden's docs lens would turn an aspirational README, a missing env name or a TODO a judge reads into
findings [skills F10]."

**H4 — /harden's self-setup, as a dry run outside the repo.**
```
PY H/scripts/prescan.py --repo R --out SC/prescan.json --json
PY H/scripts/inventory.py --repo R --out SC/inventory.json --quiet
PY H/scripts/infer_profile.py infer --repo R --base HEAD --inventory SC/inventory.json --out-dir SC/infer --now <now utc> --json
PY H/scripts/infer_profile.py probe --repo R --out-dir SC/infer --json
PY H/scripts/infer_profile.py finalize --repo R --base HEAD --out-dir SC/infer --json
```
(never `--install`; `infer` itself refuses while `.harden/active` exists). Pass iff every command exits 0 and the
finalized `SC/infer/profile.inferred.json` has `mode == "auto"`, `live_side_effects == "none"`, and at least one gate
with a non-empty `count_regex` and no `ratchet: true` (the test gate, /harden's own rule); and `git -C R status
--porcelain=v1 --untracked-files=all` is unchanged after the probe (the probe runs project code in the working tree; a
change is fail with the paths, and nothing is cleaned automatically). The finalized profile and
`SC/infer/profile-inference.json` are copied to `ST/local/harden-ready/<stamp>-infer/` for the draft (section 2).
ifDropped: "/harden would find no runnable test gate, or unconfirmed side effects, and stay report-only [skills F04,
F12]."

**H5 — the gates, three times, one shuffled, no flaky gate.**
`hardenready` writes `SC/harden-ready.config.json` = `{"comment": ["harden-ready: the gates of the finalized
self-setup profile"], "env_policy": "allowlist", "inherit_env": false, "env_allowlist": <SC/infer/profile-inference.json
config_env.env_allowlist>, "gates": <profile.inferred.json gates, each reduced to gates.py's GATE_CONFIG_KEYS>}`: the
top level of `SC/infer/profile-probe.config.json` (what infer_profile's `_config_doc` writes and /harden's
verify_branch uses as defaults) plus the finalized gates, so a gate without its own `inherit_env` runs in /harden's
allowlisted environment, never the whole parent environment (a gate that passes only with an inherited variable
would pass here and fail under /harden). Then:
```
PY H/scripts/gates.py --label harden-ready-repeat --repeat 3 --config SC/harden-ready.config.json --repo R --out-dir SC/gates --json
```
Pass iff exit 0 and `SC/gates/harden-ready-repeat.json` has `all_passed: true` and `flaky: []`. The shuffled run is the
gate named `<test gate>-shuffled` that self-setup adds for vitest, jest-like `--randomize` runners and `go test`
(`infer_profile.py` `shuffled_gate`); when the config has none, the check stays ok only if
`profile-inference.json` records no limit line starting with `no shuffled gate for` (the runner has no shuffle option),
and says `no shuffled run` in detail; otherwise fail with that line. ifDropped: "a red or flaky gate makes /harden's
whole run report-only [skills F03]."

**H6 — fresh clone, lockfile install, gates.**
```
git -c core.longpaths=true clone --no-local R SC/fresh
PY H/scripts/gates.py --label harden-ready-install --config SC/infer/profile-install.config.json --repo SC/fresh --out-dir SC/install-gates --json
PY H/scripts/gates.py --label harden-ready-fresh --config SC/harden-ready.config.json --repo SC/fresh --out-dir SC/fresh-gates --json
```
(no `profile-install.config.json` → no install is needed: that step is ok with detail `no install config`). Pass iff
the clone and every gates.py call exit 0. The size of `SC/fresh` on disk after the install (sum of file sizes, links not
followed; hard links counted every time, an over-estimate on purpose) is recorded as `fresh_clone_gb` for H9.
ifDropped: "/harden replays install and gates from a fresh clone; a failure there means its autonomous run applies
nothing [skills F06]."

**H14 — frontend-check, build phase (when the plan has frontend tasks).**
From `SC/fresh` (installed by H6), the `FRONTEND.build` command of FRONTEND.md 6.2 with `--root SC/fresh` and the UI
paths relative to it, e.g. `pnpm -C "<ui>" build && node C:/Users/Utilisateur/.claude/skills/frontend/scripts/frontend-check.mjs
--json --phase <build|small, by profile.frontend.mode> --profile "ST/profile.json" --root "SC/fresh" --state "ST/frontend" --out "SC/fe" --serve
"<ui>/dist"` (cwd `SC/fresh`). Pass iff exit 0 (a requested gate that is skipped exits 1). No frontend task in the plan → ok (`no judged
UI in the plan`). Holds the browser slot. ifDropped: "the judged UI could regress between the last FE proof and the
hand-over without any gate seeing it."

**H9 — disk and time cover /harden's budget.**
- Disk: the governor's free-space reading of the drive holding `R` and of the OS temp drive (`governor.read`,
  PowerShell `Get-PSDrive`) is at least `machine.disk_floor_gb + 2 × fresh_clone_gb + 1.0` GB (/harden's verifier
  makes fresh clones of the base and the branch in the OS temp directory [skills F35]).
- Time: `harden_budget_min` = `profile.harden.budget_min_p80` when set, else `1.2 × clamp(60 + 20 × loc / 1000, 120,
  600)` with `loc` = the sum of `languages.*.loc` in `SC/inventory.json` (an over-estimate of /harden's in-scope LOC,
  on purpose) [skills F07]. `harden_end_latest_utc` = `local/schedule.json`'s `build_complete.harden_end_latest_utc`
  (the instant /harden must end for the fix wave, FE-21, recording, /prose, screenshots and submission to fit their
  P80; CLI.md `schedule` data). Pass iff `now + harden_budget_min ≤ harden_end_latest_utc`. Otherwise fail with both
  figures; the hand-over can still happen only through an owner decision (`harden-ready` stays red; see 3.4). In the
  after-harden profile (1.2) this time check is replaced by `now + deliverables_p80_min ≤ submission deadline`.
ifDropped: "/harden would start without the disk to finish its clones, or with less time than its own deadline rule
needs, and eat the deliverables' time."

### 1.5 Output
`ST/local/harden-ready/<stamp>.json` (completion-gates shape): `{ok, tool: "harden-ready", version: "1", at, phase_selected:
"build", head: <HEAD>, plan_version, counts, gates: [H1..H14 in id order]}` plus, in each gate's `evidence`, the
command lines (never an env value, never a secret path's content) and result paths. Also kept for the hand-over:
`ST/local/harden-ready/<stamp>.facts.json` = `{head, fresh_clone_gb, harden_budget_min, harden_end_latest_utc, loc,
scope_out, scope_paths, infer_dir}`. `SC` is deleted afterwards unless `--keep` (the governor's sweep removes leftovers;
`SC/fresh` holds hard links from pnpm, removed link-safely). Exit 0 iff every gate is ok.

---

## 2. The time-capped /harden profile draft (`handover.draft_harden_profile`)

### 2.1 Where it is written
Primary: `profile.harden.profile_draft_path`, else `<workspace.private_dir>/harden/<slug>-harden-profile.draft.json` —
outside the product repo's work tree, as /harden wants an owner profile that the repository neither tracks nor holds
[skills F37; harden protocol-preflight PF-22]. A byte-identical copy goes to `ST/harden-profile.draft.json` (CLI.md
`handover`; the state repo keeps its history). Neither file is ever written under `R/.harden/`.

### 2.2 Content (from `assets/harden-profile.template.json`, filled from the latest ok harden-ready facts)
```json
{
  "template": "Brouillon écrit par /execution le <date> : relis-le, puis supprime cette ligne \"template\" pour en faire ton profil. Tant qu'elle est là, /harden refuse ce profil (validate_profile) et reste en lecture seule.",
  "comment": ["Brouillon /execution pour <project>, HEAD <head8>.", "Budget borné : fin au plus tard <harden_end_latest en SGT et Paris>.", "Portes et e2e : celles de l'auto-configuration à blanc (harden-ready H4-H6), sans modification."],
  "version": 1,
  "mode": "auto",
  "gates": "<finalized profile.inferred.json gates, verbatim>",
  "e2e": "<finalized e2e, verbatim>",
  "network": "<finalized network>",
  "live_side_effects": "none",
  "forbidden_commands": "<finalized forbidden_commands> + the policy-derived bans of 2.3",
  "situation": "release preparation",
  "auto_apply": {"structural": true, "behavioural": true, "dependencies": true, "money_paths": "<false when the plan has a task holding a wallet:* resource or a tx proof, else true>", "owner_judgement": true, "dependency_versions": false},
  "sandbox_ack": true,
  "budget": {"deadline_utc": "<harden_end_latest_utc>", "max_minutes": "<min(600, floor(minutes from now to harden_end_latest_utc)), at least 30>", "max_usd": null, "max_tokens": null},
  "origin": {"kind": "owner", "tool": "execution-handover", "created_utc": "<now>", "base_sha": "<HEAD, 40 hex>"},
  "provenance": "<the finalized profile's provenance, plus {\"budget\": [{\"source\": \"execution handover\", \"line\": null, \"detail\": \"deadline from DL-build-complete and the post-harden P80\"}]} and one key \"forbidden_commands[<i>]\" per appended ban, i being its index in the merged list, each [{\"source\": \"execution handover\", \"line\": null, \"detail\": \"<the policy entry it comes from>\"}]>"
}
```
/harden's profile schema restricts provenance keys to `mode`, `network`, `live_side_effects`, `sandbox_ack`,
`situation`, `future_work`, `budget`, `env`, `install`, `auto_apply.<x>`, `gates.<n>`, `e2e.<n>`,
`forbidden_commands[<i>]` and `money_paths_globs[<i>]` (its `provenance.propertyNames` pattern, read 2026-10-01): a
bare `forbidden_commands` key would make `validate_profile.py` refuse the draft (2.4) and drop the time cap.
- `mode` stays `auto` only because H4 required it; `live_side_effects: none` and `sandbox_ack: true` are copied from
  the finalized self-setup profile only (never set by /execution on its own); if the finalized profile says otherwise,
  the draft keeps the finalized value.
- `origin.kind: "owner"` with the `template` key: the file is invalid as a profile until the owner removes `template`
  (/harden's own convention for a drafted profile: "a template key that keeps it invalid until the owner reviews
  it"); removing it is the owner's promotion. /execution never removes it.
- `money_paths_globs` is not set: /harden then judges money paths itself and withholds on doubt.

### 2.3 Policy-derived bans added to `forbidden_commands`
Always: `/\bgit\s+push\b/`, `/\bgh\s+repo\s+(edit|create|delete)\b/i`, `/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(deploy|publish|release)\b/i`,
`/\bvercel\b.*--prod\b/i`. From the policy: each `networks.mainnet.broadcast_patterns` entry as `/<pattern>/`, each
`deny_commands[].pattern` as `/<pattern>/`, each `deny_endpoints` entry (`/<pattern>/` when `regex`, else the plain
string). JSON doubles every backslash. Duplicates removed, order: finalized first, then these.

### 2.4 Validation before it is offered
`hardenready` writes a copy without the `template` key to `SC/draft-check.json` and runs
`PY H/scripts/validate_profile.py SC/draft-check.json --repo R` (exit 0 required). A failure keeps the draft on disk
but out of the hand-over command (`type_this` without `--profile`) and states why in the hand-over text.

---

## 3. The hand-over (`exec.py handover`)

### 3.1 Preconditions (CLI.md)
The latest `completion run --phase build` for HEAD is ok, the latest `harden-ready` for HEAD is ok, both newer than
the last commit on origin/main; `.harden/active` absent (exit 4). Otherwise exit 1 with the open gates listed.

### 3.2 What to type (`type_this`)
Built in this order, from the harden-ready facts:
1. `scope`: when `scope_out` is empty → no paths; else `scope_paths` = the top-level entries of `git -C R ls-tree
   --name-only HEAD` (expanded one directory level at a time where an entry contains an excluded glob, until no entry
   intersects `scope_out`), minus anything matching `scope_out`; or `profile.harden.scope_paths` when the owner set
   them.
2. `profile`: `--profile <primary draft path>` when the draft validated (2.4).
3. `type_this` = `/harden` + (` ` + scope paths joined by spaces, when any) + (` --profile "<path>"`, when 2 holds).
The four shapes of CLI.md (`/harden`, `/harden <paths>`, `/harden --profile <path>`, `/harden <paths> --profile
<path>`) are all valid /harden arguments (its `argument-hint`: `[paths...] [--interactive | --report-only] [--profile
path]`).

### 3.3 Effects
Writes the draft (2.1), sets run_state BUILD_COMPLETE → HANDED_OVER, runs `hooks uninstall` (restores
`switchModelsOnFlag`, deletes `local/active`), queues the Notion hub "Now" update (`Remis : tape /harden`) and the
wave-report-style row of the hand-over, appends `handover` and `hooks.uninstalled` events, then `sync`. The
orchestrator afterwards: deletes the heartbeat cron (CronList, CronDelete: a cron would otherwise wake a session that
has nothing to do), stops the background watchers, executes the Notion batch, sends the push, and prints `text_fr`
**verbatim**. Idempotent after success (prints the same text).

### 3.4 When harden-ready stays red near the deadline
The engine never hands over on a red gate. When a check cannot turn green in time (H9 time, H12 CI outage), the
orchestrator proposes a decision (`policy-exception`, owner-only) whose options are `wait` (keep fixing),
`handover-report-only` (the owner will run `/harden --report-only`, which needs no profile and changes no code; the
hand-over text then says so) and `skip-harden` (deliverables proceed without /harden; recorded in decisions.md and in
the `HARDEN.report` gate, which stays open). `handover --decision D` (CLI.md) accepts only that resolved decision as
the override and prints which gates were red.

### 3.5 The hand-over text (`assets/report-templates/handover.fr.md`, rendered by `report.py`)
```
# Prêt pour /harden · {{project}}

Le build est prouvé complet et le dépôt est prêt pour /harden.

- Commit final : `{{final_sha}}` sur main (poussé).
- Contrôle de complétude (build) : ok, {{completion_at}} · {{completion_report}}
- Porte harden-ready H1-H14 : ok, {{harden_ready_at}} · {{harden_ready_report}}
- Temps restant pour /harden : jusqu'à {{harden_end_latest}} ({{minutes_left}} min) ; budget prévu {{harden_budget_min}} min.
- Disque libre : {{disk_free_gb}} Go (besoin estimé {{disk_need_gb}} Go).

## À faire maintenant
1. {{profile_step}}
2. Ouvre une nouvelle session à la racine du dépôt (`{{repo}}`), puis tape exactement :
   `{{type_this}}`
3. /harden ne fusionne et ne pousse jamais. Quand il a fini : relis `.harden/report.md`, fusionne la branche qu'il nomme dans son en-tête (« on branch harden/… », créée par /harden) dans main et pousse.
4. Puis tape `/execution --fix {{repo}}/.harden/report.md` : je te propose les correctifs, puis la suite (H3, enregistrement, /prose, captures du README en dernier).

{{scope_note}}
Ensuite, dans l'ordre : {{open_after_harden}}.
```
`profile_step`: when the draft validated: `Relis {{draft_path}} ; s'il te convient, supprime la ligne "template" (c'est
toi qui valides le profil).`; otherwise `Pas de brouillon de profil utilisable ({{reason}}) : /harden fera sa propre
auto-configuration avec son budget par défaut ({{default_budget_min}} min).` `scope_note`: empty, or `Hors périmètre
de /harden : {{scope_out}} ({{why}}).` The hand-over never computes the branch name: /harden names it from the local
`date +%F` and adds `-2`, `-3` when it exists, so a UTC date can be wrong in SGT; fix mode reads the branch from the
report's header line (FIX-MODE.md 3.2). `open_after_harden`: the ids and French titles of the open deliverable-phase
tasks in dependency order. Push text
(≤ 200 characters): `Build prouvé ({{final_sha8}}). Tape {{type_this_short}} avant {{harden_start_latest}}. Détails
dans le hub.` Every value comes from the reports, the facts file, the plan and the clock; nothing is typed by a model.

---

## 4. EX-HARDEN-PARK (the owner's part of H7)

When H7 fails, the orchestrator posts `execution:EX-HARDEN-PARK` (manual, owner devA, where laptop) with the listed
file names: steps `Déplace chaque fichier listé hors du dépôt (par exemple dans {{private_dir}}/env/) ; le profil de
l'événement le charge par chemin (policy.secrets.env_file)`, bring-back `{key: "<T>-parked", kind: "text", verify:
{method: "regex", spec: "^(fait|done)\\b"}}`, then re-runs `harden-ready --only H7`; the task is done when the answer
is verified **and** H7 is ok (the H7 run is the mechanical check). Agents never move, read or rename env files [skills
F34].

## 5. Tests (B07)
`test_hardenready.py`: H1 exit 4 with `.harden/active` and every other gate `skipped`; H1 local HEAD ahead of origin →
fail; H2 dirty tree, and its positive control (excludes missing → fail); H3 focus marker found, skip marker only
counted; H7 by name with an `open()` spy (no call), `.env.example` ignored; H9 time arithmetic on fixed `--now`,
`schedule.json` and `inventory.json` fixtures, and the disk formula; H10 frozen / touched-after-freeze / scoped-out /
empty-scope; H11 env names (each regex once) and the TODO pattern with the exemption; H13 missing replay run → fail;
H14 with a fake checker that skips a gate → fail; argv spy proving `finalize` never gets `--install` and every
`--out-dir` parent lacks `active`; H4-H6 on a tiny Python project through the real harden scripts (`EXEC_SLOW=1`).
`test_handover.py`: refuses with open gates; the draft validates with `validate_profile.py` once `template` is removed
(with every 2.3 ban present and one `forbidden_commands[<i>]` provenance key per ban) and fails with it present; the
H5 config carries `env_policy: allowlist`, `inherit_env: false` and the inferred allowlist (a gate reading an
unlisted variable fails there); the after-harden profile skips H8 and checks H9 against the deliverables' P80; the
bans of 2.3 appear; the draft is outside the work tree and identical to the state copy;
`type_this` for the four shapes; the French text golden file; hooks entries and the marker removed; idempotent second
call.

---

## 6. Contract questions raised by this file
Settled in revision 2 (README.md 10; CLI.md now defers to 1.4 for the exact checks): Q-H1 `build_complete` in
`local/schedule.json` (with `deliverables_p80_min` for the after-harden profile); Q-H2 the combined `type_this`; Q-H3
`handover --decision`; Q-H4 the finalized gates under the probe config's environment top level; Q-H5 H3 false
positives on `.only(` in test folders are accepted (a red gate the owner can clear, never a silent pass).
