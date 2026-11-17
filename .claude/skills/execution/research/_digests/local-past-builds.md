# local-past-builds

## Summary
1. The user already ran a hand-driven /execution: plan file (Hedera TASKLIST.md, BNB TASKS.md) + one Workflow per day-wave (sole-installer foundation -> parallel file-disjoint builders -> integrator -> read-only adversarial reviewer -> fixer that re-confirms findings) + an orchestrator routine between waves (re-verify, AI-trailer grep, push, dispatch CI, poll, update plan/memory).
2. Measured: Hedera 10 waves, 44 agents, 16.5M tokens, 26.8 h workflow-busy over 38.4 h; one day-wave = 190-240 min, 4-8 agents, 2.3-3.1M tokens; builders median 46 min, reviewers 26 min. No USD for builds.
3. What failed was the loop, not the code: usage limits (11 h and ~4.5 h of nights lost; weekly quota exhausted twice in the week of 23 Sept), plan drift (TASKLIST stale within a day, dated items skipped silently), lenient proofs (forged evidence accepted, skipped gate reported ok, receipts matched by file name), disk full 4 times (2.4 GB free tonight), compaction in every event, deliverables started early.
4. Best prior art for autonomy: the /harden night plan (ticked plan file + CronCreate watchdog every 30 min that checks real state and resumes with resumeFromRunId); it died only when the weekly quota ran out.
5. Weekly resets observed Wed 23 and Wed 30 Sept 04:00 Paris; if the cadence holds the next is 10:00 SGT on 7 Oct, 22 h into the Origins window, so the hack's first 22 h share this week's quota with tonight's /harden, /prose and the /execution rehearsal.
6. Completeness must put the burden on 'done': the 30 Sept pre-harden workflow's default-refuted skeptics rejected all 9 plan-vs-tree findings because the plan sat outside the repo.
7. In-person builds (XRPL, Monad) were driven step by step in the main session; parallel build waves at event speed have never been run and must be rehearsed.
8. Two-dev recipe that worked (XRPL): frozen contract + real fixture server + path fence + hard checkpoints + self-contained prompt for dev B; the no-AI-attribution guard is machine-local and did not cover dev B.

## Recommendations
1. Default wave template = the Hedera day-wave: one installer foundation agent, 2-3 parallel builders owning disjoint paths (pathspec commits), optional integrator, read-only adversarial reviewer with planted defects, conditional fixer that confirms each finding first; calibrate estimates on 190-240 min, 4-8 agents, 2.3-3.1M tokens per wave (F01, F04, F08-F10).
2. Mandatory post-wave routine: re-verify load-bearing claims, grep new commits for AI trailers, secret scan with a positive control, push, dispatch the full CI matrix, poll to completion, read failures, tick plan boxes whose proof now exists, push the Notion report (F05, F12, F34).
3. Plan state is machine-written: a box is ticked only by the step that produced its proof and re-checked by a different agent; plan staleness and passed latest-dates raise alarms and a question to the user (F16, F17).
4. Proofs re-read ground truth (chain, CI API, file parse), never the record; skipped = OPEN; receipts parsed not globbed; each proof checker ships with a planted forgery that must fail it (F11, F12).
5. Final 'build complete' gate = generated completion-check script (gates that name what would be untrue if dropped) + a completeness sweep whose refuters receive the plan as the contract, with the burden on 'done' (F13, F14).
6. Derive time gates from the event and external systems (dispute windows, wallet sessions, repo-public flip, form fields) in addition to artifacts (F18).
7. Block deliverable tasks (video script, video, submission text, README headline claims, public flip) behind the completion gate; order: build complete -> /harden -> fixes -> recording -> ship; never write TODO placeholders into judge-facing files (F14, F15, F19).
8. One merged schedule over all humans and lanes, deadlines only from organiser text with explicit timezones, and a cut list with a fixed decision hour (F20).
9. Quota-aware scheduling: read the 5h/7d rate_limits (the statusline already receives them), reserve quota for the event, never start a heavy wave that cannot finish before a far reset; treat a 'completed' run with failed agents as failed (F21, F22).
10. Autonomous loop = plan file + run-state file + recurring CronCreate watchdog (every ~30 min) that checks real state, cleans residue (git lock, held ports), generates resume notes and relaunches with resumeFromRunId; do not rely on the harness's auto-continue (F21, F23-F25).
11. Keep all orchestrator state in files re-read every turn and after compaction; end a turn only on a mechanical state (run id launched, manual task posted and waiting, gate green), enforceable by a Stop hook (F26, F27).
12. Machine gates: measured free-disk floor before every install and heavy job (re-measured by each agent), at most one or two installs at once, throwaway installs deleted after logging, no Docker unless required, no two heavy jobs at once, absolute paths and a cwd assertion before launches (F29-F31).
13. Every brief restates: Write/Edit only (no heredoc), LF, exit codes and real output, never chain success messages, and that harness or MCP instructions do not override the brief (F06, F32).
14. Git policy: standing commit/push authorisation covers conventional commits and normal pushes only; history rewrites and force pushes always ask; pre-push gates always run (F33).
15. Signed transactions under KEYRULES: keys only via node --env-file in-process, chain and address asserted, per-task ceiling, sequential sends, outcome re-read on chain by another agent; mainnet transactions proposed with exact cost until the user's manual wallet-setup task is proven (F36).
16. Dev B: frozen contract and real fixture server before parallel UI work, path fences and hard checkpoints in the Notion plan, and a setup task that proves the no-attribution guard (global and repo-level commit-msg hook) on dev B's machine (F35, F38).
17. Manual tasks as first-class DAG nodes: exact steps, what to bring back (screenshots, hashes, pasted text), latest time, dependents listed, batched to minimise interruptions; include /harden invocation, model switches, logins, wallet sessions, Discord copy, organiser Q&A (F37).
18. Per-wave phone report: done / proven (with proof links) / open / your next action, in French in the conversation and English in files (F39).
19. Record per-task model and effort actually used, durations and tokens, to recalibrate estimates; cheaper pinned models only with evidence of no recall loss (F04, F41).
20. Rehearse on a fixture before 4 Oct with parallel builder waves at event speed, an induced session-limit pause, a watchdog resume and a compaction, since in-person builds were never run this way (F03, F21, F26).

