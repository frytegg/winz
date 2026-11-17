# Prior art: turning a spec or PRD into an executable, schedulable task graph

Dimension researched for the `/execution` skill design. Researcher: subagent, 2026-09-30. Scope: (a) GitHub spec-kit, (b) Taskmaster, (c) Kiro spec mode, CCPM and OpenAI ExecPlans, (d) scheduling theory adapted to agent slots, humans, quota and deadlines, (e) sizing work items for LLM coding agents and their token cost.

Method: primary sources pinned to commits or page dates; two in-memory simulations (no files written) and one mining pass over the owner's own Claude Code transcripts (numeric usage fields and timestamps only, no content read or copied). Confidence labels: `verified-executed` (I ran it), `verified-source` (read in the primary source, quoted), `reported` (secondary source or summary), `inferred` (my reasoning, no source).

Versions read: spec-kit `d2ddd910` (2026-09-30, release v1.0.13); Taskmaster `c0c98d36` (2026-04-23, release task-master-ai 0.43.1); CCPM `7d7e4623` (2026-03-18); OpenAI cookbook `articles/codex_exec_plans.md` (last change 2026-01-15); Kiro docs (page updated 2026-08-27); METR Time Horizon 1.1 data (page updated 2026-05-08); Claude Code docs and pricing as served 2026-09-30; local changelog cache `~/.claude/cache/changelog.md` (2.1.285).

---

## Summary for the designer

1. None of the five tools actually schedules. spec-kit and Kiro run phases or dependency "waves" as barriers, Taskmaster picks "next" by priority, then fewest dependencies, then ID, and CCPM greps YAML frontmatter with readiness scripts that are wrong. None models durations, resources, humans or deadlines. Take their data models, not their executors.
2. Adopt: spec-kit's stable `T001` IDs, story-sliced phases (the MVP-first cut order), FR/SC requirement IDs with a coverage check, and converge's rule that "completion claims are not evidence". From Taskmaster, JSON state whose dependencies point only at lower IDs. From CCPM, `conflicts_with` and file scopes. From Kiro, requirement references and required/optional tasks. From ExecPlans, the decision log and restartability. From Anthropic's harness, a JSON feature list that stays "failing" until proven.
3. Parallelism must be computed, not asserted. Two tasks may overlap only when no DAG path joins them, their declared write-sets are disjoint (with manifests and lockfiles counted as one shared resource), and they share no unary resource such as a signing wallet (nonce or UTXO), a port, a database or a human.
4. Scheduler: CPM plus Monte Carlo plus a resource-constrained parallel schedule generation scheme with an LFT/min-slack priority, tie-broken by longest remaining path, run online as dynamic list scheduling. Waves are reporting epochs, not barriers. In simulation, barriers added 12 to 63% to makespan (33 to 63% with 4 or more slots), and the owner's own workflow logs show a median 26% of slot time idle under barriers.
5. Plan to P80 or P90, never to the mean. With 4 or more slots, a deterministic CPM plan was met in only 24 to 44% of simulated runs (merge bias). Replan every epoch from actual/estimate ratios: a systematic 1.5x overrun was flagged in 68 to 93% of runs by 20% completion.
6. Sizing: each task stays within the model's 80% horizon (about one human-hour for early-2026 frontier models, per METR), runs about 15 to 45 min of agent wall time (the owner's build agents: p50 27 min, p90 46 min), and has one deliverable and one mechanical proof. Estimate time and tokens from the owner's 355 logged agents (median list-price cost: build $15, verify $2), not from benchmarks.
7. Runtime limits to design around: 16 agents per workflow run by default, no user input mid-run, no `Date.now()` inside workflow scripts, and 18 concurrent agents coincided with a 29.5-min API stall (which is why `/harden` caps at 4).

---

## Findings

### (a) GitHub spec-kit

**F01 — spec-kit's task line format and its `[P]` rule.** Every task is one checklist line with a sequential ID "in execution order", an optional `[P]`, and a story label for story-phase tasks. `[P]` is asserted by the generating LLM from two conditions: different files, and no dependency on incomplete tasks.
- Evidence: `templates/commands/tasks.md` (spec-kit `d2ddd910`) lines 151-168: "`- [ ] [TaskID] [P?] [Story?] Description with file path`" … "2. **Task ID**: Sequential number (T001, T002, T003...) in execution order 3. **[P] marker**: Include ONLY if task is parallelizable (different files, no dependencies on incomplete tasks) 4. **[Story] label**: REQUIRED for user story phase tasks only". Also `templates/tasks-template.md` line 18: "**[P]**: Can run in parallel (different files, no dependencies)". Line 141 of the command: "each task must be specific enough that an LLM can complete it without additional context." https://github.com/github/spec-kit/blob/d2ddd910266ad14afe79c5414c88ee316aca6e9a/templates/commands/tasks.md
- Confidence: verified-source. Load-bearing: no.

**F02 — spec-kit organises work by phases and user stories, and has no machine-readable per-task dependencies.** The phases are Setup, then Foundational (which blocks every story), then one phase per user story in priority order P1, P2, P3, then Polish. Each phase ends on a checkpoint. Dependencies appear only as prose and phase order. A request for explicit `(depends on T001)` metadata was closed as not planned.
- Evidence: `tasks-template.md` lines 62, 73, 168-171: "**⚠️ CRITICAL**: No user story work can begin until this phase is complete"; "**Checkpoint**: Foundation ready - user story implementation can now begin in parallel"; "**Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories … User stories can then proceed in parallel (if staffed) - Or sequentially in priority order (P1 → P2 → P3)". Line 94 writes a dependency only as prose: "Implement [Service] in src/services/[service].py (depends on T012, T013)". Issue github/spec-kit#1934, "Explicit task dependency declarations in tasks.md to enable parallel execution" (opened 2026-03-22), was closed NOT_PLANNED by the stale bot on 2026-09-25 (`gh issue view 1934`); its problem statement: "Agents cannot determine which tasks are independent and safe to run concurrently."
- Confidence: verified-source. Load-bearing: no.

**F03 — spec-kit orders tests before implementation, when tests exist at all.** Tests are optional unless the spec asks for them. When present, they are written first and must fail. Inside a story the order is Tests, Models, Services, Endpoints, Integration.
- Evidence: `tasks-template.md` line 12: "Tests are OPTIONAL - only include them if explicitly requested in the feature specification."; line 85: "**NOTE: Write these tests FIRST, ensure they FAIL before implementation**"; line 182: "Tests (if included) MUST be written and FAIL before implementation". `commands/tasks.md` line 212: "Within each story: Tests (if requested) → Models → Services → Endpoints → Integration".
- Confidence: verified-source. Load-bearing: no.

