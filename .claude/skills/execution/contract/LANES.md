# LANES.md — build plan for the /execution skill

The next workflow builds the skill in **11 file-disjoint lanes**, B01 to B11 ("B" so they are never confused with a
plan's lanes L0, L1, ...). Each lane is implemented by one agent, tested by its own acceptance tests, and verified
by a different agent that re-runs those tests and reviews the diff against this contract. Every file of the final
skill belongs to exactly one lane (section 4 is the full ownership map); a lane that needs a file another lane owns
asks through the contract, never edits it.

Contents: 1 rules for every lane · 2 the lanes · 3 dependencies and integration order · 4 ownership map ·
5 estimates · 6 integration review.

---

## 1. Rules for every lane

- Read README.md, then CLI.md, SCHEMAS.md, MODULES.md, and the ARCHITECTURE.md sections your lane cites. The
  contract wins over your judgement; a gap or contradiction goes into your report as a contract question with a
  proposed fix, and you build the conservative reading meanwhile (never a silent choice).
- Python ≥ 3.11 standard library only; the engineering rules of README.md section 2. Node ≥ 20 built-ins only for the
  `.mjs`/`.js` assets.
- Write files with the Write/Edit tools only (never shell heredocs: they eat backslashes), UTF-8, LF, no BOM.
- Tests: `unittest`, files `scripts/tests/test_<area>.py`, fixtures under `scripts/tests/fixtures/<lane id>/`,
  run with `python -m unittest discover -s scripts/tests -p "test_*.py" -v` from the skill root (the /harden
  layout). Shared helpers are in `scripts/tests/_support.py` (B01); a lane needing more helpers writes
  `scripts/tests/_support_<lane id>.py`. Tests never touch the network, `~/.claude/` (use a temp
  `CLAUDE_CONFIG_DIR` or the functions' path arguments), the real usage snapshot, or a real Notion workspace; git
  tests use temp repos with a local bare "origin".
- Every negative claim in a test ("refuses", "never writes") has a positive control in the same test file.
- Modules of lanes not yet integrated are faked in tests through the signatures of MODULES.md (a fake lives in the
  test file or the lane's `_support_<lane>.py`, never in `execlib/`).
- Done for a lane = its acceptance tests pass, the whole suite still passes (no other lane's test broken), `python
  -m py_compile` is clean on every file it owns, the CLI commands it owns print schema-valid envelopes, and its report
  pastes the test summary line and exit codes. Commits: conventional, message from a file, no attribution trailer,
  pathspec commits of the lane's own files only.

---

## 2. The lanes

### B01 CORE (built first, alone)
Owns: `scripts/exec.py`; `scripts/execlib/{__init__,errors,log,clock,paths,jsonio,model,schema,procutil,globs,resources,graph,locks,envelope,gitutil,events,state,plan,statusio,decisionsio,nevershow,cli}.py`;
`assets/schemas/**` (delivered with this contract; changed only through a contract change); the skill's
`.gitattributes` (`* text=auto eol=lf`) and `.gitignore` (`__pycache__/`); `scripts/tests/_support.py`;
`scripts/tests/fixtures/B01/**`.
Deliverables: every module above per MODULES.md; `cli.py` with the full argparse surface of CLI.md and the lazy
dispatch table (unimplemented handlers answer E_NOT_IMPLEMENTED, exit 3); `_support.py` with `TempRepo` (a git repo
plus bare origin), `fixed_now()`, `run_exec(args, cwd) -> (exit, envelope)`, and builders for minimal valid plan,
profile, policy, status, receipt and draft documents.
Acceptance tests:
- `test_schema.py` — the subset semantics of MODULES.md 3: type (bool is not integer), enum/const JSON equality,
  deep `$ref` pointers across files, `if/then/else`, `oneOf` exactly one, `additionalProperties` with
  `patternProperties`, `x-external` collection, unsupported keyword raises at load; messages sorted.
- `test_schema_assets.py` — all 25 schemas load with only supported keywords; for each schema at least one valid and
  one invalid fixture document (`fixtures/B01/docs/<schema>.{ok,bad}*.json`) give the expected result; the result-*
  schemas contain no `$ref` (they are inlined into agent() calls).
- `test_envelope.py`, `test_cli.py` — every command word of CLI.md section 9 parses; unknown command exit 2; each
  ExecError subclass maps to its exit code; an uncaught exception gives E_INTERNAL exit 3 with a logged traceback; the
  envelope always validates; stdout holds exactly one JSON line; stderr lines are JSON with ts/level/module/msg.
- `test_clock.py` (strict UTC parsing; display with zoneinfo and with the fallback offset, warning emitted),
  `test_jsonio.py` (atomic writes, LF only, canonical bytes stable, append_jsonl one line per call),
  `test_paths.py` (Layout paths match SCHEMAS.md 1.1; scratch inside a git work tree refused).
- `test_globs.py` — truth tables for `intersects` and `contains`, plus a property test: over a generated corpus of
  paths, `intersects(a, b)` is never false when some corpus path matches both (no false negative), `contains` never
  true when some path matches inner but not outer.
- `test_graph.py`, `test_plan.py` — closure, joined, topo; `plan_digest` ignores approved/amendments/updated/version,
  `proof_digest` ignores `negative_control.recorded`.
- `test_locks.py` — two processes contend (second waits then times out with exit 3); a lock whose holder is dead is
  broken and an `error` event appended; acquiring out of LOCK_ORDER raises E_LOCK_ORDER; `pid_alive` never kills
  (positive control: a live child stays alive).
- `test_procutil.py` — timeout kills the whole tree (a grandchild sleeper is gone); Git Bash found, never WSL bash.
- `test_gitutil.py` — non-fast-forward push detected as `rejected_non_ff`; `commit_paths` refuses a message with a
  Co-Authored-By trailer (positive control: a clean message commits); `exclude_add` idempotent; no FORBIDDEN_ARGS
  reachable.
- `test_events.py` — append without the state lock raises; ordering by (ts, executor, seq); two clones appending
  then pulling merge without conflict through `merge=union`; duplicates by id dropped.
- `test_state.py`, `test_statusio.py`, `test_decisionsio.py`, `test_nevershow.py` — run-state transition table;
  status defaults and seq; decision id ranges per executor and union merge of two clones; never-show live versus
  expired embargo at a fixed `--now`, NFKC + lower() (never casefold, Q-F9), regex entries, scope filter, `Hit` never
  carries text.
- `test_import_graph.py` — parses every `execlib/*.py` with `ast` and fails on any import that breaks MODULES.md
  sections 1 and 8 (this test protects every later lane).
- `test_isolation.py`, `test_encoding.py`, `test_exec_argv.py` (TESTS.md 1.3, 4.5) — no write under the real
  `~/.claude/`, no network; UTF-8 envelopes and ASCII-escaped hook output without `PYTHONIOENCODING`; every file of
  the skill UTF-8, LF, final newline; a `/x` argument through Git Bash with `MSYS_NO_PATHCONV=1`.
- `test_jsonio.py` (in addition) — `write_json_atomic` survives a reader holding the file open in another process
  (bounded `PermissionError` retry), then E_ENV; `test_locks.py` (in addition) — a live holder older than STALE_S is
  waited for (W_LOCK_OLD), never broken; a dead pid whose number was reused (creation time differs) is broken;
  `test_paths.py` (in addition) — `resolve_repo` from a linked worktree returns the main repository.

### B02 PLAN
Owns: `execlib/{validate,templates,catalogue,planning,amend,ingest}.py`; `assets/task-templates/execution.json`;
`assets/checks/devb_setup_check.py`; `scripts/tests/fixtures/B02/**` (including the pinned real-format copy
`frontend-real-<sha8>.json`).
Deliverables: the 27 plan invariants (with TD-V1..TD-V9 and TD-A1..TD-A6 of TWO-DEV.md); the instantiation algorithm
(SCHEMAS.md 6.2) for both libraries, including the /frontend format adapter (FRONTEND.md 2.1-2.8: specialise,
normalise, plant files) and `plan instantiate --proofs` / `--pre-t0`; `ingest --patch --notion-ids|--answer`; the
dev B setup checker (TWO-DEV.md 8.3); the
execution template library (EX-BOOT bootstrap with `.gitattributes eol=lf`, main branch, `core.longpaths`, portable
commit-msg hook refusing AI trailers; EX-CI offline gates workflow; EX-CONTRACT contract wave items; EX-DEPLOY;
EX-EVID evidence capture; EX-README factual README; EX-NAME project-name decision; EX-APPROVE plan approval;
EX-GATE-BUILD build-complete gate; EX-CONVERGE convergence pass; EX-REPLAY proof replay on a fresh clone;
EX-HARDEN-PARK park auto-loaded env files (manual); EX-HARDEN-REVIEW review and merge the /harden branch (manual);
EX-FIX-GATE regression gate; EX-FREEZE-* (validator, code-for-recording, docs, push-tag); EX-HB-* /hackathon Phase B
(claims ledger open/close, DX journal, recon passes, demo audit T-6h, adapted preflight that can say no, visibility
calendar, judge fetch twice, EX-HB-CLAIMS-VERIFY before FE-20) each with `brief_refs` into
`~/.claude/skills/hackathon/references/`; EX-DLV-* deliverable sub-plan (deck lock, recording, EX-DLV-PROSE, slides,
Drive, form, flip with its whole-history never-show proof, tag, README screenshots last), all behind EX-HARDEN-REVIEW
and `@fix-gate` (P-17); EX-FIX-SELECT (`decision_kind: fix-selection`), EX-FIX-CODE, EX-FIX-REVERT, EX-FIX-GATE;
EX-DEVB-SETUP, EX-DEVB-CHECK, EX-DEVB-INTEGRATE); `plan instantiate`, `validate`, `catalogue`, `amend`, `ingest`
commands.
Acceptance tests:
- `test_validate.py` — for each of P-01 … P-27 one fixture plan that passes and one that fails with exactly that
  code (`fixtures/B02/invariants/P-xx.{ok,bad}.json`).
- `test_templates.py` — through the adapter on the pinned real-format /frontend library copy, and with the
  contract-format sample library for edge cases (TESTS.md 3.4): references on →
  FE-03 depends on FE-02, off → on FE-00; FE-07 after FE-06; `@project-name` creates the name decision only when the
  name is unconfirmed; `@feature-tasks` picks the build tasks by covers intersection and fails on zero; FE-1x
  expands per group with `{features}`; an unknown placeholder fails; the same inputs give byte-identical plans;
  frontend library absent → E_DEPENDENCY_MISSING with a decision proposal (no fallback template).
- `test_execution_templates.py` — the real `execution.json` validates; instantiated on the B02 fixture profile it
  yields a plan that passes validate, with P-17 (deliverables after the build gate, FE-21 after harden review,
  screenshots last) and P-18 (one build gate) holding.
- `test_catalogue.py` — /frontend's exact format, plan order, byte-identical regeneration.
- `test_amend.py` — two clones amend concurrently against one bare state remote: one wins, the other retries,
  re-validates and lands version n+2; renumbering, deletion and a dependency on a higher id are refused (exit 4); a
  decision already applied is refused; the digest chain (P-26) holds after each amendment.
- `test_ingest.py` — missing fields listed, never invented; frontend profile schema absent → E_DEPENDENCY_MISSING;
  spec-validation decision checked by hash (a changed spec invalidates it).

### B03 SCHEDULE
Owns: `execlib/{schedule,due,quota}.py`; `assets/reference-class.json`; `scripts/tests/fixtures/B03/**`.
Deliverables: CPM, Monte Carlo through the dispatcher (running tasks conditioned on elapsed time, verify stage,
failure retries, human response latency; hash-seed independent), priorities, zones, build-complete deadline and the
`build_complete` block of `local/schedule.json`, cut candidates, recalibration; due items from anchors (B's liveness
from the remote's commit dates); quota decisions (rules 1-5 of CLI.md, the override, null storms); `schedule`,
`simulate`, `due`, `quota` commands.
Acceptance tests:
- `test_schedule.py` — `lognormal(26.7, 46.0)` sigma = ln(46/26.7)/1.2816; CPM slack on a hand-computed 7-task graph;
  priority ties broken by remaining path, successors, id; ordered resources never overlap, serialized ones are
  serialized, `browser` respects slots; a human task only progresses inside its owner's awake windows; same seed →
  identical output, different seed → different samples; zones at 0.8 and 0.5 boundaries; build-complete deadline for
  the Origins numbers (submission 2026-10-07T15:59:00Z) equals the hand-computed instant; cut candidates ordered
  optional, P3, P2 and never on the must-have critical path; planned → ready only with every dependency done and the
  release past.
- `test_due.py` — T-6h anchor from `event.deadline`, recurrence until an anchor, overdue latest starts, freezes
  becoming active, all in UTC regardless of the machine's zone.
- `test_quota.py` — snapshot fixture parsing (epoch resets to UTC); stale snapshot → unknown with a warning; ≥ 85 %
  five-hour → critical-only; weekly projection short → pause and a decision draft.

### B04 STATE
Owns: `execlib/{status,reconcile,results,decisions,answers,manual,replay,resume}.py`;
`scripts/tests/fixtures/B04/**`.
Deliverables: the transition table and the done check (SCHEMAS.md 4); reconciliation and the status digest;
results recording (receipts found in any wave, gate receipts, merge-intent finalisation); decision proposals and
resolutions with their effects (`quota-override`, `frontend_choice`, `--quote-file`/`--choice-file`/`--from-notion`);
answer ingestion and verification (strict patterns, argv-only readers, redaction, `--relay`); manual posting
(`decision_kind`, `--link`); event replay and local-state rebuild; the resume steps R0-R10 and `resume --takeover`;
commands `status`, `task set-status`, `result put`, `decision propose|resolve`, `answers ingest`, `manual post`,
`events replay`, `resume`.
Acceptance tests:
- `test_status.py` — every row of SCHEMAS.md 4.2 succeeds with its evidence and is refused (exit 4) without it; each
  of the seven done conditions of 4.3, removed alone, blocks `done`; `task set-status` can never reach built,
  verifying or done.
- `test_reconcile.py` — a crash mid-wave (receipts on disk, status still running) converges to done in one
  `status`; a null agent becomes a rerun with attempts unchanged; hook events are imported once; run_state derived
  for each case (awaiting, paused, stuck, build complete); the digest is ≤ 2,000 characters.
- `test_results.py` — schema failure keeps the inbox file; identical bytes are a no-op; different bytes exit 4.
- `test_decisions.py` — dedup returns the open proposal; a second resolution is refused; owner-only kinds refuse
  `--by` other than a dev; cut → cut-proposed → cut or restored; approve-plan sets `approved` with the digest.
- `test_answers.py` — each verification method with a fake chain reader (exit 0 and exit 1), immutability (exit 4),
  `--scope-change` opens a proposal and unblocks nothing.
- `test_manual.py` — French push text ≤ 200 characters naming the task id; idempotent without `--repost`.
- `test_replay.py`, `test_resume.py` — rebuilding local state from events equals the original; a stale
  `index.lock` is removed only when no git process runs; launched waves classified same-session (resumeFromRunId)
  versus relaunch.

### B05 WAVES
Owns: `execlib/{wave,briefs,wavejs}.py`; `assets/workflows/{wave,planner}.template.js`;
`assets/briefs/{planner,test-designer,implementer,verifier,reviewer,convergence}.md`;
`scripts/tests/js/wave-harness.mjs`; `scripts/tests/fixtures/B05/**`.
Deliverables: wave selection (live waves occupy lanes, resources and slots; built tasks with a dead verifier;
in-wave dependents; gate receipts), manifest (`launching`, `fix_attempts`, `rerun`, `pre_t0`), script generation with
inlined /frontend fragments and the comment-stripped static check, briefs (every exec.py line with `--repo` and
`--state`, receipts of every wave under "Already recorded"), launch bookkeeping, ingest (keyed rows, recomputed
calibration, shared-checkout re-sync); the planner workflow template and `plan emit`; commands `wave
emit|launched|ingest`, `plan emit`. The templates of WAVES.md 8-9 changed in revision 2: re-run the Node smoke before
copying them.
Acceptance tests:
- `test_wavejs.py` — each forbidden token is caught; `js_literal` escapes U+2028/2029; generated scripts pass `node
  --check`.
- `test_wave_emit.py` — each precondition refusal (unapproved plan, governor pause, quota pause, missing brief ref,
  missing fragment → E_DEPENDENCY_MISSING); selection never co-schedules overlapping writes or shared resources;
  manifest validates; re-emitting an unlaunched wave is byte-identical; every brief names all its `brief_refs`, the
  standing rules, its inbox path and the exact `result put`/`merge` commands.
- `test_wave_harness.py` — runs `node scripts/tests/js/wave-harness.mjs <generated script>` with a fake `agent()`:
  a dependency starts only after its prerequisite resolved done; a null agent yields `rerun` and its dependents
  `skipped-dep`; `args.skip` tasks are not run; the writer and verifier semaphores and browser slots are never
  exceeded; the return value is `{wave, outcomes}` only; fake `feCritique`/`feDirections` fragments are called with
  `api = {agent, parallel, pipeline, log}`.
- `test_wave_ingest.py` — outcomes from fixture results and receipts; a result contradicting its receipt →
  E_RESULT_RECEIPT_MISMATCH and the receipt wins; DX rows appended marked UNVERIFIED; claims rows marked
  `unverified`; calibration ratios updated; ingest twice changes nothing.
- `test_planner_template.py` — the planner workflow renders, passes `node --check` and the forbidden-token check.

### B06 PROOF & MERGE
Owns: `execlib/{integrity,hardenbridge,proof,merge}.py`; `scripts/tests/fixtures/B06/**`.
Deliverables: scanners with positive controls (conventional commits, secrets on free text); the bridge to /harden's
scripts (gates.py as the proof engine with explicit `--config`/`--out-dir`, the dry-run self-setup without
`--install`); proof runs for the six proof types (governor reading, `disk-heavy` lock, budget, `EXEC_ENV_FILE`,
`json_checks`, plant files on copies, `refs/exec` fetch, environment-failure classification) and verdict receipts (SHA
from the merge receipt, attestation, transitions, tracked copies); the merge queue (single-tree commits from write
paths through a temporary index and an integration worktree, intents, budget, state-only); commands `proof
run|verdict`, `merge`, `snapshot`, `fe-workspace`.
Acceptance tests:
- `test_integrity.py` — each scanner catches its planted violation and passes a clean diff; a scanner that misses
  its plant makes the scan fail ("blind scan").
- `test_hardenbridge.py` — an out-dir whose parent holds `active` is refused; `finalize` is never called with
  `--install` (argv spy); a real two-gate gates.py run on a temp project returns its exit code and flaky list.
- `test_proof.py` — command proof through the real gates.py in a clean clone; pre-implementation negative control
  fails as required; file, url (local `http.server`), ci (fake `gh` on PATH), tx (fake reader) and human-attest types;
  verdict refusals: pass on a failed run, SHA not on origin/main, stale proof hash, missing negative control.
- `test_merge.py` — landed path; conflict → exit 1 with the files; a concurrent push makes the first push rejected and
  the loop retries; trailer, never-show (no matched text in output), secret, push freeze and protected path → exit 4;
  a third call for one attempt → E_MERGE_ATTEMPTS; single-tree mode refuses a commit outside the task's writes; the
  merge receipt validates.

### B07 READINESS & HAND-OVER
Owns: `execlib/{completion,hardenready,handover,fixmode,preflight}.py`; `assets/completion-check.template.mjs`;
`assets/harden-profile.template.json`; `scripts/tests/fixtures/B07/**`.
Deliverables: completion-check generation and run (comma phases, `ok` recomputed); harden-ready H1-H14 in both
profiles; hand-over (`--decision`, `--final`); fix mode (`--select-file`, note records); preflight PF-01-PF-29 with
`open` and `--confirm`; commands `completion generate|run`, `harden-ready`, `handover`, `fix`, `preflight`.
Acceptance tests:
- `test_completion.py` — the generated script, run with node on fixture states: a skipped gate keeps `ok` false and
  exits 1; a gate that throws is `fail`; `--phase build` passes while harden and deliverable gates stay open; output
  validates against completion-gates; generation is byte-identical; no CI workflow in the fixtures references it.
- `test_hardenready.py` — H1 refuses with `.harden/active` (exit 4); H2 dirty tree; H3 focus markers; H7 detects an
  env file by name without opening it (open() spy); H9 time arithmetic; H14 with a fake frontend-check that skips a
  gate → fail; H4-H6 on a tiny Python fixture project through the real harden scripts (slow, `@unittest.skipUnless`
  env `EXEC_SLOW=1`, run once in the lane's report).
- `test_handover.py` — refuses with open gates and lists them; with green fixture reports prints the hand-over from
  receipts (final SHA, what to type, time left in SGT and Paris), writes the profile draft in the state dir, removes
  the hooks entries and the marker.
- `test_fixmode.py` — a sample /harden report (`fixtures/B07/harden-report.md`) parses into items of the three
  sections; an unknown structure → E_REPORT_FORMAT; a selection becomes an amend patch with fix tasks and a
  regression gate; unselected items recorded with the reason.
- `test_preflight.py` — env-var checks with a patched environment; /frontend parts missing → fail with the decision
  fix text; skipped checks listed in `manual_checklist`; `--strict` turns skipped into failure.

### B08 HOOKS & OPS
Owns: `execlib/{hookcore,hooksinstall,governor,initcmd,syncstate,heartbeat}.py`;
`scripts/hooks/{py.sh,stop_gate.py,session_start.py,session_end.py,stop_failure.py,pre_tool_guard.py,user_prompt.py}`;
`assets/launcher/{launch-exec.ps1,launch-exec.sh}`; `assets/state-repo/{gitattributes,gitignore}`;
`assets/githooks/commit-msg`; `scripts/tests/fixtures/B08/**`.
Deliverables: the six hooks (MODULES.md 6, HOOKS.md: bytes I/O, one file per event, session-scoped agents, run lease,
attestations, PowerShell tokenizer), settings install/uninstall/canary (`CLAUDE_CODE_SESSION_ID`, `permission_mode`),
the governor, init (private-remote check, the portable commit-msg hook), sync (lock order, secret scan, private-remote
check), heartbeat (cron formula, session id), the launcher (sets `CLAUDE_CODE_RETRY_WATCHDOG=1`,
`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH=60000`, `MSYS_NO_PATHCONV=1`,
checks `DISABLE_AUTOUPDATER` and the version ≥ 2.1.286, starts `claude --remote-control "<proj>-exec" -n "<proj>-exec"
--dangerously-skip-permissions` from the repo root, and with `-Resume` / `--resume` runs `claude --resume "<proj>-exec"
--dangerously-skip-permissions` with the same environment).
Acceptance tests:
- `test_stop_gate.py` — every row of MODULES.md 6.1 with payload fixtures: running workflow → allow; absent
  `background_tasks` treated as unknown (never as empty); awaited item plus armed heartbeat → allow; open plan and
  nothing armed → `additionalContext` continuation (JSON shape exact, exit 0, no `decision` key); the fifth
  consecutive continuation becomes an allow plus `stuck`; `stop_hook_active` false resets the counter.
- `test_session_hooks.py` — SessionStart output ≤ 2,000 characters and only for the orchestrator; re-key only when
  SessionEnd(clear) armed it; StopFailure records stuck.
- `test_pre_tool_guard.py` — nonce binding from the main thread only; each deny rule of 6.5 with a positive control
  (the allowed neighbour passes); generic agent types get the strictest rules; a corrupt marker fails open with a
  log line; reading `.env.example` is never denied by this guard; the deny output is JSON with exit 0.
- `test_user_prompt.py` — task-notification prompts ignored.
- `test_hook_latency.py` — p95 of 30 runs of each hook relative to a same-run no-op baseline (≤ 130 ms × load; absolute ≤ 250 ms with `EXEC_LATENCY=1`, revision 4) (skipped with a warning on CI-like
  slow environments via `EXEC_SKIP_LATENCY=1`).
- `test_hook_concurrency.py`, `test_agent_hook_command.py` (TESTS.md 4.5) — 16 concurrent hooks against a writer loop;
  the agent-definition hook command through `py.sh` with `MSYS_NO_PATHCONV` set and unset.
- `test_hooks_install.py` — foreign entries kept byte-for-byte; tagged entries replaced idempotently; uninstall
  restores `switchModelsOnFlag`; the exclude line added once; an invalid settings file is never overwritten.
- `test_governor.py` — PowerShell JSON fixtures → decisions (lanes formula, pause reasons); the sweep never targets a
  path outside the project's scratch or worktrees.
- `test_init.py`, `test_sync.py`, `test_heartbeat.py`, `test_launcher.py` — create, rejoin, pre-T0 then import;
  union merges between two clones and a plan.json conflict → E_STATE_CONFLICT; the cron expression from the profile
  and the plain-text prompt with absolute paths; the launcher refuses a fake `claude` reporting 2.1.285, exports
  `MSYS_NO_PATHCONV=1`, and `-Resume` runs `claude --resume` with the same environment (argv and env log of a fake
  `claude`).

### B09 NOTION & REPORT
Owns: `execlib/{notion,report}.py`; `assets/report-templates/{wave.fr.md,approval.fr.md,handover.fr.md,push.fr.json}`;
`references/notion.md`; `scripts/tests/fixtures/B09/**`.
Deliverables: Notion op generation (init stages, mirror by hash, wave report, hub text, outbox with a token check,
async polls, poll plan, redaction of op text, crash acks for resume R9), acks and captures (`--error-file`,
`--error-code`); French wave report, approval summary and hand-over text; `push.fr.json` (including the `stuck` push
the Stop hook reads, HOOKS.md 4.3); `EXECUTION.md`;
`references/notion.md` (formats compiled from the notion://docs resources and the full tool descriptions:
property-value syntax, SELECT not STATUS, self-relation in two calls, date plus "Due text", view DSL, rate limits);
commands `notion diff|ack|poll-plan`, `report`.
Acceptance tests:
- `test_notion.py` — init emits databases, then the self-relation, then views, in separate stages; rows are created
  once and updated only when their hash changes; only own-executor rows; owner-owned fields never appear in any op;
  a non-empty outbox starts with a token check; an async_task result schedules a poll stage; every batch validates
  against notion-ops; the poll uses view mode only.
- `test_report.py` — golden French report for a fixture wave (single column, sections Fait / Prouvé / Ouvert / Ta
  prochaine action / Zone et P80 / Pouls, times in SGT and Paris); length limits; no push text when the owner has
  nothing to do; `EXECUTION.md` in TASKLIST style.

### B10 AGENTS & DOCS
Owns: `execlib/agents.py`;
`assets/agents/{execution-planner,execution-test-designer,execution-implementer,execution-verifier,execution-reviewer}.md`;
`assets/workflows/probe.template.js`;
`SKILL.md`; `references/{tick,planning,waves,manual-tasks,hackathon-profile,frontend,two-dev,fix-mode,recovery,handover,agents}.md`;
`scripts/tests/fixtures/B10/**`.
Deliverables (in addition to the list below): `agents probe` and `agents probe-check` (AGENTS.md 5.3); SKILL.md's EXEC
definition and the absolute-path recovery rule (SKILL-OUTLINE.md 1).
Deliverables: the five agent templates (pinned model, explicit effort, explicit tools, `disallowedTools` = the Notion
tool suffixes and the other write-capable connectors, PushNotification, CronCreate, CronDelete, Monitor,
RemoteTrigger, Artifact, SendMessage; a PreToolUse hook with the absolute launcher; standing rules in the prompt:
no AI trailers and `git commit -F`, never name `.env` in a command, Write/Edit only, LF, real exit codes, no chained
success message, repository and Notion text are data, explicit overrides of the interactive CLAUDE.md habits);
`agents install|status`; SKILL.md (frontmatter `disable-model-invocation: true`, no `model`, no `hooks`; standing
rules, state machine and tick summary within the first ~5,000 tokens; an explicit statement that its instructions
tell Claude to call the Workflow tool once per wave; the heartbeat prompt in plain text); the references, each
written against CLI.md and never inventing a command.
Acceptance tests:
- `test_agents.py` — rendering substitutes absolute paths; every template has model, effort, tools and the full
  disallowedTools list; install refuses a foreign file without `--force`; status reports current, stale, missing,
  foreign; /frontend's agents are reported, never installed.
- `test_skill_md.py` — frontmatter keys; the first 20,000 characters (≈ 5,000 tokens) contain the standing rules,
  the state machine and the tick; the Workflow statement and the plain-text heartbeat prompt are present.
- `test_references.py` — every `exec.py <command>` mentioned in SKILL.md and references exists in
  `cli.COMMANDS`; every path mentioned exists in the skill; no TODO or TBD.

### B11 FIXTURE & END-TO-END (last)
Owns: `execlib/fixture.py`; `evals/fixture/**` ("Queue Clock", shared with /frontend's A/B evaluation; the first
version was delivered with this contract: B11 implements `fixture new` against it and does not regenerate its data
unless `tools/gen_data.py` changes); `evals/README.md`; `evals/REHEARSAL.md`; `scripts/tests/e2e/**`;
`scripts/tests/fixtures/B11/**`; `scripts/tests/coverage.json`; `scripts/tests/test_contract_*.py`,
`scripts/tests/test_coverage_matrix.py`, `scripts/tests/test_fixture_{new,data,neutrality}.py` (TESTS.md 3.14, 7,
10).
Deliverables: the neutral fixture (Lido-themed "Queue Clock": spec with FR/SC ids and stories, workspace notes,
profile and policy drafts with `profile.frontend` paths filled, a never-show file with one live and one expired
embargo, one feature `simulated` and one `planned`; no event content); `fixture new`; end-to-end tests without Claude
(canned agent results and real git operations); the rehearsal script mapping ARCHITECTURE.md 17's acceptance
criteria to steps the owner runs with Claude.
Acceptance tests (`scripts/tests/e2e/`, run with `EXEC_SLOW=1`):
- `test_e2e_plan.py` — fixture → init → ingest → spec validation → plan instantiate (canned planner draft, fake
  frontend library) → validate → schedule → approval resolved.
- `test_e2e_wave.py` — wave emit → canned implementer results and real commits in a temp clone → merge → proof run →
  proof verdict → status: done; one proof failing then fixed on attempt 2; a null agent rerun.
- `test_e2e_two_dev.py` — clones A and B with disjoint tasks; a cross-executor dependency satisfied by a receipt on
  origin/main; sync union merges; a concurrent amend resolved by the push CAS.
- `test_e2e_resume.py` — local state deleted mid-wave → events replay rebuilds it; resume classifies the wave.
- `test_e2e_completion.py` — completion generate and run (build phase), harden-ready H1-H3, H7, H11 on the fixture,
  handover printed from receipts.
- `test_e2e_fix.py` — a sample /harden report → fix tasks → regression gate → build gates re-run.
- `test_e2e_single_tree.py`, `test_e2e_null_storm.py` — TESTS.md E-19, E-20.
- `evals/REHEARSAL.md` adds the drills of revision 2: a `/clear` with a wave running (re-key, resume line, wave
  classified against the new id), a fresh session taking over (`resume --takeover`), the capture of real Stop,
  StopFailure and PreToolUse payloads into `fixtures/B08/payloads/`, the probe's session-id measurement, and
  `CLAUDE_CODE_SESSION_ID` read from the orchestrator's own Bash tool.

---

## 3. Dependencies and integration order

| lane | needs merged before it starts | soft (codes against MODULES.md signatures, fakes in tests) |
|---|---|---|
| B01 | — | — |
| B02 | B01 | decisions (approval and spec-validation proposals) and status (supersede transitions in amend), both B04; `schedule.build_complete_deadline` (B03) |
| B03 | B01 | — |
| B04 | B01 | amend (B02) for the `amend` effect (it only returns the command); `quota.decide` (B03) in reconcile; `integrity.scan_secrets_text` (B06) in answers; `notion.ack_pending_as_crashed` (B09) in resume R9 |
| B06 | B01 | `status.transition`, `results.landed_receipt` / `finalize_merge_intents` (B04) in proof verdict and merge; `governor.read` (B08) before clones |
| B08 | B01 | `integrity.scan_secrets_text` (B06) in sync |
| B09 | B01 | `integrity.scan_secrets_text` (B06) for op text |
| B10 | B01 | the cli surface exists in B01, so docs can cite every command |
| B05 | B01, B03, B04, B08 | /frontend fragments (fake fixtures); `merge` semantics of B06 through CLI.md (the script only reads exit codes) |
| B07 | B01, B02, B03, B04, B06, B08, B09, B10 | — (fixmode needs amend and decisions; handover needs hooksinstall and report) |
| B11 | all | — |

Integration order (each merge runs the whole suite before the next):
1. **Batch 1:** B01 alone (critical path; every other lane imports it).
2. **Batch 2:** B02, B04, B06 first (longest), then B03, B08, B09, B10 as slots free. These lanes are standard-library
   Python with no installs, so 4 writers at once fit the machine; keep at most 4 writers plus 2 verifiers, and run
   `governor` before the batch.
3. **Batch 3:** B05 and B07 (each after its prerequisites merged).
4. **Batch 4:** B11, then the integration review (section 6).

Critical path: B01 → B04 → B05 → B11 → review.

Merging a lane: rebase on the integration branch, run the full suite (`python -m unittest discover -s scripts/tests
-p "test_*.py" -v`), `test_import_graph.py` green, then fast-forward. A lane that breaks another lane's test does not
merge; the fix belongs to the lane that broke it unless the test contradicts the contract (then a contract question).

---

## 4. Ownership map (every file of the final skill)

| path | lane |
|---|---|
| `ARCHITECTURE.md`, `research/**`, `contract/**` | B00 (the approved spec and this contract: read by every lane, edited by none; a contract change is a separate reviewed step) |
| `.gitattributes`, `.gitignore` | B01 |
| `SKILL.md` | B10 |
| `references/notion.md` | B09 |
| `references/{tick,planning,waves,manual-tasks,hackathon-profile,frontend,two-dev,fix-mode,recovery,handover,agents}.md` | B10 |
| `assets/schemas/**` | B01 |
| `assets/task-templates/execution.json`, `assets/checks/**` | B02 |
| `assets/reference-class.json` | B03 |
| `assets/workflows/{wave,planner}.template.js`, `assets/briefs/**` | B05 |
| `assets/workflows/probe.template.js` | B10 |
| `assets/completion-check.template.mjs`, `assets/harden-profile.template.json` | B07 |
| `assets/launcher/**`, `assets/state-repo/**`, `assets/githooks/**` | B08 |
| `assets/report-templates/**` | B09 |
| `assets/agents/**` | B10 |
| `scripts/exec.py` | B01 |
| `scripts/execlib/{__init__,errors,log,clock,paths,jsonio,model,schema,procutil,globs,resources,graph,locks,envelope,gitutil,events,state,plan,statusio,decisionsio,nevershow,cli}.py` | B01 |
| `scripts/execlib/{validate,templates,catalogue,planning,amend,ingest}.py` | B02 |
| `scripts/execlib/{schedule,due,quota}.py` | B03 |
| `scripts/execlib/{status,reconcile,results,decisions,answers,manual,replay,resume}.py` | B04 |
| `scripts/execlib/{wave,briefs,wavejs}.py` | B05 |
| `scripts/execlib/{integrity,hardenbridge,proof,merge}.py` | B06 |
| `scripts/execlib/{completion,hardenready,handover,fixmode,preflight}.py` | B07 |
| `scripts/execlib/{hookcore,hooksinstall,governor,initcmd,syncstate,heartbeat}.py`, `scripts/hooks/**` | B08 |
| `scripts/execlib/{notion,report}.py` | B09 |
| `scripts/execlib/agents.py` | B10 |
| `scripts/execlib/fixture.py` | B11 |
| `scripts/tests/_support.py`, `scripts/tests/fixtures/B01/**` | B01 |
| `scripts/tests/_support_<lane>.py`, `scripts/tests/fixtures/<lane>/**` | that lane |
| `scripts/tests/test_*.py` | the lane whose acceptance list (section 2, or TESTS.md for a module it adds to that lane: B01 `test_isolation`, `test_encoding`, `test_exec_argv`; B07 `test_completion_cli`; B08 `test_hook_concurrency`, `test_agent_hook_command`; B11 `test_contract_*`, `test_coverage_matrix`, `test_fixture_*`) names the file; one owner per file |
| `scripts/tests/coverage.json` | B11 |
| `scripts/tests/js/**` | B05 |
| `scripts/tests/e2e/**`, `evals/**` | B11 |

Count of modules: 22 (B01) + 6 (B02) + 3 (B03) + 8 (B04) + 3 (B05) + 4 (B06) + 5 (B07) + 6 (B08) + 2 (B09) +
1 (B10) + 1 (B11) = 61, matching MODULES.md section 1 one for one (B01's count includes `__init__` and `cli`).

---

## 5. Estimates (agent-minutes; build = the implementing agent, verify = the independent verifier)

| lane | build | verify | notes |
|---|---|---|---|
| B01 | 145 | 45 | the validator and the CLI surface dominate |
| B02 | 135 | 45 | 27 invariants with paired fixtures; the execution template library; the /frontend adapter |
| B03 | 85 | 25 | pure computation, deterministic tests |
| B04 | 130 | 45 | the transition table is the heart of "done"; takeover and resume |
| B05 | 130 | 45 | JS template plus the Node harness; live-wave occupancy |
| B06 | 150 | 50 | real git and real gates.py in tests; the single-tree merge redesign |
| B07 | 110 | 35 | slow harden-ready tests gated by EXEC_SLOW |
| B08 | 140 | 45 | hooks plus latency and concurrency budgets |
| B09 | 80 | 25 | golden French outputs |
| B10 | 95 | 30 | prose against the CLI; agent templates; the probe |
| B11 | 105 | 35 | end-to-end on the fixture |
| integration review | 60 | — | section 6 |
| **total** | **1,365** | **425** | ≈ 29.8 agent-hours |

Wall clock with 4 writers in batch 2: B01 190 → batch 2 ≈ 210 (B02/B04/B06 at 175-200 each, the shorter lanes
filling freed slots) → batch 3 ≈ 175 → B11 140 → review 60 ≈ **13 h**. Reference class for these figures: the
owner's build agents p50 26.7 / p90 46 min per task (prior-art-planning F28); each lane is 3-5 such tasks.
Recalibrate after batch 1 from B01's actual time.

---

## 6. Integration review (after B11)

A fresh reviewer agent (execution-reviewer role, the contract as the plan, burden on "done") checks, item by item
against CLI.md section 9, SCHEMAS.md sections 2 and 4, and MODULES.md section 6: does the code exist, and has it been
run and left a receipt (a test that exercises it)? It plants at least the defects of TESTS.md 9 (among them a skipped
gate reported ok, a pass verdict on a failed run, a Stop gate treating an absent `background_tasks` as empty, a
missing positive control in a scanner, a heredoc-written CRLF file, a single-tree merge that rebases the shared
checkout, a thrown `agent()` call read as a rerun) and reports which tests caught them. Gaps under this contract become fix
tasks; anything wider is a question for the owner. Only after that review: the rehearsal on the fixture
(`evals/REHEARSAL.md`), with the owner and the phone, per ARCHITECTURE.md 17.