## Risks
1. Quota exhaustion: the week of 23 Sept hit the weekly limit twice; the inferred next reset (10:00 SGT, 7 Oct) falls 22 h into the Origins window, so pre-flight work this week consumes the hack's first-day quota (F22).
2. Overnight stall: two nights were lost to limits (about 11 h and 4.5 h) because nothing re-checked state; the cron watchdog also dies when the weekly quota is gone (F21, F25).
3. False 'done': forgeable proofs, skipped checks counted green, receipts matched by file name, and default-refuted skeptics erasing plan gaps have each already happened (F11, F13).
4. Plan drift: a hand-kept plan went stale within a day and dated items slipped with no alarm (F16, F17).
5. Disk full mid-wave: 2.4 GB free tonight; parallel installs once consumed 15 GB in 40 min, and a full disk makes agents fail for reasons their logs do not show (F29).
6. Memory pressure killing servers or background shells when many Claude processes run (F28, F30).
7. Git collisions: shared working tree, auditors reading a moving HEAD, stale index.lock after interruptions; worse once dev B pushes to the same repo (F08, F24, F34).
8. AI attribution leaking from dev B's machine if its guard is missing (F35).
9. Orchestrator compaction during the crunch, then acting on a stale summary (F26).
10. Announce-without-act leaving the loop idle while the user believes it runs (F27).
11. cwd drift launching a wave in the wrong repository (F31).
12. Harness or MCP instructions that contradict the brief (heredocs in bypass mode) corrupting source files (F32).
13. Human latency on manual tasks at an in-person event where the user is also meeting judges and teams (F37, F40).
14. Unwatched CI after pushes, including asset-only pushes outside a wave (F34).

## Open questions
1. What lifted the weekly limit on 24 Sept at 06:46Z, 54 min after 'resets Sep 30, 4am'? Extra usage, a model-specific pool, or a transient message? It decides whether buying more usage is a contingency during the hack.
2. Is the weekly reset fixed at Wednesday 04:00 Paris, i.e. 10:00 SGT on 7 Oct? Check the statusline's 7-day reset on 4 Oct before finalising the plan.
3. Can a Workflow agent or hook read the rate_limits data the statusline receives, or must a statusline script persist it to a file for /execution?
4. Does a CronCreate watchdog keep firing when the laptop sleeps, the lid is closed, or the session is driven through Remote Control from the phone?
5. Will the Origins build itself run as parallel workflow waves? At XRPL and Monad the in-person build ran step by step in the main session.
6. The TOKEN2049 recommendation asks for a complete 'ugly take' at hour 18-20; the user's rule forbids deliverables before completeness. Is a timed insurance recording an exception, as the XRPL backup video was?
7. With dev B running the same /execution on the same repo, does each side commit its own lane (Hedera style) or does one side integrate (Holdover style)?
8. Will the still-running 30 Sept pre-harden completeness critic (started 20:48Z) change the conclusion of F13?

