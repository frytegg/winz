# Contract: modes, tasks, proof and hand-over

Read when: you start any /frontend task (mode A or B), write or verify a task's proof, wire /frontend into /execution, publish a review board, or hand over at P8.

## Purpose
This file fixes how /frontend runs and how it meets /execution, /harden and /prose: the two modes and small mode, the FE task templates, the proof command and its exit codes, the profile block, the shared file formats, the wave fragments, the agent definitions and the owner's single answer channel.
The interfaces themselves are in `scripts/CONTRACTS.md`; this file tells an agent how to act on them.
Phase rules live elsewhere: `01-brief.md` (P0), `10-gates.md` (what each gate proves), `12-critique.md` (P7).
Rules marked "agreement" were settled with /execution on 2026-10-01 and are recorded in its ARCHITECTURE.md section 19.

## Rules

### CT-01 - Run one contract in two modes
- **Rule:** Mode A: you run one task instantiated from `assets/task-templates/frontend.json` inside /execution. Do exactly that task, run its proof, report the exit code and the JSON. Mode B: the owner typed `/frontend` in a project; run P0 to P8 in the main thread. Both modes use the same files, gates and proof command. `profile.frontend.run_mode` says which (default A for an /execution profile, B for a bare block).
- **Why:** The owner's words fit both readings (called by /execution during the build, or a pass over an existing UI such as BNB), so both entry points share one contract [FD13-F01]. Mode A from the start of the build, with no generic UI template, was agreed [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** owner review of the task result against its template.
- **Not when:** never run the mode B phase loop from inside a mode A task.

### CT-02 - In mode A, never ask and never fan out
- **Rule:** A workflow agent has no Agent, Workflow or AskUserQuestion tool. Do not try to spawn critics, probes or per-site workers, and do not wait for an answer. Write each open question as a `missing` entry with `action: "manual-task"` (or a decision note) in your task result and finish. The orchestrator raises the manual or decision task; every other lane keeps running. Critique and direction fan-out run from /execution's wave script through the wave fragments (CT-14).
- **Why:** The 2.1.286 binary defines the workflow agent with Agent, Workflow and SendUserMessage disallowed, and the workflows page says "No mid-run user input" [FD13-F03]. Propose-and-wait is /execution's rule for anything the agent cannot decide [FD13-F05].
- **Check:** owner review: no question waits inside a task result.
- **Not when:** mode B in the main thread keeps the full tool set: launch Workflows for fan-out and ask with AskUserQuestion [FD13-F03].

### CT-03 - Use small mode only when the profile says so
- **Rule:** `profile.frontend.mode: "small"` means: the brief, 1 or 2 directions, a wordmark, one static page, the essential gates of `frontend-check --phase small` (render, a11y, coverage, firstview, tells, ip; no brand, tokens or motion gate), at most 1 critique round (`critique.rounds_max: 1`). The proofs pass `--phase {mode}`, so full mode runs `--phase full` (the build set) and small mode `--phase small`. Never switch mode yourself to save time; the UI budget is decided by the owner at plan approval.
- **Why:** The 21 Sept Origins plan left the frontend 1 to 2 hours and a static page [FD13-F26], but the Cardano track scores User Experience and Design at 20% and asks whether someone new to blockchain understands it quickly, so the budget is the owner's call [FD13-F32].
- **Check:** owner review: `profile.frontend.mode` matches the decision log; `frontend-check --phase small --json ...` exits 0 in small mode.
- **Not when:** the profile says `full`.

### CT-04 - Never invoke /harden or /prose, never make a deliverable
- **Rule:** The hand-over to /harden is a manual task: the owner types `/harden`. Never invoke /prose. Never record the demo video, write the pitch or the README headline, take README screenshots or flip a repo public. Recording scripts may be left ready; the recording itself is a deliverable.
- **Why:** /harden sets `disable-model-invocation`, so only the owner can start it [FD13-F02]. The order is build complete, harden, fix, record, ship, and README screenshots are always the last task [FD13-F19]. A scripted demo video belongs to the deliverable phase, not to /frontend's loop [FD06-F28].
- **Check:** owner review.
- **Not when:** never.

