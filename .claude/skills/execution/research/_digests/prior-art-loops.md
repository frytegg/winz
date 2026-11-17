# prior-art-loops

## Summary
1. Do not reuse ralph-loop's hook as the engine: it re-feeds one fixed prompt and exits on a self-declared <promise> string (F01-F05).
2. Run here, it kept blocking with stop_hook_active=true and with a workflow in flight, ended on a bare "DONE", and died silently after a cd.
3. Its issue tracker shows a 6,239-iteration runaway and a trap where an honest agent cannot exit when the goal needs a human (F04, F05).
4. Continue event-driven instead: a thin orchestrator launches one background workflow per wave and is woken when it ends (F06, F10).
5. A marker-gated Stop command hook (the /harden pattern) allows the stop while work is in flight, when only manual tasks remain, or when the check passes (F12).
6. It blocks only when runnable work exists and the state changed since its last block; manual work ends the turn as BLOCKED_ON_HUMAN, never as "done" (F05, F06).
7. State lives in repo-anchored files: plan JSON whose proven flag only a verifier sets, an append-only event log, progress notes, git, receipts (F13, F15).
8. A work item is one deliverable, one proof agreed before code, one declared file scope, sized for one fresh context; overlapping scopes serialize (F17, F24, F27).
9. The oracle is a command the checker runs itself, by an agent that did not write the code, plus a plan-level check outside the test suite (F19, F20).
10. Transcript-reading judges are not proof: /goal's Haiku evaluator "doesn't run commands or read files independently" (F07).
11. Parallel agents pay only on decomposable, file-disjoint work: cooperation costs 30-50% of success, sequential work 39-70%, tokens ~15x (F24, F25, F28).
12. This machine: 16 CPUs means 16 concurrent workflow agents by default, but C: had 2.4 GB free today; under Remote Control, usage-limit hits fail agents (F10, F31).

## Recommendations
1. Do not build on the ralph-loop plugin or copy its hook: no model-emitted completion string, no transcript parsing, no relative state path (F02, F03).
2. Keep the orchestrator thin: the interactive, Remote Control-capable session is a scheduler holding only the plan path, the current wave and short summaries; all implementation and verification run in fresh agent contexts (F09, F25, F28, F32).
3. Run one background dynamic workflow per wave. Manual tasks mark wave boundaries, since workflows take no mid-run input. Treat the workflow's completion turn as the wake-up that re-verifies, updates the plan, pushes the per-wave Notion report and launches the next wave (F10).
4. Add a skill-frontmatter Stop command hook on the /harden template: gated on .execution/active, Python or Node in exec form, anchored to payload cwd, then CLAUDE_PROJECT_DIR, then the git toplevel (F03, F12, F30).
5. Stop-hook decision table: allow when background_tasks is non-empty; allow and write BLOCKED_ON_HUMAN when only manual tasks are runnable; allow and write BUILD_COMPLETE only when the completion check the hook itself runs exits 0; block with the computed next-wave task ids only if the plan+HEAD hash changed since the last block, else allow and write STALLED (F04, F05, F06).
6. Use /goal at most as an optional nudge alongside the command hook, never as the proof gate (F07).
7. State under .execution/: plan.json (JSON; status changed only via a script; proven set only from a verifier receipt), events.jsonl (append-only, the resume source), progress.md, receipts/<task>.txt, and the active marker carrying run id and session id (F13, F15, F16).
8. Granularity rule enforced by the plan validator: one deliverable, one proof written at plan time and approved in the single plan approval, a declared file scope, and a size one fresh context can finish. Task descriptions carry objective, output format, tools, boundaries and a search-first instruction (F17, F18).
9. Verification: a separate skeptical verifier agent re-runs each proof itself (exit-0 command, chain re-read of a tx hash, CI run id re-query, file content check, URL resolve) with hard thresholds and stub/TODO checks. A plan-level completion check in the completion-check.mjs style, kept out of CI, plus a regression gate close every wave (F19, F20, F21).
10. Oracle hygiene: proofs print a few lines, ERROR plus reason on one greppable line, full logs to files, and a deterministic --fast sample for slow suites (F20).
11. Parallelism: the same wave only for file-disjoint tasks with no undecided shared interface; shared decisions are their own earlier task; overlapping scopes serialize; one validation agent per wave for builds and tests (F23, F24, F26, F27, F29).
12. Dev A and dev B: partition by owner and file scope at plan time, claim tasks through an atomic arbiter (a git push rejected as non-fast-forward is proven; Notion atomicity unverified), and re-verify after integrating the other's commits (F24, F27).
13. Budgets and brakes: maximum waves, 3 attempts per task from the last green commit (house rule), per-wave token budget including the ~15x multi-agent multiplier, wall-clock deadline stored in UTC; unplanned work becomes a proposal to the user, never work (F04, F28, F34).
14. Machine limits: set CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS well below 16, check free disk before each wave, and avoid per-agent worktree installs while C: is nearly full (F31).
15. Scheduled event tasks: compute due items from UTC deadlines at every wake instead of relying on session crons, which follow the laptop's local timezone, jitter by up to 30 min and skip missed fires (F11).
16. Remote Control: keep waves small and idempotent, because a workflow agent that hits the usage limit fails instead of pausing under Remote Control (F10).