## Findings
- F01 [verified-source, LB] A Hedera build wave had a fixed shape: serial foundation (only agent allowed to install), parallel file-disjoint builders, integrator, read-only adversarial reviewer, then a fixer run only if the review found anything above minor.
  -> Use this as the default wave template; the planner assigns one installer per wave and file-disjoint builder lanes.
- F02 [verified-source] The BNB variant: per-lane pipeline builder -> reviewer-that-fixes; agents never committed (parent committed with git add -A); two workflows ran on the same repo at once, fenced only by file ownership in the prompt.
  -> /execution must choose a commit-ownership mode per project (agents commit with pathspecs vs orchestrator integrates), especially once dev B shares the repo.
- F03 [verified-source, LB] At in-person events (XRPL, Monad) the build itself was driven step by step in the main session; workflows were used only for pre-event specs, rescope, overnight docs (writer->verifier per page), the demo-path audit and filing prep.
  -> Parallel builder waves at event speed are unproven for this user; the pre-flight rehearsal must exercise them, not only the planning.
- F04 [verified-executed, LB] Measured cost: Hedera 10 runs/44 agents/16.5M tokens/26.8 h busy over 38.4 h; Holdover 4/30/8.35M/4.0 h; Orma event 7/77/9.6M/3.3 h. Hedera day-waves 190-240 min, 4-8 agents, 2.3-3.1M tokens; builder median 46 min (max 124), reviewer median 26 min; all agents on claude-opus-5[1m]; no USD recorded for builds.
  -> These are the only local calibration numbers for the per-task time and token estimates the plan must carry.
- F05 [verified-source, LB] Between waves the orchestrator re-verified load-bearing claims itself, grepped new commits for AI trailers, pushed, dispatched the full CI matrix, polled until complete, read failed logs, and updated TASKLIST and memory.
  -> Encode this routine as a mandatory post-wave step in /execution, including CI polling and plan update.
- F06 [verified-source] The brief that worked = one shared context block (sources of truth by section, repo state, engineering/git/machine rules, docs discipline, notes file per agent) + one task block per agent with explicit path ownership.
  -> Generate briefs from this skeleton rather than free text.
- F07 [verified-source, LB] Structured-output schemas made every report a set of receipts: verified[{check, command, exit_code, result}], tx_hashes, commits, not_done, open_questions; reviews return findings with severity/evidence/fix and a verdict enum.
  -> Proof-of-done should be carried in schema fields a second agent can re-run, not in prose.
- F08 [verified-source, LB] Several agents committing into one working tree concurrently worked because each owned paths and committed with explicit pathspecs; the repo-wide pre-commit hook coupled them.
  -> Parallel lanes in one repo require a path-ownership map in the plan and pathspec-only commits.
- F09 [verified-source, LB] Review was adversarial both ways: the fixer had to reproduce each finding before acting and refuted reviewers with evidence several times.
  -> 'Checked by an agent that did not write it' must include the author's right to rebut with evidence.
- F10 [verified-source, LB] Every day's review found defects that green tests, typecheck and lint had passed; planted defects exposed them (decoder too greedy twice, send block only in JSX, tests that could not fail, lint false positives).
  -> Each wave's verification must include planted-defect checks, not only suite runs.
- F11 [verified-executed, LB] Proof checkers were forgeable or lenient: an evidence checker accepted a false record; completion-check reports a skipped gate as ok in --json mode; receipts are matched by file-name regex.
  -> Proofs must re-read ground truth, parse receipts, treat skipped as open, and each checker needs a planted forgery that must fail it.
- F12 [verified-source, LB] House rule: any 'refused' or 'zero hits' claim needs a positive control in the same run; a blind scan was recorded as a failure mode.
  -> Negative proofs (no secrets, no TODOs, no third-party calls) are only valid with a planted positive control.