### CT-05 - Instantiate FE templates; resolve every dependency through params
- **Rule:** FE-xx are template ids. `exec.py plan instantiate` turns each into a T-id carrying `template: "frontend:FE-xx"`, and FE-1x into one task per feature group. A template never carries an OR dependency or a runtime condition: params resolve them when the plan is built (`references: on|off`; FE-07 always after FE-06; "project name" becomes a decision task whenever the name is not owner-confirmed; "the feature's own task" becomes the build tasks whose `covers` intersect the group). Implementers read the paths in `brief_refs`; nothing is auto-loaded.

| template | kind | depends on (resolved at instantiation) | proof |
|---|---|---|---|
| FE-00 brief | code | spec approved | `--gates brief` |
| FE-01 confirm reference URLs | manual (owner) | FE-00 | answer file |
| FE-02 references | research | FE-01 | `--gates refs` |
| FE-03 directions | code | FE-02 if `references: on`, FE-00 if `off` | `--gates directions` |
| FE-04 pick direction (H1) | decision | FE-03 | answer file |
| FE-05 brand candidates | code | FE-04, plus a name decision task while the name is not owner-confirmed | `--gates brand.candidates` |
| FE-06 pick logo (H2) | decision | FE-05 | answer file |
| FE-07 tokens | code | FE-04 and FE-06 | `--gates tokens,ip.fonts,ip.hotlinks` |
| FE-08 shell and first screen | code | FE-07 | `--gates render,firstview` |
| FE-09 brand files, favicon set and OG image | code | FE-06 and FE-08 | `--gates brand,ip.fonts,ip.provenance,ip.sponsor-marks` |
| FE-1x one section per feature group | code | FE-08 and the build tasks whose `covers` intersect the group's FR ids (small mode: one task after FE-09) | `--gates coverage,render,tells --features <group FR ids>` |
| FE-20 critique | gate | every FE-1x and FE-09 | critique receipt, then `--phase {mode}` (`build` in full mode, `small` in small mode) |
| FE-21 sign-off (H3) | manual (owner) | FE-20 and the /harden review task (CT-06) | answer file |

- **Why:** Agreed so the plan stays acyclic and checkable before the run [agreement with /execution, 2026-10-01, CONTRACTS.md]. The logo depends on the name, and Origins has a rename pending [FD13-F15]. Section builds depend on a frozen data contract and real fixtures; pages built against imagined shapes were all discarded once [FD13-F20].
- **Check:** `exec.py validate` (acyclic, dependencies on lower ids, every requirement covered).
- **Not when:** mode B has no plan: run the phases in order and treat each "decision" as an AskUserQuestion.

### CT-06 - Place FE-21 after the /harden review, before any recording
- **Rule:** FE-21 sits in phase `deliverable`. It waits for the owner's review and merge of the /harden branch (and any `/execution --fix` wave that follows), and every recording task waits for FE-21.
- **Why:** Agreed placement [agreement with /execution, 2026-10-01, CONTRACTS.md]. The order is build complete, harden, fix, record [FD13-F19], and /harden's fixes can still change code and pixels [FD13-F21], so the sign-off judges the product as it will be recorded. The best measured judges still trail humans, so the last look is the owner's [FD17 Deliverable A].
- **Check:** `exec.py validate`; owner review of the deliverable sub-plan.
- **Not when:** never.

### CT-07 - Write proofs in the agreed command form
- **Rule:** frontend-check never builds; the proof chains the build:
  `pnpm -C <ui> build && node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates <list> --features <FR ids> --root <repo> --profile <abs profile.json> --serve <ui>/dist`.
  Exit 0 if and only if every requested gate is `ok`. A requested gate that is `skipped` exits 1. Exit 1 also means a gate failed; 2 is a usage error (bad flag, missing input, invalid profile); 3 is an environment error (no browser, missing module, port in use). Never pass `--allow-skip` in a task proof. Report the exit code and the gate JSON; never a claim without them.