## Risks
1. Premature self-declared completion: a later agent sees progress and declares done; the lead stops early; 'Done ✓' with the code missing (F13, F24, F29; MAST FM-3.1 6.2%, FM-1.5 12.4%).
2. Lenient self-grading, and an out-of-the-box QA agent that approves real bugs (F19).
3. Placeholder or stub implementations, a trained bias noted by Huntley and still seen on Opus 4.6 (F14, F19).
4. False 'not implemented' conclusions leading to duplicate implementations (F14, F27).
5. Regressions: new features break old ones as the project grows (F20, F27).
6. Runaway or no-progress loops: 6,239 iterations in ~11.7 h; step repetition is the most frequent MAST mode at 15.7% (F04, F21).
7. Honest-agent trap when the goal includes human-only work (F05).
8. Silent loop death from cwd drift, session-id mismatch, /clear, or a hook exiting 1 (non-blocking) (F03, F16).
9. Missed completion from transcript flush lag or delegated work (F02).
10. Context accumulation and rot in a long-lived orchestrator; compaction dropping subtle decisions (F09, F32).
11. Parallel overwrites, frequent merge conflicts and conflicting implicit decisions; coordination drops success 30-50% (F23, F24, F27, F29).
12. Error amplification without central verification: 17.2x against 4.4x (F25).
13. Token blow-up: multi-agent ~15x chat; an evaluator harness >20x solo (F19, F28).
14. Workflow relaunch reruns completed agents started after a failed one (F10).
15. Usage-limit hits fail workflow agents when the session is driven through Remote Control (F10).
16. Disk exhaustion from parallel installs and worktrees: C: at 2.4 GB free on 2026-09-30 (F31).
17. Agent killing or bypassing its own loop (pkill -9 bash; deleting the marker) (F27, F12).
18. Cron schedules shifting with the laptop timezone, up to 30 min jitter, no catch-up (F11).
19. Windows shell pitfalls: WSL bash second on PATH, jq absent on many setups, profile echo corrupting hook JSON, paths with spaces (F30).
20. Any single blocking Stop hook from another source wedging the turn until the 8-block cap (F06, F12; issue #5312).

## Open questions
1. Does tool use between blocks reset the 8-consecutive-block counter? The reference says 'eight times in a row'; the guide says 'without progress'. Test in a throwaway session.
2. Does a finished background workflow start a new turn that resets the block counter and fires Stop again (inferred yes)?
3. Is CLAUDE_CODE_SESSION_ID exported inside a skill's or slash command's ! shell block (issues #1224 and #1319 suggest it was not at one point)?
4. Can the Notion MCP give an atomic compare-and-set claim for dev A and dev B, or must claims live in git with Notion as a mirror?
5. How do /goal and a custom Stop command hook interact in one session, if /goal is adopted at all?
6. Do Stop hooks and background-task wake-ups behave identically when the session is driven through Remote Control from the phone?
7. How do session crons behave when the OS timezone changes mid-session (Paris to Singapore)?
8. Should verification run as agents in the same wave workflow or as a separate verification workflow? Cost against independence.

## Findings
- F01 [verified-executed] ralph-loop keeps a session going by blocking every Stop and re-feeding the same prompt from a project-relative state file.
  -> The primitive (Stop hook decision:block) is usable. The same-prompt, in-session design is what /execution must not copy (see F02-F05, F09).
- F02 [verified-executed, LB] ralph's completion signal is a string the working model chooses to print, parsed from a transcript that may lag; a bare word without tags also ends the loop, and the promise is invisible when work is delegated to subagents.
  -> Completion must be decided from plan state and receipts checked mechanically, never from model text or transcript parsing.
- F03 [verified-executed, LB] ralph ignores every loop-safety input Claude Code provides (stop_hook_active, background_tasks, session_crons, last_assistant_message, cwd, CLAUDE_PROJECT_DIR); it re-feeds while a workflow runs and dies silently after a cd or on a session mismatch.
  -> The /execution Stop hook must read background_tasks, anchor its state path to the repo root from payload cwd, CLAUDE_PROJECT_DIR or the git toplevel, and log loudly instead of exiting silently.
- F04 [verified-source, LB] ralph runs unbounded by default, has no no-progress detection, and is cancelled only by deleting its file; a real run went 6,239 iterations over ~11.7 hours.
  -> Hard caps (waves, attempts, tokens, wall clock) plus no-progress detection, such as a hash of plan state and git HEAD at each block, are required.
- F05 [reported, LB] A promise-gated loop traps an honest agent whenever the goal contains work only a human can do.
  -> /execution needs an explicit BLOCKED_ON_HUMAN terminal state that ends the turn without asserting completion, since manual tasks are a planned category.
- F06 [verified-source, LB] Claude Code now caps Stop-hook continuations at 8 consecutive blocks (since v2.1.143, CLAUDE_CODE_STOP_HOOK_BLOCK_CAP) and gives Stop hooks stop_hook_active, background_tasks (types include workflow), session_crons and last_assistant_message; the docs disagree on whether progress resets the cap.
  -> The continuation hook allows the stop when background_tasks is non-empty and blocks only with a computed reason; the 8-block cap is its backstop, and its reset semantics must be tested.
- F07 [verified-source, LB] /goal is the built-in successor (a session-scoped prompt Stop hook with a Haiku evaluator that defers while background work runs), but the evaluator only reads the transcript and allows one goal per session.
  -> /goal may be an optional nudge, never the proof gate; the gate must be a command hook that runs the checks itself.
- F08 [verified-source] Anthropic's own guidance lists four ways to gate the stop (prompt, /goal, deterministic Stop hook script, second-opinion verifier) and asks for evidence over assertion.
  -> /execution combines the last two: a deterministic Stop gate plus independent verifier agents.
- F09 [reported, LB] An in-session loop accumulates context, which Huntley and practitioners say misses the point of Ralph (independent context windows), and a Stop hook cannot spawn a fresh interactive session.
  -> The orchestrator stays a thin scheduler; implementation and verification run in fresh workflow or subagent contexts.
- F10 [verified-source, LB] Dynamic workflows fit a wave: the script holds the plan, agents run in fresh background contexts, capped at 16 concurrent agents by default and 1,000 per run. They take no mid-run input, rerun every later agent after a mid-fan-out failure, and do not pause on usage limits in Remote Control sessions.
  -> One workflow per wave, with manual gates between workflows; keep waves small and idempotent; beware usage-limit failures when driven from the phone.
- F11 [verified-source, LB] Session crons and /loop fire only while the session is open and idle, in local timezone, with up to 30 min jitter, no catch-up, and a 7-day expiry.
  -> Fixed-cadence event tasks (channel re-reads, T-6h audit) need UTC deadlines computed at each wake; cron alone breaks when the laptop moves from Paris to SGT.
- F12 [verified-source, LB] Skill-frontmatter hooks persist for the rest of the session, so the house pattern gates them on a marker; /harden's hook_guard already anchors to the run root, exits 0 on stop_hook_active, and uses Python not jq. The user's two current Stop hooks never block.
  -> Build the /execution Stop hook on the /harden template: .execution/active marker, Python or Node, run-root discovery, run-control logging.
- F13 [verified-source, LB] Anthropic's long-running harness keeps state in init.sh, claude-progress.txt, git, and a JSON feature list whose only mutable field is passes; JSON was chosen because models overwrite it less than Markdown.
  -> plan.json is the machine state, changed only through a script, with status flipped to proven only by a verifier; progress notes and git carry context to fresh agents.
- F14 [reported] Huntley's Ralph keeps memory only in specs/*, fix_plan.md, AGENT.md and git, commits and pushes when tests pass, and the operator watches and discards the plan often.
  -> It supports file-based state and per-item commits; plan regeneration is a human decision, matching decision 2.
- F15 [verified-source, LB] Anthropic's Managed Agents keep an append-only session log outside the harness so a crashed harness resumes from the last event; compaction loses what is not stored.
  -> Add .execution/events.jsonl, append-only, and resume by replaying it after a crash, compaction, laptop sleep or a relaunch from the phone.
- F16 [verified-source, LB] Two sessions in one folder cannot both run ralph: one project-wide state file is overwritten without a check and the first loop dies silently; /clear changes the session id; agent teams cannot span sessions.
  -> Namespace run state by run id and session id; dev A and dev B coordinate through a shared arbiter (git or Notion), not through agent teams.
- F17 [verified-source, LB] Working harnesses converge on one small, independently verifiable item per fresh context, with acceptance criteria written before code.
  -> Plan validator rule: one deliverable, one proof defined at plan time, a declared file scope, sized for one fresh agent context.
- F18 [verified-source] A delegated task needs objective, output format, tool guidance and clear boundaries, or agents duplicate work, leave gaps, or over-spawn.
  -> The task schema carries these four fields plus a search-first instruction.
- F19 [verified-source, LB] Models grade their own work leniently; a separate skeptical evaluator with hard thresholds is the lever, it needs tuning, and it costs much more.
  -> The verifier is a different agent with a skeptical prompt, pass/fail thresholds and file-based handoff; budget for it.
- F20 [verified-source, LB] An unattended loop needs a nearly perfect verifier, a regression gate, and small oracle output; green tests are not completion.
  -> Two levels of done (task proof plus plan-level completion check out of CI), a full-suite or CI regression gate per wave, and terse receipts.
- F21 [verified-source] Across 1,600+ multi-agent traces, termination and verification failures are common and verifiers help but are not a silver bullet.
  -> Verifiers must exercise behaviour, not superficial checks such as compilation.
- F22 [verified-source] Claude Code can block task completion (TaskCompleted exit 2) and can run an experimental agent hook verifier (up to 50 turns); prompt hooks on Stop accept impossible:true.
  -> These are optional enforcement points if the built-in task list is used; the command hook remains the primary gate.
- F23 [reported] Cognition argues from illustrative examples, not measurement, that parallel agents make conflicting implicit decisions.
  -> Pin shared decisions (interfaces, schema, style) as their own task before a parallel wave.
- F24 [verified-source, LB] Measured: two coding agents splitting a workload one agent handles do 30% worse on average (GPT-5 and Sonnet 4.5: 25% success, 50% below solo), success falls with more agents, and communication cuts merge conflicts without raising success.
  -> Parallelize only file-disjoint tasks with specific commitments; re-verify after every merge; dev A and dev B partition by owner and scope.
- F25 [verified-source, LB] Measured across 260 configurations: multi-agent helps decomposable work (+80.8%) and hurts sequential work (-39 to -70%); independent agents amplify errors 17.2x against 4.4x with an orchestrator.
  -> The dependency graph must mark sequential chains as serial; the orchestrator verifies every wave before the next starts.
- F26 [verified-source] Declaring write scope before writing raised integration success from 65.6% to 96.7%, mainly by serializing work (single-author preprint).
  -> It supports declared file scopes with serialization of overlaps; expect little wall-clock gain on tightly coupled code.
- F27 [verified-source, LB] Anthropic's 16-agent compiler build ran each agent as a fresh claude -p in a bash loop, claimed tasks with lock files arbitrated by git, saw frequent merge conflicts, and stalled when the work stopped decomposing.
  -> Git push rejection is a proven atomic claim arbiter for dev A and dev B; monolithic tasks need an oracle that splits them before parallelizing.
- F28 [verified-source, LB] Multi-agent systems use about 15x chat tokens and win mainly by spending them; Anthropic says coding has fewer truly parallelizable tasks than research.
  -> Per-task token estimates in the plan must include the multiplier; default to serial unless the graph shows real independence.
- F29 [verified-source, LB] Claude Code's docs warn that parallel teammates overwrite each other, that the lead stops early, and that task status lags.
  -> First-party confirmation that the orchestrator cannot be trusted to declare done, and that same-file parallel edits must be prevented structurally.
- F30 [verified-executed] ralph's shell hook works under Git Bash here: bash resolves to Git's, jq comes from scoop and emits CRLF, which MSYS2 tolerates (the CRLF state-file hypothesis is refuted on this machine); the WSL bash and profile-echo traps remain.
  -> Write /execution hooks in Python or Node in exec form, as /harden does, to avoid the jq and shell dependencies.
- F31 [verified-executed, LB] Measured today: 16 logical CPUs, so workflows default to 16 concurrent agents, but C: had 2.4 GB free, and every worktree needs its own install.
  -> Cap workflow concurrency well below 16, check free disk before every wave, and avoid per-agent worktrees with installs unless disk allows.
- F32 [verified-source] Long contexts degrade gradually; compaction loses subtle context; Opus 4.5+ removed the context anxiety that forced resets.
  -> Keep the orchestrator lean even with 1M context; subagents return 1-2k-token summaries.
- F33 [verified-source] Ralph Orchestrator blocks the loop on a human question over Telegram and gates work behind tests, lint and typecheck.
  -> Prior art for the manual-task pause with a mobile channel (Notion report plus Remote Control here).
- F34 [reported] Cost and outcome reference points: Huntley reports a $50k contract for $297 and ~90% completion; Anthropic's DAW harness cost $124.70 over 3h50; running Ralph too long overbakes.
  -> Calibrate per-wave token and dollar estimates; stop at the plan's scope.