- F13 [verified-executed, LB] In the 30 Sept pre-harden completeness workflow the default-refuted skeptics rejected all 9 plan-vs-tree findings (18/18 votes), mostly because TASKLIST.md sits outside the repo and the shared context said to ignore research/; the planned-never-written phone alert was among them.
  -> The final completeness gate must feed the plan to every refuter and put the burden of proof on 'done', never on 'missing'.
- F14 [verified-source, LB] The completeness rule came from BNB 24 Sept: 920 green tests, yet 2 of 6 proof artifacts never written, a panel absent, no deploy, 10 deferral markers; it became a mechanical gate script kept out of CI that blocks all deliverables.
  -> /execution generates and runs a per-project completion gate as its exit condition.
- F15 [verified-source] The deferral markers that later blocked BNB deliverables were requested by the orchestrator's own brief.
  -> /execution never writes placeholders into judge-facing files; pending content lives in the plan.
- F16 [verified-executed, LB] The hand-maintained TASKLIST went stale within a day: last written 24 Sept 23:56 while work continued 25 and 30 Sept; 5 boxes done but unticked, one ticked box hid an open remainder, 3 planned code items half or never written.
  -> Plan state must be machine-written by the step that produces the proof, and plan staleness itself is checked.
- F17 [verified-executed, LB] Dated plan items slipped silently: agent work scheduled for 26-29 Sept (quality pass, judge audit, census) never ran; no workflow ran from 25 Sept 21:09Z to 30 Sept 09:34Z and nothing flagged it.
  -> Every task needs a latest date with an alarm, and unattended windows need a scheduler plus reserved quota.
- F18 [verified-source, LB] A gate list derived from artifacts missed the only irrecoverable external clock (ERC-8183 dispute window) until 25 Sept.
  -> Derive time gates from the event rules and external systems (windows, sessions, public flips, forms), not only from artifacts.
- F19 [verified-source, LB] Deliverables were started before the build was complete at three events (BNB video script, Hedera video script with 2 of 4 preconditions unmet, XRPL feedback written before coding and a deck claiming 5 PRs that did not exist).
  -> The completion gate must block deliverable tasks in the DAG, and requests for them while gates are open get a one-line refusal plus the open list.
- F20 [verified-source, LB] Event plans were first built on guessed deadlines, and independently written lane plans double-booked the one human (29.5 waking hours) until a single merged timeline owned the clock.
  -> The planner must level load across humans and take deadlines only from organiser text, with a timezone-checked single schedule.
- F21 [verified-source, LB] Five usage-limit behaviours: Fable model limit halted everything until /model switch (~11 h lost); weekly limit 'continuing automatically at 4am' did nothing (~4.5 h lost); session limit inside a workflow paused and re-ran agents; far reset dropped all agents while the run reported 'completed'; the watchdog cron itself hit the limit.
  -> /execution needs its own quota awareness, per-agent result checks, and a watchdog; it must not rely on the harness's auto-continue.
- F22 [inferred, LB] The weekly quota was exhausted twice in the week of 23 Sept; resets were observed Wed 23 and Wed 30 Sept 04:00 Paris; if weekly, the next is Wed 7 Oct 04:00 Paris = 10:00 SGT, 22 h into the Origins window.
  -> Plan quota across the week: the first 22 h of the hack share this week with tonight's /harden, /prose and the rehearsal; reserve and track it.
- F23 [verified-source, LB] The Workflow runtime's recovery features were used for real: resumeFromRunId with cached agents, a stall detector that retries silent agents (up to 5), and re-runs after session-limit resets.
  -> Build /execution's resume path on resumeFromRunId and caching; expect stall retries in duration estimates.