- **Why:** /execution's runner reads only the exit code, and its verifier re-runs the proof on the landed commit from a clean checkout [agreement with /execution, 2026-10-01, CONTRACTS.md]. The owner's earlier completion check reported a skipped gate as `ok`, a lenient proof [FD13-F16].
- **Check:** `exec.py proof run --sha <landed>` (/execution's verifier re-runs the proof; exit 0).
- **Not when:** file-only gates (`brief`, `refs`, `directions`, `brand.candidates`) need no build step in the chain.

### CT-08 - Narrow a run with --gates and --features, never with a colon
- **Rule:** `--gates` takes group names (`render`), gate ids (`brand.candidates`), `<group>.*` or `all`, comma-separated. `--features FR-003,FR-007` restricts `coverage.features` to those requirement ids. There is no `coverage:<ids>` syntax. `--phase build` (alias `full`) selects the build-complete set and `--phase small` small mode's essential set (see `10-gates.md`).
- **Why:** Agreed flag syntax [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --help` (the accepted flags; any other syntax exits 2).
- **Not when:** never.

### CT-09 - Pick the target flag that matches how the UI runs
- **Rule:** `--serve <dir>` for a static build. `--url <url>` for an app that is already running. `--start "<cmd>" --url http://127.0.0.1:<port>` when the app needs a server: frontend-check starts it, waits until the URL answers, runs, then kills the process tree. Never start a server by hand inside a proof.
- **Why:** Agreed so a verifier can replay the proof unattended [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** `exec.py proof run --sha <landed>` from a clean checkout (exit 0).
- **Not when:** never.

### CT-10 - Keep pre-T0 work in the private dir, and no visual before T0
- **Rule:** When the event forbids designs before kickoff, only FE-00, FE-01 and FE-02 may run before T0, with `--state <workspace.private_dir>/frontend/`; the bootstrap task imports that state at T0. No tokens, logo, mock or code before T0.
- **Why:** Agreed pre-T0 scope [agreement with /execution, 2026-10-01, CONTRACTS.md]. Origins forbids any code before the start, "not even a package.json", while knowledge may cross [FD13-F19]; captures and the pattern ledger are research [FD13-F26].
- **Check:** owner review of the private dir before T0 (no visual file).
- **Not when:** `prework.designs` allows prework (top-level `prework` is authoritative, CT-11).

### CT-11 - Read the profile block, one truth per fact
- **Rule:** Mode A: `--profile <abs path>/.execution/profile.json`; frontend-check reads its `frontend` block. Mode B: `.frontend/profile.json` holding the bare block. Fields: `mode`, `run_mode`, `judged_surface`, `format {stage, projector_zoom, video {max_s, width, height, embed}, async_readme}`, `viewports`, `record_mode`, `ready_flag`, `stack`, `hosting`, `external_requests`, `prework_designs`, `review_surface`, `critique {rounds_max, critics, probes}`, `budget`, `references`, `sponsors`, `tells.score_max`, `paths`, `workspace.private_dir`. Defaults: full mode, run_mode A for an /execution profile and B for a bare block (CONTRACTS 6.1 v1.1), viewports desktop 1440x900 DPR 1, mobile 390x844 DPR 2, reflow 320x640, review surface `claude-design`, critique 3/3/5, external requests off, record mode off. One truth per fact: top-level `prework {code, designs, until_utc}` is authoritative and `frontend.prework_designs` only overrides it; `phase_b.claims_ledger` is the claims ledger; `workspace.private_dir` holds captures and pre-T0 outputs. These paths, and the never-show path, are absolute and outside the product repo, so a verifier can replay a proof from a clean checkout; `paths.design` stays relative to the repo (default `design`).
- **Why:** Agreed profile contract [agreement with /execution, 2026-10-01, CONTRACTS.md]. The event decides the surface: judged surface, recording cap and resolution, stage zoom, hosting, uptime window, external requests, team [FD13-F13].
- **Check:** `node ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates brief --profile <abs profile>` (exit 2 on an invalid profile).
- **Not when:** never copy a fact into a second field; read it where it lives.

### CT-12 - Use one never-show file in the shared format
- **Rule:** The list lives at `paths.never_show` as `{"version": 1, "entries": [{"id", "class", "pattern", "regex": false, "case_sensitive": false, "until_utc": null, "scope": "rendered|repo|both", "note", "source"}]}` with `class` one of `do-not-carry`, `undisclosed-security`, `never-public`, `embargo`. An entry whose `until_utc` has passed is inactive. /execution checks `repo` and `both` entries before every commit and before the public flip; /frontend checks rendered text. Keep the plaintext outside the product repo. Schema: `assets/schemas/never-show.schema.json`.
- **Why:** Four kinds of never-show input exist upstream and only one was checked, in files only [FD13-F11]; the live BNB board rendered findings held under a dated embargo [FD13-F12]. One file for both skills was agreed [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** `coverage.nevershow`.
- **Not when:** never publish, deploy or record before the file exists and the scan passes.

### CT-13 - Map every catalogue id to a route and a data-feature
- **Rule:** In mode A, /execution generates the catalogue from plan.json requirements: `[{"id": "FR-003", "group": "G1", "title", "priority": "P1|P2|P3", "status_expected": "live|testnet|simulated|planned"}]`. Map each id to a route in `<design>/routes.json` and render its surface root as `data-feature="FR-003"`, the spec's requirement id.
- **Why:** Agreed format [agreement with /execution, 2026-10-01, CONTRACTS.md]. A catalogue in this shape decides what a judge can see [FD13-F08], and coverage must be checked on the rendered DOM, because a source grep passed while the spec's panel was missing [FD13-F09].
- **Check:** `coverage.features`.
- **Not when:** mode B without /execution: build the catalogue in P0 (`01-brief.md`).

### CT-14 - Ship multi-agent steps as wave fragments
- **Rule:** /frontend ships `assets/wave-fragments/critique.js` (`async function feCritique(api, input)`) and `directions.js` (`async function feDirections(api, input)`), with `api = {agent, parallel, pipeline, log}`, each returning a receipt object. Plain JS: no imports, no `Date.now`, no `Math.random`. A workflow script cannot run Node, so every command inside a fragment is an `agent()` call that runs it and returns its JSON. /execution's wave emitter inlines the fragments and never re-implements rounds, acceptance or revert logic; mode B workflows inline the same functions.
- **Why:** Agreed so one implementation of the critique loop serves both modes [agreement with /execution, 2026-10-01, CONTRACTS.md]. Independent checkers must be separate `agent()` calls in the script, never nested inside a workflow agent [FD13-F03].
- **Check:** `grep -nE "Date\.now|Math\.random|^import |require\(" ~/.claude/skills/frontend/assets/wave-fragments/*.js` prints nothing.
- **Not when:** never.

### CT-15 - Call only the read-only frontend agents
- **Rule:** `frontend-critic` and `frontend-probe` are installed in `~/.claude/agents/` by `scripts/install-agents.mjs` and called as `agent(prompt, {agentType: "frontend-critic"})`. Each has a pinned model, explicit read-only tools, and `disallowedTools` for Notion and the other write-capable connectors, PushNotification, CronCreate, CronDelete, Monitor, RemoteTrigger, Artifact and SendMessage, the same list as /execution's agents. Only the orchestrator calls Notion.
- **Why:** A workflow agent keeps the full built-in set, including Artifact and PushNotification, unless the definition removes them [FD13-F03]. Same disallowed tools as /execution's agents was agreed [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** `node ~/.claude/skills/frontend/scripts/install-agents.mjs --check`.
- **Not when:** never give a critic or probe write access.

### CT-16 - Publish review boards from the orchestrator; take answers from one channel
- **Rule:** `profile.frontend.review_surface` is `claude-design` (a private Design canvas written from our tokens and SVGs), `board` (a local board rendered to images) or `terminal`. Only the orchestrator, in the main thread, publishes it, following `03-directions.md` section "Publishing the board (orchestrator only)". Answers come through the Notion decision field or a Remote Control reply in mode A, AskUserQuestion in mode B, and nothing else: canvas comments are not answers. Copy the chosen direction's tokens and the chosen mark into the repo right after the pick.
- **Why:** Agreed review surface and answer channel [agreement with /execution, 2026-10-01, CONTRACTS.md]. Claude's phone apps view designs; commenting from them is not documented [FD07-F16]; inline canvas comments sometimes vanish and there is no version history [FD07-F21]; DesignSync runs only under the owner's own `/design-sync` [FD07-F27]; a shared artifact needs a Claude account, so a canvas never goes to a jury [FD07-F29].
- **Check:** owner review; `choices.json` in the state dir holds each answer with its UTC time.
- **Not when:** never publish from a workflow agent.

### CT-17 - Ask the owner three things only: H1, H2, H3
- **Rule:** H1 picks a direction (FE-04), H2 picks the mark (FE-06), H3 signs off the deployed preview at recording size (FE-21). Never decide them yourself and never ask anything else as a checkpoint. In mode A the frontend lane waits on each one while every other lane keeps running.
- **Why:** Off-the-shelf judges fall well short of designers on visual taste, so the owner picks the direction and the logo [FD17-F16]; options must differ visibly or people invent a preference [FD17-F18]. Agreed as decision and manual tasks [agreement with /execution, 2026-10-01, CONTRACTS.md].
- **Check:** owner review; `choices.json` has H1, H2 and H3.
- **Not when:** a missing input is not a checkpoint: it is a manual task or a question (`01-brief.md`).

### CT-18 - Take inputs only from the spec, the profile and P0 discovery
- **Rule:** /frontend's inputs are the validated spec, the profile, and what P0 finds and records with a source in `brief.json` (`01-brief.md`): the two sentences, the gap, sponsors and customers with owner-confirmed URLs, the use case, the feature catalogue, the claims ledger, the never-show list, the judge's path and the event format. Nothing else enters: no copy, name or URL from model memory or an unconfirmed search result, no number outside the ledger or a declared data source.
- **Why:** /frontend resolves each input by glob, records the path found and never invents a missing one [FD13-F05]; customer URLs need a source and the owner's confirmation [FD13-F06]; a number renders only from a verified ledger row [FD13-F10].
- **Check:** `brief.complete`.
- **Not when:** never.

### CT-19 - Keep every output where it belongs
- **Rule:** Write each output only to its row. Never commit a capture, a third-party image, logo or wordmark to the product repo.

| output | mode A | mode B |
|---|---|---|
| brief, pattern ledger, direction board, choices, critique history, gate JSON, screenshots, `ui-copy.md`, receipts | `<repo>/.execution/frontend/` (private state repo) | `<repo>/.frontend/` (git-excluded) |
| pre-T0 brief and reference work | `<workspace.private_dir>/frontend/` via `--state`, imported at T0 | same |
| third-party captures | private workspace, outside any git work tree, purged after the pattern ledger | same |
| `design/tokens.json`, `routes.json`, `waivers.json`, `provenance.json`, `DESIGN.md`, `brand/`, icons, UI code | product repo | product repo |

- **Why:** Captures and layout notes belong to the research tree, verification screenshots to an ignored folder [FD13-F19]; captures live outside any git work tree and are purged with a deletion receipt [FD19 Deliverable].
- **Check:** `git -C <repo> status --porcelain=v1 --untracked-files=all` prints nothing outside ignored paths.
- **Not when:** never.

### CT-20 - Hand over a clean tree with receipts
- **Rule:** Before hand-over (P8): `frontend-check --phase build` (`--phase small` in small mode) exits 0; every output is committed or ignored; Playwright `test-results/` and reports are ignored; gate JSON and critique receipts sit in the state dir, never only in Notion; brand files reach the deck as files (SVG and PNG marks at slide sizes, plus the palette tokens); the frontend's in-scope line count goes into the hand-over so /execution can set /harden's `max_minutes`.
- **Why:** /harden turns report-only on any untracked or modified file outside `.harden/`, freezes committed snapshots and configs, and its default deadline grows by 20 minutes per 1,000 in-scope lines between 3,000 and 27,000 [FD13-F21]. Receipts belong in the repo or the run directory [FD13-F16]. /hackathon's deck builder hard-codes another project's mark [FD13-F25].
- **Check:** `frontend-check --phase {mode}`; `git -C <repo> status --porcelain=v1 --untracked-files=all`.
- **Not when:** never.

### CT-21 - Export the rendered UI copy for /prose
- **Rule:** At hand-over, extract the rendered text of every route (hero, headings, labels, empty and error states) into `ui-copy.md` in the state dir, one section per route.
- **Why:** /prose checks Markdown only and never mentions UI copy, so UI text reaches it only through such an export [FD13-F23].
- **Check:** `test -s <state dir>/ui-copy.md`.
- **Not when:** never.

## Procedure

**A. One mode A task**
1. Read the brief /execution wrote for the task and every path in its `brief_refs`, this file included.
2. Note the profile path and the state dir. Pre-T0 tasks pass `--state <workspace.private_dir>/frontend/`.
3. Do the task inside its write set. Record missing inputs and questions in the result (CT-02); never wait.
4. Run the proof command from the template, chained after the build (CT-07).
5. Report: the exit code, the counts line and every non-ok gate with its detail. Never write "passes" without them.

**B. A mode B run**
1. In the main thread, create `.frontend/` (git-excluded) and `.frontend/profile.json`; ask once for missing profile fields.
2. P0 `01-brief.md`; P1 `02-references.md`; P2 `03-directions.md`, then H1 by AskUserQuestion; P3 `04-brand.md`, then H2; P4 `05-tokens.md`; P5 `06-build.md` with its companions; P6 `10-gates.md`; P7 `12-critique.md`.
3. Fan out with Workflows that inline the wave fragments (CT-14).
4. P8: CT-20 and CT-21, then the owner runs `/harden`; H3 follows the owner's /harden review (CT-06).

**C. Hand-over checklist (P8)**
1. `frontend-check --json --phase build --root <repo> --profile <abs> --serve <dist>` exits 0 (`--phase small` in small mode).
2. `git -C <repo> status --porcelain=v1 --untracked-files=all` is empty outside ignored paths.
3. `ui-copy.md`, gate JSON and critique receipts exist in the state dir.
4. Brand files and palette tokens are listed for the deck.
5. Hand-over note: the final SHA, the frontend line count, open owner items. Then stop.

## Gaps
- No field defines how a mode A agent's `missing` entries become manual tasks; the orchestrator's reading of the task result is assumed.
- /execution's profile puts `paths.never_show` and `paths.feature_catalogue` at the top level, CONTRACTS 6.1 inside `frontend.paths`; since CONTRACTS v1.1 two different values are a usage error (one truth per fact), so stop and report which file is right.
- Settled 2026-10 (CONTRACTS v1.1): `--phase small` runs render, a11y, coverage, firstview, tells and ip, and /execution's FRONTEND.build and H14 pass `--phase small` in small mode. FE-09 stays in small mode, gated by its own proof; the Node brand pipeline ran end to end in 6.2 s [FD12-F30].
- Whether a logo, a token file or reference notes made before kickoff count as a design under the Origins rule is unanswered [FD13-F19]; until the organiser answers, no visual before T0.
- Settled in CONTRACTS v1.1: with `--allow-skip <id>` an accepted skipped gate counts as ok, so the exit can be 0; CT-07 still forbids `--allow-skip` in proofs.