**F04 — spec-kit's implement step runs phases as barriers and lets the implementer tick its own boxes.**
- Evidence: `templates/commands/implement.md` lines 150-154: "**Phase-by-phase execution**: Complete each phase before moving to the next … **File-based coordination**: Tasks affecting the same files must run sequentially … **Validation checkpoints**: Verify each phase completion before proceeding". Lines 165-169: "Halt execution if any non-parallel task fails - For parallel tasks [P], continue with successful tasks, report failed ones … **IMPORTANT** For completed tasks, make sure to mark the task off as [X] in the tasks file."
- Confidence: verified-source. Load-bearing: no (it shows what to avoid: F20 measures the cost of barriers; self-marking contradicts the owner's rule).

**F05 — spec-kit checks completeness against the plan in two passes: `analyze` before implementation and `converge` after it.** `analyze` is read-only. It maps each FR-###/SC-### to tasks and flags "Requirements with zero associated tasks". `converge` (templates dated 2026) inspects the code against spec, plan and tasks, treats ticked boxes as claims, and appends remaining work as new tasks with a gap type. It never renumbers IDs.
- Evidence: `commands/analyze.md` lines 110, 140-144: "For each Functional Requirement (FR-###) and Success Criterion (SC-###), record a stable key" … "Requirements with zero associated tasks - Tasks with no mapped requirement/story". `commands/converge.md` lines 147-148: "Include every existing task in the intent inventory, regardless of checkbox state or Convergence phase: completion claims are not evidence."; lines 156-163 list the gap types `missing`, `partial`, `contradicts`, `unrequested`; line 225: "Never reuse or renumber existing IDs"; lines 82-83: "When the codebase already satisfies everything, the command MUST leave `tasks.md` **byte-for-byte unchanged**". The last change to converge.md is "fix: clarify converge assessment of completion claims (#4621)", 2026-09-18.
- Confidence: verified-source. Load-bearing: **yes**. This is the closest existing implementation of the owner's rule "completeness is proven against the plan, never against the test suite".

### (b) Taskmaster (eyaltoledano/claude-task-master)

**F06 — Taskmaster's `tasks.json` schema.** Required fields: `id`, `title`, `description`, `status`. Optional fields: `dependencies`, `priority`, `details`, `testStrategy` (prose) and `subtasks`, which are one level deep and cannot nest. The typed core adds effort, assignee, tags, a complexity score and implementation metadata. Tasks live in tagged lists that are isolated from each other and numbered independently.
- Evidence: `docs/task-structure.md` lines 210, 225: "Valid values: `"pending"`, `"in-progress"`, `"done"`, `"review"`, `"deferred"`, `"cancelled"`"; "Valid values: `"high"`, `"medium"`, `"low"`". The typed core, `packages/tm-core/src/common/types/index.ts` lines 20-38, widens these to `TaskStatus = 'pending' | 'in-progress' | 'done' | 'deferred' | 'cancelled' | 'blocked' | 'review' | 'completed'` and `TaskPriority = 'low' | 'medium' | 'high' | 'critical'`. Lines 131-175 hold `Task` (`effort?`, `actualEffort?`, `assignee?`, `complexity?: TaskComplexity | number`, `metadata?`) and `Subtask` (`subtasks?: never; // Subtasks cannot have their own subtasks`). Lines 47-54: `RelevantFile.action: 'create' | 'modify' | 'reference'`. `task-structure.md` lines 363-365: "**Independent Numbering**: Each tag has its own task ID sequence starting from 1 - **Parallel Development**: Multiple team members can work on separate tags without conflicts".
- Confidence: verified-source. Load-bearing: no.

**F07 — Taskmaster's next-task rule ignores the critical path.** A task is eligible when its status is pending or in-progress and all its dependencies are done. Candidates are sorted by priority, then by fewest dependencies, then by lowest ID. Nothing in the rule looks at durations, successors or deadlines.
- Evidence: `scripts/modules/task-manager/find-next-task.js` lines 83-97 and 118-128: "// sort by priority → dep-count → parent-id → sub-id" … `const nextTask = eligibleTasks.sort((a, b) => { const pa = priorityValues[a.priority || 'medium'] ?? 2; … if (da !== db) return da - db; return a.id - b.id; })[0];`. In my simulation (F20), this ordering came out 4.5% to 13% above the lower bound when slots are scarce (m = 4), against 1% to 4% for critical-path priority.
- Confidence: verified-source (rule) and verified-executed (cost). Load-bearing: **yes**. The dispatcher must rank by remaining critical path and slack, not by dependency count.

**F08 — Taskmaster's PRD parsing and complexity analysis.** Parsing defaults to about 10 top-level tasks, and IDs are topological: a task may depend only on lower IDs, so the graph is acyclic by construction. The prompt contradicts itself on dependencies. Complexity is an LLM score from 1 to 10 with an expansion threshold of 5. It measures judged difficulty, not time.
- Evidence: `src/prompts/parse-prd.json`, system prompt: "Set status to 'pending', dependencies to an empty array [], and priority to '{{defaultTaskPriority}}' initially for all tasks." and then guideline 6: "Set appropriate dependency IDs (a task can only depend on tasks with lower IDs, potentially including existing tasks with IDs less than {{nextId}} if applicable)". `scripts/modules/config-manager.js` lines 52-53: `defaultNumTasks: 10, defaultSubtasks: 5`. `src/prompts/analyze-complexity.json`: `"threshold": {"type":"number","default":5,…}`, "complexityScore: A score from 1-10 indicating complexity - recommendedSubtasks: Number of subtasks recommended". Taskmaster also ships an "RPG" PRD template whose central section is an explicit dependency graph (`apps/docs/capabilities/rpg-method.mdx` lines 122-136: "Dependency Graph (CRITICAL) … Explicit 'depends on' declarations").
- Confidence: verified-source. Load-bearing: no. The "lower IDs only" rule is worth copying (see D1).

**F09 — Taskmaster's autonomous loop runs one task per fresh session, and the agent declares completion itself.**
- Evidence: `apps/docs/capabilities/loop.mdx` lines 50-61: "Spawns `claude -p <prompt>` as a fresh subprocess … The loop exits early when: - An agent outputs `<loop-complete>REASON</loop-complete>` - all work done". The default preset's steps (lines 121-127) are "Runs `task-master next` … Marks the task complete with `task-master set-status --id=<id> --status=done` … Commits work".
- Confidence: verified-source. Load-bearing: no. It shows the self-certification pattern the owner rejects, and the value of fresh context per task.

### (c) Kiro, CCPM and OpenAI ExecPlans

**F10 — Kiro runs tasks in dependency waves with barriers between them, and lets an LLM mark tasks complete by reading the code.** A spec holds `requirements.md` (EARS notation), `design.md` and `tasks.md`. "Run all tasks" groups independent tasks into waves; waves run one after another and the tasks inside a wave run together. Only required tasks run. "Sync Files", or a chat request, marks tasks complete after the model scans the codebase. Kiro's generated `tasks.md` links each task to requirements (`_Requirements: 1.1, 1.2_`), marks optional tasks `- [ ]*`, and inserts checkpoint tasks.
- Evidence: https://kiro.dev/docs/specs.md lines 93-99: "Kiro builds a **dependency graph** of the tasks in your `tasks.md` and groups independent tasks into **waves**: - **Wave 1** - all tasks with no dependencies … Waves execute sequentially; tasks within a wave execute concurrently." https://kiro.dev/docs/specs/best-practices.md lines 146 and 180-190: "This only runs incomplete tasks that are marked as required." … "ask Kiro: 'Check which tasks are already complete' - Kiro will analyze your codebase and identify implemented functionality - Kiro will automatically mark completed tasks". https://kiro.dev/docs/specs/feature-specs.md lines 105-110: "`WHEN [condition/event]` `THE SYSTEM SHALL [expected behavior]`". Task format, observed in a public Kiro-generated file (https://github.com/sebsto/wispr/blob/HEAD/.kiro/specs/cli-tool/tasks.md): "`- [ ] 1.1 Create the wispr-cli …` … `_Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_`", "`- [ ] 1b. Checkpoint — Verify ModelPaths sandbox resolution`", "`- [ ]* 2.2 Write unit tests for AudioFileDecoder`".
- Confidence: verified-source for the docs; reported for the task-file format (a user's repository, not the official docs). Load-bearing: **yes**. Waves as barriers cost measurable time (F20), and LLM-judged completion violates the owner's proof rule.

**F11 — CCPM's task schema has real parallelism metadata: `depends_on`, `parallel` and `conflicts_with`.** It caps an epic at about 10 tasks, splits issues into file-scoped streams worked by parallel agents in one worktree per epic, and never auto-resolves conflicts. Its Definition of Done is a checklist with no mechanical proof.
- Evidence: `skill/ccpm/references/conventions.md` lines 57-68: "`status: open | in-progress | closed` … `depends_on: []              # issue numbers this must wait for` `parallel: true              # can run concurrently with non-conflicting tasks` `conflicts_with: []          # issue numbers that touch the same files`". `references/plan.md` line 96: "Aim for ≤10 tasks total — prefer simplicity over completeness." `references/structure.md` lines 71-78 (effort "Size: XS/S/M/L/XL - Hours: N"; "Definition of Done - [ ] Code implemented - [ ] Tests written and passing - [ ] Code reviewed") and line 31 ("launch parallel agents (max 5 concurrent)"). `references/execute.md` lines 203-212: "Each agent works only on files in its assigned stream scope … Conflicts are never auto-resolved — agents report them and pause."
- Confidence: verified-source. Load-bearing: no.

**F12 — CCPM's readiness scripts get dependency state wrong.** `next.sh` lists a task as ready only when its `depends_on` is empty. `blocked.sh` reports every open task with a non-empty `depends_on` as blocked, even when all its dependencies are closed. A task whose dependencies are finished is therefore never offered as "next".
- Evidence: `skill/ccpm/references/scripts/next.sh` line 10 says "# Find tasks that are open and have no dependencies or whose dependencies are closed", but lines 35-36 test only emptiness: `if [ -z "$deps" ] || [ "$deps" = "depends_on:" ]; then`. `blocked.sh` lines 34-54 count the task as blocked whenever `deps` is non-empty and print "Waiting for" only if some dependency is still `open`.
- Confidence: verified-source (read, not executed). Load-bearing: no. The lesson: derive state from one validated file with a tested validator, not from ad-hoc greps.

**F13 — CCPM's speed claims are unsourced, and its own example is a dependency chain.**
- Evidence: CCPM `README.md` lines 144-160: "Agent 1: Database tables and migrations - Agent 2: Service layer and business logic - Agent 3: API endpoints and middleware - Agent 4: UI components and forms … | CCPM (parallel streams) | 5 | 1x |". Lines 372-376: "Teams using this system report: … **Up to 3× faster** feature delivery", with no source. The README's benchmark (lines 380-387) measures process compliance ("runs script, real data"), not delivery time.
- Confidence: verified-source for the text; inferred for the critique (a DB, service, API, UI chain cannot run as five parallel streams without stubs). Load-bearing: no.

**F14 — OpenAI's ExecPlans (PLANS.md) are self-contained living documents built for restart and multi-hour runs. They also tell the agent to resolve ambiguity on its own.**
- Evidence: https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md line 5: "very similar to one that has enabled Codex to work for more than seven hours from a single prompt"; line 34: "do not prompt the user for 'next steps'; simply proceed to the next milestone … Resolve ambiguities autonomously, and commit frequently."; line 36: "it should always be possible to restart from _only_ the ExecPlan and no other work."; line 74: "Validation is not optional."; line 82: "Each milestone must be independently verifiable"; line 87: "ExecPlans must contain and maintain a `Progress` section, a `Surprises & Discoveries` section, a `Decision Log`, and an `Outcomes & Retrospective` section."; lines 112-118: "Every stopping point must be documented here … Use timestamps to measure rates of progress."
- Confidence: verified-source. Load-bearing: no. "Resolve ambiguities autonomously" contradicts the owner's decision 2 (propose and wait), so `/execution` must not adopt that line.

**F15 — Anthropic's long-running-agent harness names the failure the owner's rule targets and fixes it with a JSON feature list.** Agents declare the whole project done too early, so every feature starts out failing in a JSON file. Agents may change only the pass flag, work on one feature at a time, and test end to end.
- Evidence: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents (2025-11-26): "Claude declares victory on the entire project too early. Set up a feature list file: based on the input spec, set up a structured JSON file with a list of end-to-end feature descriptions." "We prompt coding agents to edit this file only by changing the status of a passes field … we landed on using JSON for this, as the model is less likely to inappropriately change or overwrite JSON files compared to Markdown files." "the next iteration of the coding agent was then asked to work on only one feature at a time. This incremental approach turned out to be critical to addressing the agent's tendency to do too much at once." "Claude tended to make code changes, and even do testing with unit tests or curl commands against a development server, but would fail recognize that the feature didn't work end-to-end."
- Confidence: verified-source. Load-bearing: **yes**. Machine state should be JSON, every task should start "not proven", and each task should carry one feature.

### (d) Scheduling theory adapted to agent slots, humans, quota and deadlines

**F16 — Graham (1966): list scheduling has a bounded worst case, and the dynamic longest-chain rule is the classical critical-path dispatcher.** The same paper documents anomalies: more processors, or shorter tasks, can lengthen the total time.
- Evidence: Graham, "Bounds for Certain Multiprocessing Anomalies", *Bell System Technical Journal* 45(9):1563-1581, Nov 1966 (OCR at https://archive.org/details/bstj45-9-1563). Abstract: "an increase in the number of processing units can cause an increase in the total length of time needed to process a fixed set of tasks." Concluding remarks: "At any time a processor is free, it immediately begins to execute the 'ready' task (i.e., one which has all its predecessors completed) which currently heads the longest chain of unexecuted tasks (including itself) … It follows from what has been proved in this paper that ω*/ω ≤ 2 − (1/n)" and "the best possible bound on this ratio is given by … 2 − 2/(n+1)". The OCR garbles the inequality symbols; the bound values are legible.
- Confidence: verified-source. Load-bearing: **yes**. This is the dispatch rule D3 uses, and the anomalies are why the scheduler must re-simulate after every change instead of assuming that more slots help.

**F17 — Resource-constrained project scheduling (RCPSP) literature: the parallel schedule generation scheme with LFT or WCS priority is the standard single-pass heuristic.** The priority formulas are defined in closed form.
- Evidence: Kolisch & Hartmann, "Heuristic Algorithms for Solving the Resource-Constrained Project Scheduling Problem: Classification and Computational Analysis" (1999), PDF at https://www.hsba.de/fileadmin/user_upload/bereiche/_dokumente/6-forschung/profs-publikationen/Hartmann_1999_Heuristic_Algorithms_for_solving_the_resource-constrained_project_scheduling_problem.pdf. Table 3: "GRPW … pj + ∑ i∈Sj pi; LFT … LFj; LST … LFj−pj; MSLK … LFj−EFj; MTS … |Sj|; … WCS … LFj−pj− max E(i,j)". "The parallel scheduling scheme does time incrementation." "The two rules WCS and LFT give almost identical results when employed within the parallel SGS." "Generally, the results show that the best metaheuristic strategies outperform the best priority rule based sampling approaches."
- Confidence: verified-source. Load-bearing: **yes**. LFT/LST is simple, well tested and deadline-aware.

**F18 — RCPSP handles human availability through resource calendars.**
- Evidence: Kreter, Rieck & Zimmermann (2016), "Models and solution procedures for the resource-constrained project scheduling problem with general temporal constraints and calendars", *EJOR* 251(2):387-403 (https://ideas.repec.org/a/eee/ejores/v251y2016i2p387-403.html). Per the search summary, the paper "extends the resource-constrained project scheduling problem with general temporal constraints by incorporating break-calendars to account for possible absence of renewable resources" and "propose[s] a priority-rule method".
- Confidence: reported. Load-bearing: no. It supports modelling sleep, talks and travel as calendar breaks on the dev-A and dev-B resources.

**F19 — Three-point estimates and merge bias: a PERT or CPM total built from expected durations is optimistic wherever paths merge.** My simulation measures the size of the error on hackathon-shaped graphs.
- Evidence: the PERT expected time is te = (o + 4m + p)/6 (Malcolm, Roseboom, Clark & Fazar, "Application of a Technique for Research and Development Program Evaluation", *Operations Research* 7(5):646-669, 1959; formula as given at https://en.wikipedia.org/wiki/Program_evaluation_and_review_technique). MacCrimmon & Ryavec, "An Analytical Study of the PERT Assumptions", *Operations Research* 12(1):16-37, 1964 (https://pubsonline.informs.org/doi/10.1287/opre.12.1.16), per the summary: "calculating project duration from the path with the largest sum of expected times gives overly optimistic results." My run: layered random DAGs (24, 40 and 60 tasks), lognormal task sizes (median 30 min, σ 0.6), realised durations = estimate × lognormal(0, 0.55), 300 graphs × 40 draws per cell, CP-priority list scheduling. The realised mean makespan was 1.03-1.18× the deterministic plan computed from mean durations when m ≥ 4, and 1.12-1.18× when m ≥ 8. The deterministic plan was met in only 24-44% of runs when m ≥ 4 (24-37% when m ≥ 8, about 51% at m = 2).
- Confidence: reported (literature) and verified-executed (simulation). Load-bearing: **yes**. Deadlines must be checked against a Monte Carlo P80 or P90, not against CPM on means.

**F20 — Wave barriers against dynamic list scheduling: barriers waste slot time, and the owner's own logs show the straggler effect.**
- Evidence, simulation: same generator as F19, makespan divided by the lower bound max(critical path, total work ÷ m), averaged over 300 graphs per cell. Across all 12 cells, waves ranged from 1.12 to 1.63 (1.33 to 1.63 when m ≥ 4), critical-path list scheduling from 1.00 to 1.04, and the Taskmaster-like order from 1.00 to 1.13. Selected cells:

| tasks, width | m | waves with barriers (Kiro, spec-kit) | list, fewest-deps then ID (Taskmaster) | list, critical-path priority (Graham) |
|---|---|---|---|---|
| 24, ~4 | 4 | 1.353 | 1.045 | 1.012 |
| 40, ~6 | 4 | 1.542 | 1.133 | 1.038 |
| 40, ~6 | 8 | 1.506 | 1.006 | 1.000 |
| 60, ~8 | 8 | 1.631 | 1.033 | 1.005 |
| 60, ~8 | 16 | 1.603 | 1.000 | 1.000 |

- Evidence, owner's data: 37 workflow runs from the Hedera, BNB and XRPL builds (`~/.claude/projects/*/subagents/workflows/*/journal.jsonl` and agent transcripts), 45 phases with 3 or more agents. The slowest agent took a median 1.34× (p90 2.07×) the phase's median agent. Had each phase been a barrier, the idle share of slot time would have been a median 26% (p90 48%); in one "Refute" phase of 48 agents it was 63%.
- Evidence, vendor: Anthropic, "How we built our multi-agent research system" (2025-06-13): "our lead agents execute subagents synchronously, waiting for each set of subagents to complete before proceeding. This simplifies coordination, but creates bottlenecks … the entire system can be blocked while waiting for a single subagent to finish searching."
- Confidence: verified-executed (simulation and logs) and verified-source (Anthropic). Load-bearing: **yes**. Waves must not be synchronisation barriers.

**F21 — Early detection of a late build: systematic overrun shows up after 20-30% of tasks; random lateness does not.** Standard monitoring devices exist for this: the earned-schedule index SPI(t) and critical-chain fever-chart zones.
- Evidence, simulation (40 tasks, 6 slots, deadline set at the plan's Monte Carlo P80, 150 runs per bias level, forecast = Monte Carlo of the remaining DAG with estimates scaled by the geometric-mean actual/estimate ratio of completed tasks). "Detect" is the share of late runs flagged; "false alarm" is the share of on-time runs flagged:

| true bias | flag if P(on time) < | 20% done: detect / false alarm | 30% done | 50% done |
|---|---|---|---|---|
| 1.00 (noise only) | 0.5 | 11% / 9% | 11% / 5% | 25% / 2% |
| 1.00 | 0.8 | 32% / 27% | 36% / 26% | 71% / 23% |
| 1.25 | 0.5 | 28% / 27% | 42% / 23% | 55% / 27% |
| 1.25 | 0.8 | 63% / 72% | 73% / 75% | 83% / 75% |
| 1.50 | 0.5 | 68% / 50% | 81% / 43% | 85% / 43% |
| 1.50 | 0.8 | 93% / 64% | 96% / 64% | 98% / 71% |

  Under bias, a "false alarm" is a run that was at risk and finished on time by luck, so it is not a wasted question.
- Evidence, literature: Lipke, "Schedule is Different", *The Measurable News*, March 2003: SPI(t) = ES/AT, and traditional SPI($) converges to 1.0 at completion even on late projects (reported via https://en.wikipedia.org/wiki/Earned_schedule and https://www.earnedschedule.com/Docs/Lipke-introduction-to-earned-schedule-utd.pdf). Critical chain (Goldratt, 1997) sizes a project buffer and tracks "buffer consumption (y-axis) against project completion (x-axis), with green/yellow/red zones"; common thresholds are thirds: watch, plan, act (reported via https://www.smartsheet.com/content/critical-chain-method and https://umbrex.com/resources/frameworks/project-management-frameworks/critical-chain-project-management-ccpm/).
- Confidence: verified-executed (simulation) and reported (literature). Load-bearing: **yes**. Replan after every epoch with the observed ratio, and keep an explicit buffer, because noise-driven lateness cannot be caught early.

**F22 — The Claude Code workflow runtime bounds and shapes any schedule.**
- Evidence: https://code.claude.com/docs/en/workflows.md, "Behavior and limits" (line 365): "Up to 16 concurrent agents by default, fewer when Claude Code has fewer CPUs available … set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` to a value from 1 to 256". Line 363: "No mid-run user input | A run pauses on its own only for agent permission prompts and a usage-limit wait. For sign-off between stages, run each stage as its own workflow". Line 334: "Claude Code makes `Date.now()`, `Math.random()`, and a no-argument `new Date()` throw inside the script, so that a relaunched run repeats the same `agent()` calls." Line 399: "When an agent hits your claude.ai usage limit, the run pauses rather than failing that agent … Requires Claude Code v2.1.271 or later". Line 416: "When a workflow schedules more than 25 agents, or its projected token total passes 1.5 million, its progress line … shows a `Large workflow` warning." "1,000 agents total per run". Size guideline table: "`medium` | Fewer than 10 agents" (the default). https://code.claude.com/docs/en/env-vars.md line 404: "queued `agent()` calls wait for a free slot"; line 305: `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` "(default: 20)". This machine has 16 logical CPUs (`nproc` = 16), so the workflow default is 16.
- Confidence: verified-source. Load-bearing: **yes**. Four consequences follow. A manual task ends a workflow run. Clock-anchored tasks (the demo audit at T-6h, channel re-reads) must be launched by the orchestrator, not by a script timer. Monte Carlo cannot run inside a workflow script. Priority order across more than m ready tasks must be enforced by the script, because the documentation does not state the runtime's queue order.

**F23 — The practical agent concurrency on this account is well below the runtime cap.**
- Evidence: `~/.claude/skills/harden/research/pilot-auto-calibration.md` line 303: "at most 18 subagents ran at once … The main session then stalled 29.5 minutes on 'API Error: The response stopped arriving' … Both are correlations, not measured causes." `~/.claude/skills/harden/SKILL.md` line 262: "At most `detection.max_concurrent_subagents` subagents (default 4) run at once (A01-F35)". In the owner's 37 hackathon workflow runs (my mining pass), agents per run had median 6, p90 15, max 55, and the most agents running at once had median 3, p90 8, max 14.
- Confidence: verified-source and verified-executed. Load-bearing: **yes**. Plan with m = 4 to 8 agents per machine and let a rehearsal decide.

### (e) Sizing work items for LLM agents, and their token cost

**F24 — METR time horizons (TH 1.1, updated 2026-05-08).** For early-2026 frontier models the 50% horizon is several hours of human-expert time, but the 80% horizon is about 50-90 minutes. Frontier horizons double roughly every 4 months.
- Evidence: raw data https://metr.org/assets/benchmark_results_1_1.yaml (linked from https://metr.org/time-horizons/), in minutes. Claude Opus 4.5: p50 293, p80 49.4. GPT-5.2: 352, 66.0. Claude Opus 4.6: 718.8 (CI 316.7-3633.8), 69.9 (CI 27.0-170.4). GPT-5.4: 341.7, 53.9. Gemini 3.1 Pro: 384.1, 89.8. Claude Mythos Preview (early): 1044.8, 185.9. Doubling time: "from_2023_on: point_estimate: 128.744" days (CI 104-158). The TH1.1 post (https://metr.org/blog/2026-1-29-time-horizon-1-1/) gives "P50 doubling time, >=2024 … 88.6 days". The page warns "Measurements above 16 hrs are unreliable with our current task suite", and the tasks are "self-contained and well-specified, with clear success criteria that can be automatically evaluated", timed by "low or no prior context" humans. Claude Opus 5.5 (the owner's model) and Opus 4.7/4.8 are not measured ("Some recent models that don't currently have time horizons: Claude Opus 4.7 …").
- Confidence: verified-source. Load-bearing: **yes**. It sets the upper bound on task size.

**F25 — Success probability by task length implied by METR's fits.** METR fits a logistic in log task length, so each model's p50 and p80 give its slope β = ln 4 / ln(h50/h80).

| model | 15 min | 30 min | 60 min | 120 min | 240 min | 480 min |
|---|---|---|---|---|---|---|
| Claude Opus 4.5 | 91% | 86% | 77% | 67% | 54% | 41% |
| Claude Opus 4.6 | 91% | 87% | 81% | 74% | 66% | 56% |
| GPT-5.4 | 91% | 86% | 79% | 69% | 57% | 44% |
| Gemini 3.1 Pro | 96% | 92% | 85% | 75% | 61% | 45% |
| Claude Mythos Preview (early) | 97% | 95% | 91% | 85% | 77% | 65% |

- Evidence: computed in memory from F24's point estimates. METR describes the method: "For each agent, we fit a logistic curve to predict the probability it successfully completes tasks as a function of human task duration." These are clean, algorithmically scored tasks, so real success will be lower (F26).
- Confidence: verified-executed (reconstruction of METR's model form; point estimates only, no CI). Load-bearing: **yes**. A 60-minute human-equivalent task succeeds on the first try only about 4 times in 5, so retries and buffers are part of the plan, not exceptions.

**F26 — Passing tests is not "done" (METR, algorithmic against holistic scoring).**
- Evidence: https://metr.org/blog/2025-08-12-research-update-towards-reconciling-slowdown-with-time-horizons/: "Claude 3.7 Sonnet … has an average success rate of 38% (±19%, 95% CI) on these issues, as measured by the maintainer-written test cases … However, when manually reviewing a subset of these PRs, none of them are mergeable as-is." "When filtering to runs where the agent passed the human-written test cases, we estimate that these PRs would take on average 26 minutes to fix (with a minimum time of 15 minutes)" against "1.3 hours" for the original task.
- Confidence: verified-source (early-2025 model, 18 tasks). Load-bearing: **yes**. Proofs must test observable behaviour end to end, not only unit tests, and the independent `/harden` pass after the build stays necessary.

**F27 — Vendor sizing guidance converges on self-contained units with a clear deliverable, a few per worker, each doable by a human in a few hours at most.**
- Evidence: https://code.claude.com/docs/en/agent-teams.md lines 371-382: "Start with 3-5 teammates for most workflows … **Too small**: coordination overhead exceeds the benefit - **Too large**: teammates work too long without check-ins … **Just right**: self-contained units that produce a clear deliverable, such as a function, a test file, or a review … Having 5-6 tasks per teammate keeps everyone productive"; line 399: "Two teammates editing the same file leads to overwrites." https://docs.devin.ai/essential-guidelines/when-to-use-devin: "As a rule of thumb: if a task would take you three hours or less, Devin can most likely do it. For longer tasks, break them into smaller sessions." and "Try to keep sessions focused (XS, S, or M as measured by Session Insights)", where M is "≤ 10 ACUs" (https://docs.devin.ai/product-guides/session-insights). Anthropic's multi-agent post: "Simple fact-finding requires just 1 agent with 3-10 tool calls, direct comparisons might need 2-4 subagents with 10-15 calls each, and complex research might use more than 10 subagents".
- Confidence: verified-source (vendor guidance, no measurement). Load-bearing: no.

**F28 — The owner's own reference class: 355 agent runs from three September 2026 hackathon builds.** These give three-point duration and cost priors per kind of task.
- Evidence, my mining pass over `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-{Hedera,BNB,XRPL-Hackathon-2026}/*/subagents/**/agent-*.jsonl`: 338 workflow agents plus 17 subagents. Kinds are classified by the workflow phase label (Verify 61, Refute 57, Review 26, Probe 18, Research 17, Write 15, Build 11, …).
  - Wall time p10 / p50 / p90: build 6.2 / 26.7 / 46.0 min (n = 38); verify 1.6 / 6.7 / 31.1 min (n = 169); research 13.0 / 24.9 / 40.6 min (n = 62).
  - List-price cost per agent, by description classifier: Opus 5 build median $15.18 (p90 $38.65, n = 53); Opus 5 verify $2.17 (p90 $17.67, n = 168); Opus 5 research $5.27; Fable 5.1 build $19.49; Sonnet 5 small checks $0.12-0.16.
  - Totals: $3,249 at list price over 118 agent-hours. The costliest 10% of agents account for 40% of the cost.
  - Verification-type agents outnumber build agents by about 3 to 4.5 times: 169 to 38 by phase label, 185 to 63 by description classifier.
- Confidence: verified-executed. The classification is keyword-based, and list price is not subscription usage. Load-bearing: **yes**. These are the priors the estimator should start from, and verification capacity has to be planned explicitly.

**F29 — What drives token cost, and how cost scales with task length.** Context re-reading dominates tokens and cost, and cost per minute rises mildly with task length.
- Evidence (mining pass, Opus 5 agents): 97% of tokens are cache reads. Cost share: cache reads 66%, cache writes 18%, output 16%. log(cost) against log(wall minutes) has slope 1.08 (r = 0.93, n = 287); against log(API calls), slope 1.13. Median $ per agent-minute: 0.35 under 10 min, 0.30 at 10-20 min, 0.43 at 20-40 min, 0.53 at 40-80 min, 0.58 above 80 min.
- Confidence: verified-executed. Load-bearing: no. It gives a usable estimator (cost ≈ rate(model, length) × minutes) and a second reason to keep tasks short and agent context lean.

**F30 — Token cost by model tier.** Cheaper tiers take more steps, so the cost gap per task is much smaller than the price gap.
- Evidence: SWE-bench Verified bash-only leaderboard, mini-SWE-agent, one attempt (https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/HEAD/data/leaderboards.json), `instance_cost` and `instance_calls`: Claude 4.6 Opus $0.552 / 28.9 calls / 75.6% resolved; Claude 4.5 Opus (high) $0.754 / 32.9 / 76.8%; Claude 4.5 Sonnet (high) $0.658 / 48.3 / 71.4%; Claude 4.5 Haiku (high) $0.331 / 66.2 / 66.6%. Haiku's input price is one fifth of Opus 4.5's, yet its cost per task is about 0.44×. Verified tasks are small: 194 under 15 min, 261 at 15 min-1 h, 42 at 1-4 h, 3 over 4 h of human time (reported via https://jatinganhotra.dev/blog/swe-agents/2025/04/15/swe-bench-verified-easy-medium-hard.html, from OpenAI's annotations).
- Current list prices, https://platform.claude.com/docs/en/about-claude/pricing.md, in the order input / 5m cache write / 1h cache write / cache hit / output: "Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok"; "Claude Sonnet 5.5 | $2 … $0.20 … $10"; "Claude Haiku 4.5 | $1 … $0.10 … $5"; "Claude Fable 5.1 | $10 … $0.25 … $50".
- Fast mode: "Fast mode delivers up to 2.5x higher output tokens per second from Claude Opus 5.5 … at premium pricing" ($8 / $40), and in Claude Code "fast mode is available via usage credits only and not included in the subscription rate limits" (https://code.claude.com/docs/en/fast-mode.md line 24).
- Claude Code costs doc: "the average cost is around $13 per developer per active day"; "Agent teams use approximately 7x more tokens than standard sessions when teammates run in plan mode" (https://code.claude.com/docs/en/costs.md lines 11, 328).
- Confidence: verified-source. Load-bearing: no. Benchmark task costs are 20 to 30 times lower than the owner's build agents (F28), so estimate from the owner's own logs.

**F31 — Claude Code effort levels are the allowed values for the schema's effort field.**
- Evidence: https://code.claude.com/docs/en/model-config.md lines 571-575: "Opus 5.5, Sonnet 5.5, Opus 5, Sonnet 5, Opus 4.8, and Opus 4.7 | `low`, `medium`, `high`, `xhigh`, `max`". Lines 633-639: "`medium` | The default on Opus 5.5 and Sonnet 5.5, where it fits day-to-day engineering work with a clear scope … `high` | Work where verification matters or edge cases are likely … `max` | … may show diminishing returns and is prone to overthinking". The `/harden` pilots found cheaper models missing findings: "the 65 Haiku passes missed D05, D18, D19 and D25, and the first pilot's Opus orchestrator had found D05, D18 and D19" (`~/.claude/skills/harden/research/pilot-auto-calibration.md` line 311).
- Confidence: verified-source. Load-bearing: no.

**F32 — Hazards that break parallelism even when two tasks write different files.**
- Evidence: ethers v6 NonceManager (`src.ts/providers/signer-noncemanager.ts`, https://github.com/ethers-io/ethers.js): "automatically manages the nonce, ensuring serialized and sequential nonces are used during transaction." Cardano docs (https://docs.cardano.org/about-cardano/explore-more/concurrency): "The level of concurrency sets the limit for simultaneous operations. Developers should adopt strategies to minimize contention". Agent-teams doc: "Two teammates editing the same file leads to overwrites." spec-kit implement: "Tasks affecting the same files must run sequentially". Shared manifests are my inference: a `package.json` or lockfile that two "different-file" tasks both edit through the package manager is a hidden conflict. The C: drive had 5.8 GB free during this research (`df -h /c`), and the owner reports that parallel installs and Docker have filled it before.
- Confidence: verified-source (nonce, overwrites) and inferred (manifests, disk). Load-bearing: **yes**. The parallelism rule must include unary resources and shared manifests, not only file paths.

**F33 — The owner's prior art already defines the proof discipline `/execution` must automate.**
- Evidence: `C:/Users/Utilisateur/Documents/Coding/Hedera/research/findings/TASKLIST.md` lines 3-5: "a box is ticked only when its **proof** column is satisfied (a command with exit 0, a transaction hash re-read on the mirror node, a green CI run, a link that resolves); 'C' = Claude does it, 'A' = Alexandre does it. Dates are the latest acceptable". `C:/Users/Utilisateur/Documents/Coding/BNB/holdover/scripts/completion-check.mjs` lines 15-17: "DELIBERATELY NOT IN CI. This is red for most of a project's life, on purpose"; lines 173-177 (gate G6): "Nothing mechanical was watching that date. The gate list was written from the artifact list and inherited its blind spot"; lines 77-85: every gate carries `id`, `title`, `ifDropped` and a `check()` returning `{ ok, detail }`.
- Confidence: verified-source. Load-bearing: **yes**. The plan should generate this completion check, including clock gates for irrecoverable deadlines.

**F34 — `/harden`'s research has already settled how an independent verifier should work.**
- Evidence: `~/.claude/skills/harden/research/reviewer-independence.md` G201-F12 (line 125): "The verifier must re-run any tool it cites. It never accepts tool results quoted in comments, commit messages or the author's report." G201-F17 (line 524): "Before trusting tests as evidence, check that the authoring agent did not weaken them". G201-F02 (line 591): "Run the verifier in a fresh context without the author's reasoning". G201-F01 (line 236): "Never count a same-family verifier's approval as independent evidence".
- Confidence: verified-source (the grades are inside that file). Load-bearing: no. It is reused by D1 and D6.

**F35 — The work after "build complete" has a measured length, and it must be reserved before the deadline.**
- Evidence: `~/.claude/skills/harden/research/pilot-auto-calibration.md` line 286: "second pilot … over 157.5 minutes that include a 29.5-minute API stall. Time in the nine v3 runs … median total 114.7 minutes". The owner's global rule: "Order: build complete → harden → fix → record → ship." Decision 5: README screenshots are last.
- Confidence: verified-source. Load-bearing: **yes**. "Build complete" gets its own deadline, backward-computed from submission (D5).

---

## Implications for /execution

### D1. Task schema: fields and allowed values

The local source of truth is JSON (F15), mirrored to Notion for humans and the phone. One object per task:

| field | type and allowed values | why (source) |
|---|---|---|
| `id` | `T001`… (pattern `T` + 3 or more digits), assigned in topological order, never reused or renumbered | spec-kit IDs and converge's "Never reuse or renumber" (F01, F05); Taskmaster's "only depend on tasks with lower IDs" makes the graph acyclic by construction (F08) |
| `title`, `description` | imperative text; the description names exact paths | spec-kit "Description with file path" (F01) |
| `covers` | list of requirement refs: `FR-001`, `SC-002`, `US1/AC2`, or a Kiro-style `R1.1`; at least one, except for ops/deliverable tasks | spec-kit analyze coverage (F05); Kiro `_Requirements:_` (F10) |
| `story`, `story_priority` | `US1`…; `P1` / `P2` / `P3`; `setup` / `foundational` / `polish` for non-story tasks | spec-kit story phases make the MVP-first cut order (F02) |
| `kind` | `build` / `test` (proof authoring) / `verify` / `research` / `ops` (deploy, transaction, CI dispatch) / `manual` / `watch` (recurring re-read) / `gate` (checkpoint) / `deliverable` (README screenshots, video) | reference classes differ by kind (F28); manual and clock-anchored work is handled differently (F22) |
| `required` | `true` / `false` | Kiro required against optional (F10); feeds cut proposals |
| `owner` | `agent` / `devA` / `devB` | owner's TASKLIST C/A (F33) and decision 4 |
| `executor` | `devA-machine` / `devB-machine` (for agent tasks) | two agent-slot pools, two quotas (inferred) |
| `depends_on` | list of lower IDs (finish-to-start); optional `lag_min` | CCPM `depends_on` (F11); general temporal constraints (F18) |
| `release_utc` | ISO-8601 UTC or null: earliest start (event start under prior-work rules; an anchor for clock tasks) | RCPSP release dates (F17, F18) |
| `deadline_utc` | ISO-8601 UTC or null: latest finish (submission; "build complete"; T-6h audit) | owner's "latest date" column (F33) |
| `anchor` | null or `{relative_to: <deadline id>, offset_min, recurrence}` for clock tasks such as the demo audit at T-6h and channel re-reads | hackathon cadence; the script cannot read the clock (F22) |
| `writes` | list of globs the task may modify | spec-kit and CCPM file rules (F01, F11) |
| `resources` | list of unary resource names, for example `manifest`, `wallet:testnet-deployer`, `port:3000`, `db:local`, `browser:devA`, `disk-heavy` | nonce and UTXO contention, overwrites, disk (F32) |
| `estimate` | `{p10_min, p50_min, p90_min, source: reference-class/<kind> or human or llm}`, plus `human_equiv_min` for sizing | three-point estimates and merge bias (F19); reference class (F28); METR sizing (F24) |
| `tokens_est` | `{usd_list, basis}` from the per-minute rate by model (F29) | F28-F30 |
| `model` | `opus-5.5` / `sonnet-5.5` / `haiku-4.5` / `fable-5.1` / `inherit` | prices (F30) |
| `effort` | `low` / `medium` / `high` / `xhigh` / `max` | Claude Code values (F31) |
| `fast_mode` | `true` / `false` (critical-path "crash" option paid from usage credits) | F30 |
| `proof` | `{type: command / tx / ci / file / url / human-attest, spec: {…}, max_runtime_min, negative_control}`. Examples: `command` means exit code 0 plus an output pattern; `tx` means a chain, a hash taken from a receipt file, and a re-read command; `ci` means workflow + SHA and conclusion = success; `human-attest` means an evidence file path plus the confirming dev | TASKLIST proof column, completion-check gates (F33); ExecPlan's "expected outputs" (F14) |
| `proof_hash` | hash of the proof artifact (test file or check script), frozen at approval or when the proof task finishes | stops the author from weakening its own proof (F34 G201-F17; F15) |
| `verifier` | `{by: agent-not-author, context: fresh, model, effort}` | F34 |
| `status` | `planned` / `ready` / `claimed` / `running` / `built` (author finished, proof not yet checked) / `verifying` / `done` (proof re-run by the verifier) / `failed` / `blocked-manual` / `blocked-decision` / `cut-proposed` / `cut` / `superseded` | "completion claims are not evidence" (F05); Taskmaster and CCPM statuses (F06, F11) extended with the built/done split |
| `attempts`, `max_attempts` | integer; default 2 before escalation | success below 100% even at 30-60 min (F25) |
| `claim` | `{by, at_utc, lease_until_utc}` | two-dev coordination; agent-teams claiming uses locking (inferred for Notion) |
| `actual` | `{started_utc, finished_utc, wall_min, tokens, usd_list, verifier_verdict, evidence_path}` | recalibration (F21, F28) |
| `wave` | integer, computed (reporting epoch), never an input | F20 |
| `decisions` | links into the decision log | ExecPlan Decision Log (F14) |

The validator refuses a plan in any of these cases (F12 is why state checks must be mechanical):
- a cycle;
- a dependency on an ID that is not lower;
- a task without a proof, owner or estimate;
- a requirement with no covering task;
- two tasks with overlapping `writes` or shared `resources` and no dependency between them, unless the conflict is explicitly allowed.

### D2. Parallelism rule

Two tasks X and Y may overlap in time only when all of the following hold:
1. Neither is an ancestor of the other in the transitive closure of `depends_on`. This is spec-kit's "no dependencies on incomplete tasks", made exact (F01).
2. Their `writes` globs, expanded against the tree, are disjoint (spec-kit, CCPM, agent teams: F01, F11, F27).
3. They share no name in `resources`. Every task that adds or removes a dependency, touches workspace config, CI workflows, migration numbering or generated code declares `manifest`. Every task that signs with a given account declares `wallet:<name>` (F32).
4. At most one running task per executor holds `disk-heavy` while free disk is under a threshold. 5.8 GB was free today (F32).
5. When both write code on one machine, each runs in its own worktree or branch, and a separate integration task merges the results. CCPM's many-agents-in-one-worktree only works through strict file scoping, and conflicts are "never auto-resolved" (F11).

`[P]` is displayed as the result of this rule. It is never an LLM-declared input (F01, F12).

### D3. Scheduling algorithm

This combines CPM, Monte Carlo and a parallel schedule generation scheme with LFT priority, run as dynamic list scheduling.
1. **Validate** the plan (D1).
2. **Estimate.** Each task gets a lognormal from its reference class: μ = ln p50, σ = ln(p90/p50)/1.2816 (F28). Human-provided estimates are recalibrated by the historical ratio. PERT te is for display only (F19).
3. **CPM.** Run the forward pass from release times and the backward pass from each deadline (LF = min(own deadline, successors' LS)). This gives ES/EF/LS/LF and total slack. Negative slack means the plan is infeasible. Cut proposals then go into the plan the user approves, before execution (decision 2).
4. **Priority key.** Rank by LST = LF − p, ascending (Kolisch & Hartmann's LST and LFT rules, F17). Break ties by longest remaining path, descending (Graham's "heads the longest chain", F16), then by most total successors (MTS, F17), then by lowest ID. Add a boost for tasks that unblock a manual task inside its owner's next availability window, because humans are the scarcest resource (inferred; the calendars come from F18).
5. **Resources.** Agent slots per executor are m_A and m_B (default 4 to 8, never above the runtime cap of 16; F22, F23). The humans A and B follow calendars with breaks for sleep, talks and travel (F18). The unary resources come from D2. The quota is treated as soft: a workflow pauses at the limit and resumes (F22).
6. **Monte Carlo.** Draw K = 500 to 1,000 samples through the same dispatcher. The outputs are P50/P80/P90 per deadline, a criticality index per task (the share of samples in which it lies on the critical path), and each deadline's buffer (P90 − P50). This is the only honest answer to merge bias (F19). It runs as a deterministic script invoked by the orchestrator (house style: `/harden`'s `budget.py`), because workflow scripts cannot read the clock or draw random numbers (F22).
7. **Online dispatch.** On each event (slot free, proof verified, human report, timer), start the highest-priority ready tasks while D2 holds. Ready means every predecessor is `done` (verified). Waves never act as barriers (F20). A workflow run is one "wave" of dispatch. It ends when the ready set is exhausted, when a manual task blocks, or after a time box of about 60 to 90 minutes, whichever comes first. Clock-anchored tasks (anchors) are fired by the orchestrator's timers (F22).
8. **After each wave.** Record actuals. Update each kind's actual/estimate ratio as a geometric mean. Rerun steps 3 to 6 and push the Notion report (decision 7).
9. **Crashing options when the critical path slips** (Kelley's time-cost trade-off, applied): fast mode on tasks with a high criticality index (F30); splitting a critical task in two when D2 allows; moving non-critical verifications off the critical path. Each option is proposed to the user, never applied as a scope cut on its own authority (decision 2).

### D4. Sizing rule

A task is ready to schedule only when all of the following hold:
- **S1.** Its human-equivalent size is within the executing model's 80% horizon. For early-2026 frontier models that is about 50-90 min, so cap at 60 min. Integration or ill-specified work gets half that, because clean benchmark tasks overstate real success (F24-F26).
- **S2.** Its reference-class p90 agent wall time is 60 min or less. The owner's build p90 is 46 min. Split anything estimated above that (F28), because cost per minute grows beyond 40 min (F29).
- **S3.** It has one deliverable and one mechanical proof that runs in 5 minutes or less (verification p50 is 6.7 min; F28). "One feature at a time" (F15).
- **S4.** It is not split below about 15 min of agent time unless D2 (file ownership) or the critical path requires it. Each extra task adds a verifier run (median about $2 and 7 min) plus context-load overhead (F28, F29), and agent teams warn that "coordination overhead exceeds the benefit" (F27).
- **S5.** Operations with external latency (deploy, transaction confirmation, CI run, indexer lag) are separate `ops` tasks whose proofs re-read the external state (F33).
- **S6. Inferred.** For a 36-hour event, expect about 25 to 60 tasks with 5 to 6 tasks per slot (F27). The plan is too coarse if any story has only one task and no proof task, and too fine if verifications exceed build work by more than about 4.5 to 1. The owner's historical ratio is 3 to 4.5 to 1 (F28).

Model and effort defaults, to be confirmed in rehearsal:
- critical-path build: Opus 5.5 at `high`;
- other build: Opus 5.5 at `medium`;
- verifier: a fresh-context Opus 5.5 at `medium` or `high`;
- purely mechanical checks (exit code, file exists, HTTP 200): run by the orchestrator's script with no LLM;
- no Haiku for judgement-bearing verification (F31).

### D5. Behind-schedule and cut protocol

- Derive the "build complete" deadline backward from submission: submission − (README screenshots + video recording + `/prose` + `/harden` P80 + fix time + buffer). `/harden` alone had a median of 114.7 min in v3 runs (F35).
- Zones after each wave, by P(on time) for every hard deadline: **green** at 0.8 or above; **yellow** from 0.5 to 0.8 (report, prepare cut options, keep running); **red** below 0.5 (propose a cut and wait, and keep running every task that is not affected). This mirrors fever-chart thirds (F21). The table in F21 is the evidence for the thresholds: at 0.5, noise-only false alarms stay at 2 to 9%. False alarms only cost a question, because decision 2 makes a cut a proposal, not an action.
- Cut candidates come in story-priority order: optional first, then P3, then P2. Only tasks off the must-have critical path qualify.
- Each optional story gets a **decision deadline**: the latest time a cut still saves the hard deadline, computed from the Monte Carlo. The Notion report shows these, so the user can decide from the phone before the choice is forced (inferred).
- Calibrate early: the first wave should include short, representative build tasks. Systematic overrun is only detectable after about 20 to 30% of tasks complete (F21).

### D6. What "proven complete" means

- A task is `done` only when an agent that did not write it re-ran the proof in a fresh context, saw the expected result, and found the proof artifact's hash unchanged (F34; spec-kit's "completion claims are not evidence", F05).
- The plan is complete only when every requirement ID is covered by at least one `done` task (spec-kit analyze coverage, F05), and an independent convergence pass finds no `missing` or `partial` gap (spec-kit converge, F05). That pass appends new tasks when it does find gaps.
- The generated `completion-check` (the owner's prior art, F33) then exits 0. It contains one gate per requirement, one gate per irrecoverable deadline, and the TODO scan.
- Proof-first: a task's proof artifact (test or check script) is written by a different agent than the implementer. When it is a test, it must fail before the implementation, and that failure is recorded as the negative control (spec-kit's "ensure they FAIL", F03; the owner's planted-defect practice, F33).

### D7. What to adopt and what to reject

| source | adopt | reject |
|---|---|---|
| spec-kit | stable IDs; story phases as the cut order; FR/SC coverage (analyze); converge's gap types and append-only rule | phase barriers; implementer self-ticking `[X]`; LLM-asserted `[P]`; tests optional |
| Taskmaster | JSON schema; dependencies only on lower IDs; tags (dev A and dev B contexts); `relevantFiles.action` | next-task by priority and dependency count; complexity score used as if it were time; prose `testStrategy`; self-declared loop completion |
| Kiro | EARS acceptance criteria; requirement refs; required/optional; checkpoint tasks | wave barriers; LLM "Sync Files" completion |
| CCPM | `depends_on` / `conflicts_with`; file-scoped streams; "conflicts never auto-resolved"; GitHub issues as a shared view | shell-grep state (it is buggy, F12); many agents in one worktree; unsourced speedups |
| ExecPlans | self-contained restartable plan; Decision Log; timestamped Progress; Surprises; prototype milestones for unknowns | "resolve ambiguities autonomously"; prose-first narrative as the machine state |
| Anthropic harness | JSON feature list starting as failing; one feature per agent; end-to-end testing | nothing specific |

---

## Risks and failure modes

- **Estimates anchored on benchmarks.** SWE-bench tasks cost about $0.55 each; the owner's build agents cost a median $15 (F28, F30). Estimate from the owner's reference class and recalibrate after every wave.
- **Merge bias.** With 4 or more slots, a plan built from mean durations was late in 56 to 76% of simulated runs (F19). Show P80 or P90 to the user, never the CPM total.
- **Barrier waste.** "Wave after wave" read as a barrier costs 33 to 63% of makespan with 4 or more slots (F20). The word "wave" must mean a reporting epoch or a workflow-run boundary.
- **Hidden shared resources.** A lockfile, a testnet signer's nonce or UTXOs, a dev server port, the browser profile used for screenshots, or free disk can make "different files" tasks collide (F32). Graham's anomalies mean that adding slots can make things worse (F16).
- **Over-concurrency against the API.** 18 concurrent agents coincided with a 29.5-min stall (F23). The cap must be a profile setting, measured during rehearsal.
- **The verification bottleneck.** Verifiers are 3 to 4.5 times as numerous as build agents in the owner's style (F28). If verification shares slots with building, the critical path slips. Reserve verifier capacity explicitly, or run mechanical proofs outside the LLM.
- **Self-certification leaks.** A proof written by the implementer, a weakened test, or an LLM "sync" that marks tasks complete (F04, F09, F10, F34). Hash-freeze proofs, and have them re-run by a fresh agent.
- **Tests that pass while the task is unfinished.** Tests alone missed 100% of merge-blocking issues in METR's review sample (F26). Proofs must exercise observable behaviour, for example a UI route answering or a transaction re-read, and `/harden` still runs after the build.
- **Manual-task latency.** A human asleep, on a plane or in a talk stalls every successor. Front-load manual tasks before sleep and travel windows, and push-notify as a manual task's latest start approaches (F18; decision 7).
- **Quota exhaustion mid-sprint.** Workflows pause and resume at the limit (F22), so wall-clock estimates must include expected quota pauses. The size of the quota in tokens is unknown (open question).
- **Clock and randomness inside workflow scripts throw** (F22). Anything time-based (T-6h audit, cadence re-reads, the "build complete" deadline) and any Monte Carlo must live in the orchestrator or in scripts it runs.
- **Replanning churn.** Recomputing priorities every wave can reorder work constantly. Change the dispatch order only when the forecast crosses a zone boundary, or when the critical path changes by more than one buffer quantum (inferred).
- **Two schedulers, one plan.** Dev A's and dev B's `/execution` instances can double-claim a task through Notion. Use claims with leases, and partition by `executor` (inferred; the Notion mechanics belong to another dimension).
- **Time zones.** The event runs on SGT (UTC+8) and Paris is on CEST (UTC+2). Store UTC and display both. The hack window is Tue 6 Oct 04:00 UTC to Wed 7 Oct 15:59 UTC, 35 h 59 min.
- **Stale plan after converge.** Appended convergence tasks must re-enter validation (D1) and re-simulation, or the completion check will pass a plan that no longer matches its tasks.
- **METR numbers do not transfer directly.** METR's tasks are clean, self-contained and timed by low-context humans. Opus 5.5 is not measured. Its horizon may exceed Opus 4.6's (inferred from the trend), but D4 should be recalibrated on the owner's first-pass proof success rate during rehearsal.

---

## Open questions

1. What agent concurrency per machine is safe for this account on Opus 5.5? `/harden` chose 4 after a stall at 18, and the runtime default is 16. The rehearsal before 4 Oct should measure throughput and errors at 4, 8 and 12.
2. What first-pass proof success rate do Opus 5.5 build tasks of 15 to 45 min reach in the owner's stack? This sets `max_attempts` and the buffers, and should be measured in the rehearsal.
3. Does fast mode apply to workflow agents and subagents, and is it available on the owner's plan with usage credits turned on? Worth checking; it is the only real "crash" lever.
4. What is the owner's quota per 5-hour window and per week in tokens, or as a `/usage` percentage per agent-hour? It is needed to turn token estimates into pause time.
5. Does the workflow runtime release queued `agent()` calls in FIFO order? If it does not, the script must hold back its own dispatch to enforce priority. The docs only say "queued `agent()` calls wait for a free slot".
6. What do the TOKEN2049 Origins rules allow to be prepared before 6 Oct 12:00 SGT? The answer sets `release_utc` for build tasks.
7. How long do `/prose`, video recording and README screenshots take? No measurement exists yet; the D5 backward deadline needs them.
8. How should Notion edits made from the phone flow back into the local JSON truth, and which side wins? That belongs to the Notion dimension, but the schema reserves `claim` and `decisions` for it.

---

## Sources

Primary, read directly:
- GitHub spec-kit at `d2ddd910266ad14afe79c5414c88ee316aca6e9a` (2026-09-30): `templates/tasks-template.md`, `templates/commands/tasks.md`, `implement.md`, `analyze.md`, `converge.md`, `taskstoissues.md`, `templates/spec-template.md`. https://github.com/github/spec-kit/tree/d2ddd910266ad14afe79c5414c88ee316aca6e9a/templates ; issue https://github.com/github/spec-kit/issues/1934
- Taskmaster at `c0c98d367c55296bfe69e65680625b6db437af02` (2026-04-23): `docs/task-structure.md`, `packages/tm-core/src/common/types/index.ts`, `scripts/modules/task-manager/find-next-task.js`, `src/prompts/parse-prd.json`, `src/prompts/analyze-complexity.json`, `scripts/modules/config-manager.js`, `apps/docs/capabilities/rpg-method.mdx`, `apps/docs/capabilities/loop.mdx`. https://github.com/eyaltoledano/claude-task-master
- CCPM at `7d7e4623bc6d4c0c9ba66ca6bfecd7e5261dc697` (2026-03-18): `skill/ccpm/SKILL.md`, `references/plan.md`, `structure.md`, `conventions.md`, `execute.md`, `scripts/next.sh`, `scripts/blocked.sh`, `README.md`. https://github.com/automazeio/ccpm
- Kiro docs: https://kiro.dev/docs/specs.md , https://kiro.dev/docs/specs/feature-specs.md , https://kiro.dev/docs/specs/best-practices.md , https://kiro.dev/docs/specs/quick-spec.md , https://kiro.dev/docs/specs/correctness.md ; example generated tasks file https://github.com/sebsto/wispr/blob/HEAD/.kiro/specs/cli-tool/tasks.md
- OpenAI, "Using PLANS.md for multi-hour problem solving": https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md
- Anthropic engineering: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents (2025-11-26); https://www.anthropic.com/engineering/multi-agent-research-system (2025-06-13)
- Claude Code docs (as served 2026-09-30): https://code.claude.com/docs/en/workflows.md , https://code.claude.com/docs/en/env-vars.md , https://code.claude.com/docs/en/costs.md , https://code.claude.com/docs/en/agent-teams.md , https://code.claude.com/docs/en/model-config.md , https://code.claude.com/docs/en/fast-mode.md ; pricing https://platform.claude.com/docs/en/about-claude/pricing.md ; https://platform.claude.com/docs/en/build-with-claude/fast-mode.md ; local changelog cache `C:/Users/Utilisateur/.claude/cache/changelog.md` (entries 2.1.219, 2.1.229, 2.1.269, 2.1.271)
- METR: https://metr.org/time-horizons/ (updated 2026-05-08), raw data https://metr.org/assets/benchmark_results_1_1.yaml , https://metr.org/blog/2026-1-29-time-horizon-1-1/ , https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/ (arXiv 2503.14499), https://metr.org/blog/2025-08-12-research-update-towards-reconciling-slowdown-with-time-horizons/ , https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- Graham 1966, BSTJ 45(9):1563-1581: https://archive.org/details/bstj45-9-1563
- Kolisch & Hartmann 1999 (PDF): https://www.hsba.de/fileadmin/user_upload/bereiche/_dokumente/6-forschung/profs-publikationen/Hartmann_1999_Heuristic_Algorithms_for_solving_the_resource-constrained_project_scheduling_problem.pdf
- SWE-bench leaderboard data: https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/HEAD/data/leaderboards.json
- Devin docs: https://docs.devin.ai/essential-guidelines/when-to-use-devin , https://docs.devin.ai/product-guides/session-insights
- ethers v6 NonceManager source: https://github.com/ethers-io/ethers.js/blob/main/src.ts/providers/signer-noncemanager.ts ; Cardano concurrency: https://docs.cardano.org/about-cardano/explore-more/concurrency

Secondary (reported):
- PERT formula and history: https://en.wikipedia.org/wiki/Program_evaluation_and_review_technique (citing Malcolm et al. 1959)
- MacCrimmon & Ryavec 1964: https://pubsonline.informs.org/doi/10.1287/opre.12.1.16 (via search summary)
- Kreter, Rieck & Zimmermann 2016: https://ideas.repec.org/a/eee/ejores/v251y2016i2p387-403.html
- Earned schedule: https://en.wikipedia.org/wiki/Earned_schedule ; https://www.earnedschedule.com/Docs/Lipke-introduction-to-earned-schedule-utd.pdf
- Critical chain fever chart: https://www.smartsheet.com/content/critical-chain-method ; https://umbrex.com/resources/frameworks/project-management-frameworks/critical-chain-project-management-ccpm/
- SWE-bench Verified difficulty split: https://jatinganhotra.dev/blog/swe-agents/2025/04/15/swe-bench-verified-easy-medium-hard.html ; https://openai.com/index/introducing-swe-bench-verified/

Owner's local files:
- `C:/Users/Utilisateur/Documents/Coding/Hedera/research/findings/TASKLIST.md`
- `C:/Users/Utilisateur/Documents/Coding/BNB/holdover/scripts/completion-check.mjs`
- `C:/Users/Utilisateur/.claude/skills/harden/SKILL.md`, `research/pilot-auto-calibration.md`, `research/reviewer-independence.md`
- `C:/Users/Utilisateur/.claude/skills/hackathon/SKILL.md`, `references/01-find-the-gap.md` (cadence table, lines 294-300), `references/04-demo-audit.md`
- Transcript usage metadata: `C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur-Documents-Coding-{Hedera,BNB,XRPL-Hackathon-2026}/*/subagents/**` (only numeric usage fields, timestamps, agent descriptions and phase labels were read)

---

## Appendix A — simulation used for F19 and F20 (run in memory, reproducible)

```python
import random, math, statistics as st, heapq
def gen_dag(n, width, rng):                      # layered DAG; each task depends on 1-3 tasks of the previous 1-2 layers
    layers=[]; i=0
    while i<n:
        w=max(1,min(n-i,int(rng.gauss(width,width/3)))); layers.append(list(range(i,i+w))); i+=w
    preds={t:set() for t in range(n)}
    for li in range(1,len(layers)):
        pool=layers[li-1]+(layers[li-2] if li>=2 else [])
        for t in layers[li]: preds[t]|=set(rng.sample(pool,min(rng.choice([1,1,2,2,3]),len(pool))))
    return preds
def succs(preds):
    s={t:set() for t in preds}
    for t,ps in preds.items():
        for p in ps: s[p].add(t)
    return s
def bottom_level(preds,dur):                     # longest remaining path, ids are topological
    s=succs(preds); bl={}
    for t in sorted(preds,reverse=True): bl[t]=dur[t]+max([bl[x] for x in s[t]],default=0)
    return bl
def list_schedule(preds,dur,prio,m):             # Graham list scheduling, dynamic ready set
    indeg={t:len(preds[t]) for t in preds}; s=succs(preds)
    ready=[(-prio[t],t) for t in preds if indeg[t]==0]; heapq.heapify(ready)
    running=[]; time=0.0; free=m; done=0
    while done<len(preds):
        while free and ready:
            _,t=heapq.heappop(ready); heapq.heappush(running,(time+dur[t],t)); free-=1
        time,t=heapq.heappop(running); free+=1; done+=1
        for x in s[t]:
            indeg[x]-=1
            if indeg[x]==0: heapq.heappush(ready,(-prio[x],x))
    return time
def wave_schedule(preds,dur,m):                  # Kiro-style: level-by-level with a barrier between levels
    lvl={}
    for t in sorted(preds): lvl[t]=1+max([lvl[p] for p in preds[t]],default=0)
    total=0.0
    for L in sorted(set(lvl.values())):
        slots=[0.0]*m
        for t in [t for t in preds if lvl[t]==L]:
            i=min(range(m),key=lambda k:slots[k]); slots[i]+=dur[t]
        total+=max(slots)
    return total
# per graph: est = lognormal(ln 30, 0.6); true = est * lognormal(0, 0.55)
# lower bound = max(critical path on true durations, sum(true)/m)
# priorities: critical-path = bottom_level(est); Taskmaster-like = -(len(deps)*1000 + id)
```

The overrun-detection experiment (F21) reuses these functions. The deadline is set at the plan's P80 over 200 draws, true durations are multiplied by a bias of 1.0, 1.25 or 1.5, and at 20, 30 and 50% of tasks finished the forecast reruns the remaining graph 150 times with estimates scaled by the geometric mean of actual/estimate over finished tasks. Running tasks keep a residual duration and top priority.

## Appendix B — reference-class extraction from the owner's transcripts (method)

For each `agent-*.jsonl` under `…/subagents/` and `…/subagents/workflows/wf_*/`:
- Keep assistant messages. Deduplicate streaming lines by `message.id`, keeping the line with the largest `output_tokens`.
- Sum `input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, `cache_read_input_tokens` and `output_tokens`, then price them per model at list price.
- Wall time is the last `timestamp` minus the first.
- The kind comes from the workflow journal's `phase` (`journal.jsonl`, events of type `started`) or from the agent's `.meta.json` `description`.

`/execution` can run the same extraction over its own runs after every wave, to recalibrate D3 step 2 without reading any message content.