- F24 [verified-source, LB] Before resuming, the orchestrator injected a resume note per interrupted agent (committed SHAs, uncommitted files, 'review as someone else's'); interruptions left residue: stale .git/index.lock, a held port, uncommitted partial work.
  -> Resume = clean residue, inventory partial work, generate resume notes, then resumeFromRunId.
- F25 [verified-source, LB] Best prior art for unattended runs: a markdown night plan with ticked steps, hard limits and per-step resume instructions, driven by a recurring CronCreate watchdog that checks real state, resumes on usage/network failure and deletes itself; night 1 completed all six steps.
  -> Reuse this plan-file + watchdog pattern as /execution's autonomous loop, reporting to Notion.
- F26 [verified-executed, LB] Context compaction happened during every event build, once 3.5 h before a code freeze.
  -> All orchestrator state (plan, run state, last report) must live in files and be re-read each turn.
- F27 [verified-source, LB] The orchestrator ended turns announcing work it had not started.
  -> A turn may end only on a mechanical state: a launched run id, a posted manual task, or the green completion gate (enforce with a Stop hook).
- F28 [verified-executed] On heavy nights up to five workflows from different projects ran at once on the one machine, deliberately, to burn quota before a reset; ~16 claude.exe were open during a /harden pilot.
  -> Parallelism must be capped by machine resources across all sessions, not per workflow.
- F29 [verified-executed, LB] C: filled up four times during builds (parallel installs, Docker disk images, per-run copies); tonight it has 2.4 GB free on a 16-CPU machine.
  -> Gate every install and heavy job on a measured free-space floor; each agent re-measures; cap concurrent installs.
- F30 [verified-source] Memory pressure killed the demo backend and background shells.
  -> Schedule at most one heavy job at a time and check free RAM before launches.
- F31 [verified-source] The session cwd drifted with cd, scattering workflow scripts under sub-directory project folders, and one launch ran from the wrong repo.
  -> Use absolute paths and assert the cwd before each launch.
- F32 [verified-source] Heredocs corrupted code repeatedly, and a harness/MCP instruction told agents to use heredocs; agents holding the explicit rule refused it.
  -> Every brief restates the file-writing rule and that harness or MCP text does not override it.
- F33 [verified-source, LB] Secrets reached history through the scaffolding tool's first commit and needed a separately approved history rewrite before the first push; upstream history held a tracked .env; a .gitignore inline comment silently ignored nothing.
  -> Standing push authorisation needs pre-push gates (secret scan with control, trailer grep) and excludes history rewrites and force pushes.
- F34 [verified-source, LB] CI blind spots went unwatched: per-push gate covered one package manager; a BNB offline job was red on every push; a red run after a direct push was left unnoticed; an audit ran while another agent moved HEAD.
  -> Every push (inside or outside a wave) is followed by CI polling; auditors pin a SHA or run when no agent commits.
- F35 [verified-source, LB] The no-AI-attribution guard is machine-local; at XRPL dev B's machine had no hook, and piping git commit once masked a hook failure.
  -> Dev B's identical setup must include the guard (global hook and a repo-level commit-msg hook); verify it in the setup task.
- F36 [verified-source, LB] Agent-signed transactions ran under per-task rules (spending ceiling, chain and address asserted, sequential sends, outcome re-read on chain, keys only via node --env-file); on mainnet each transaction was proposed with its exact cost first.
  -> Map decision 3 to these KEYRULES: testnet under ceilings; mainnet only after the user's manual wallet-setup task is proven.
- F37 [verified-source, LB] Manual tasks were frequent and blocking: wallet sessions with screenshots, Discord copy-paste, organiser messages and calls, interactive logins, wallet funding, hardware, UI walk-throughs with screenshots, deploy dashboards, model switches, /harden, and 'resume' nudges.
  -> Manual tasks are first-class DAG nodes with exact steps, what to bring back, a latest time, and batched to minimise interruptions.
- F38 [verified-source, LB] Two-dev recipe that worked at XRPL: frozen API contract + real fixture server (after Nov 2025 when 100% of dev B's pages were discarded), dev-B task list with [CP], dep, DoD, hard checkpoints and drop order, and a self-contained prompt for dev B's Claude Code with a path fence and a clock.
  -> Dev B's lane starts only after a frozen contract and fixture exist; the Notion plan carries path fences and hard checkpoints.
- F39 [verified-source] The user repeatedly polled for status and for a completeness verdict; short handover notes in French were the reports that worked.
  -> The per-wave Notion report should answer 'done / proven / open / your next action' in that order.
- F40 [verified-source] Mid-build input from judges, mentors and organisers changed scope several times and was rated above build time.
  -> The plan must accept rescope inputs as proposals applied after the user answers (decision 2).
- F41 [verified-source] Build agents all ran on the session default model; effort was raised only for verifiers/critics; the one experiment with pinned cheaper subagent models lost recall and misreported models; USD exists only for /harden pilots (34.84 for 90 min; 101.69 for 97 min).
  -> Record the model actually used per task; downgrade models only with evidence of no recall loss.