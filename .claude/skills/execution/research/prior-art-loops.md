# Prior art: autonomous build loops and long-running agent harnesses

Dossier for the design of `/execution`. Dimension: how autonomous loops keep going, where they keep their state,
how big one unit of work should be, what counts as proof, and how they fail. Researched 2026-09-30 on the user's
machine (Windows 11, Git Bash, Claude Code 2.1.285). Confidence labels: **verified-executed** (I ran it here),
**verified-source** (read in the primary file or page and quoted), **reported** (a first-hand account I could not
reproduce), **inferred** (my reasoning, not sourced).

---

## Summary for the designer

1. Do not reuse ralph-loop's hook as the engine: it re-feeds one fixed prompt and exits on a self-declared `<promise>` string (F01-F05).
2. Run here, it kept blocking with `stop_hook_active=true` and with a workflow in flight, ended on a bare `DONE`, and died silently after a `cd`.
3. Its own issue tracker shows a 6,239-iteration runaway and a trap where an honest agent cannot exit when the goal needs a human (F04, F05).
4. Continue event-driven instead: a thin orchestrator launches one background workflow per wave and is woken when it ends (F06, F10).
5. A marker-gated Stop command hook (the /harden pattern) allows the stop while work is in flight, when only manual tasks remain, or when the check passes (F12).
6. It blocks only when runnable work exists and the state changed since its last block; manual work ends the turn as BLOCKED_ON_HUMAN, never as "done" (F05, F06).
7. State lives in repo-anchored files: plan JSON whose `proven` flag only a verifier sets, an append-only event log, progress notes, git, receipts (F13, F15).
8. A work item is one deliverable, one proof agreed before code, one declared file scope, sized for one fresh context; overlapping scopes serialize (F17, F26, F27).
9. The oracle is a command the checker runs itself, by an agent that did not write the code, plus a plan-level check outside the test suite (F19, F20).
10. Transcript-reading judges are not proof: `/goal`'s Haiku evaluator "doesn't run commands or read files independently" (F07).
11. Parallel agents pay only on decomposable, file-disjoint work: cooperation costs 30-50% of success, sequential work 39-70%, tokens ~15x (F24, F25, F28).
12. This machine: 16 CPUs means 16 concurrent workflow agents by default, but C: had 2.4 GB free today; under Remote Control, usage-limit hits fail agents (F10, F31).

---

## Findings

### A. The stop/continue mechanism

**F01 — ralph-loop keeps a session going by blocking every Stop and re-feeding the same prompt.**
Evidence: the plugin registers one Stop hook, `"command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/stop-hook.sh\""`
(`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/hooks/hooks.json:9`). When
`.claude/ralph-loop.local.md` exists, the hook prints `{"decision": "block", "reason": $prompt, "systemMessage": $msg}`
(`hooks/stop-hook.sh:181-188`), with the comment `# Not complete - continue loop with SAME PROMPT` (`:144`). The Claude
Code reference defines the contract: `decision` "`"block"` prevents Claude from stopping", `reason` "Tells Claude why it
should continue" (https://code.claude.com/docs/en/hooks.md, Stop decision control). The README states the design
choice: "The loop happens **inside your current session** - you don't need external bash loops" (`README.md:27`).
Executed here (case A below): with no promise in the last text, the hook returned `decision: block`, the prompt as
`reason`, and rewrote `iteration: 1` to `iteration: 2`.
Confidence: verified-executed.

**F02 — ralph's completion signal is a string the working model chooses to print, parsed from a transcript that may
lag; a bare word without tags also ends the loop.**
Evidence: the hook takes the last 100 lines containing `"role":"assistant"` from the transcript
(`stop-hook.sh:98`), keeps the last text block (`:112-114`), extracts the first `<promise>...</promise>` with Perl
(`:133`) and compares `[[ "$PROMISE_TEXT" = "$COMPLETION_PROMISE" ]]` (`:137`). The README concedes the limit: "The
`--completion-promise` uses exact string matching, so you cannot use it for multiple completion conditions (like
"SUCCESS" vs "BLOCKED"). Always rely on `--max-iterations` as your primary safety mechanism" (`README.md:134`).
- Executed (case B): a last message of just `DONE`, with no tags, printed `Ralph loop: Detected <promise>DONE</promise>`
  and deleted the state file. When the Perl substitution finds no tag it returns the whole text, which then equals the
  promise. Open PR #5605 names it: "fix false completion on bare word"
  (https://github.com/anthropics/claude-plugins-official/pull/5605).
- The docs warn the transcript "is written asynchronously and may lag the in-memory conversation... Hooks that need
  the final assistant text of the current turn should use `last_assistant_message`" (hooks.md, Common input fields).
  Issue #3632 traced two missed, correctly formatted promises to this race: "the hook read the transcript file
  *before* the just-completed turn's final text block ... was fully flushed to disk".
- When work is delegated, the promise is invisible: "A subagent's final message is relayed into the parent transcript
  as a **USER-role `tool_result`**, not an assistant text block ... `<promise>` **never appears where the hook looks**"
  (issue #4909).
Confidence: verified-executed (B), verified-source (race, subagents).

**F03 — ralph ignores every loop-safety input Claude Code now provides, so it re-feeds while background work runs and
dies silently on path or session drift.**
Evidence: `grep -c` on `stop-hook.sh` returns 0 for `stop_hook_active`, `background_tasks`, `session_crons`,
`last_assistant_message`, `CLAUDE_PROJECT_DIR` and `cwd`. The state path is relative:
`RALPH_STATE_FILE=".claude/ralph-loop.local.md"` (`:13`), while "Handlers run in the current directory" and "`cwd`
follows Claude ... the new directory after Claude runs `cd`" (hooks.md). Executed on an unmodified copy of the hook
(scratchpad, Git Bash, jq 1.8.1):

| Case | Input | Result |
| :- | :- | :- |
| D | `stop_hook_active: true` | still `decision: block`, iteration 3 -> 4 |
| E | `background_tasks: [{type:"workflow", status:"running"}]` | still `decision: block`, same prompt re-fed |
| F | state `session_id: sidA`, hook `session_id: sidB` | exit 0, no output, state file left on disk |
| H | hook run from a subfolder | exit 0, no output, root state file orphaned |

Matching open issues: #3989 ("a mid-loop cd silently kills the loop"), #5536 ("exits silently on a session_id
mismatch, leaving a stale active state file"), #5312 ("ignore `stop_hook_active`, wedging sessions until the block
cap"). A hook that exits non-zero is harmless to the session but fatal to the loop: "Claude Code treats exit code 1 as
a non-blocking error and proceeds with the action" (hooks.md, Warning under Other exit codes).
Confidence: verified-executed.

**F04 — ralph runs unbounded by default, has no no-progress detection, and can only be cancelled by deleting its
file; a real run went 6,239 iterations.**
Evidence: `MAX_ITERATIONS=0` is the default (`scripts/setup-ralph-loop.sh:10`), and the cap only fires
`if [[ $MAX_ITERATIONS -gt 0 ]] && [[ $ITERATION -ge $MAX_ITERATIONS ]]` (`stop-hook.sh:61`; executed, case I). The
setup banner warns "This loop cannot be stopped manually! It will run infinitely unless you set --max-iterations or
--completion-promise" (`setup-ralph-loop.sh:167-168`). `/cancel-ralph` just runs `rm .claude/ralph-loop.local.md`
(`commands/cancel-ralph.md:17`). The user can still type it, because Stop "Does not run if the stoppage occurred due
to a user interrupt" (hooks.md, Stop). Issue #1699: "One `/ralph-loop` ran **6,239 iterations over ~11.7 hours**
before noticed ... ~6,000 of which were the same `Stop hook feedback:` prompt being re-injected into a model that kept
producing near-identical no-op turns". Its proposed fix is a hash of the last outputs: "If the most recent K outputs
are identical (e.g. K=3), declare the loop converged and exit." A documentation defect: `commands/help.md:49` names
the state file `.claude/.ralph-loop.local.md`, but the code uses `.claude/ralph-loop.local.md`.
Confidence: verified-source (code), reported (incident).

**F05 — A promise-gated loop traps an honest agent whenever the goal contains work only a human can do.**
Evidence: the setup text forbids an escape: "Even if you believe you're stuck, the task is impossible, or you've been
running too long - you MUST NOT output a false promise statement" (`setup-ralph-loop.sh:195-199`). Issue #5312 reports
the consequence: "If the loop's goal contains any work the agent cannot perform — a credential the human holds, an
interactive command, an approval gate — the agent cannot truthfully emit the promise, so it never exits ... The
failure mode selects against honesty." It observed "Three separate sessions in one working day, 14–21 minutes of
churn each" and suggests an "explicit 'blocked, cannot proceed' exit that does not require asserting a false
completion".
Confidence: reported (consistent with the source text).

**F06 — Claude Code itself now caps and informs Stop-hook loops: an 8-consecutive-block cap, `stop_hook_active`,
`background_tasks` (including workflows), `session_crons` and `last_assistant_message`.**
Evidence (hooks.md, Stop input): "Claude Code applies an 8-consecutive-continuation cap: after stop hooks have
continued the turn eight times in a row, Claude Code overrides the next block and ends the turn. To raise the cap, set
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`." env-vars.md: "(default: 8). Set to `0` to disable the cap." The cap arrived in
v2.1.143: "Fixed stop hooks that block repeatedly looping forever — the turn now ends with a warning after 8
consecutive blocks" (CHANGELOG.md line 4098). On background work: "The `background_tasks` and `session_crons` arrays
let hooks distinguish "session is done" from "session is paused waiting for background work to wake it back up"",
with `type` values including "`shell`, `subagent`, `monitor`, `workflow`, `teammate`". A softer channel also exists:
`hookSpecificOutput.additionalContext` "keeps the conversation going through the same loop protections as `decision:
"block"`". The wording on what resets the cap differs between pages: the reference says "eight times in a row"; the
guide says "after it blocks eight times in a row without progress" (hooks-guide.md, Stop hook hits the block cap).
Confidence: verified-source.

**F07 — `/goal` is Anthropic's built-in successor to the pattern, but its judge only reads the transcript.**
Evidence (https://code.claude.com/docs/en/goal.md): "`/goal` is a wrapper around a session-scoped prompt-based Stop
hook ... sends the condition and the conversation so far to your configured small fast model, which defaults to Haiku".
Its evaluator "doesn't run commands or read files independently, so write the condition as something Claude's own
output can demonstrate", and "It does not call tools". Its strengths:
- It "defers evaluation": "If a subagent or a background shell command is still running when a turn ends, Claude Code
  skips the evaluation for that turn ... When the background work finishes, Claude Code delivers the result to Claude
  as a new turn".
- It checks in after 30 minutes of waiting, backing off.
- It stops when "no tool use for several turns in a row".
- It clears on unrecoverable errors, pauses on rate limits, and is restored on resume.
- It "works ... through Remote Control".
Its limits: "One goal can be active per session", and the condition is capped at 4,000 characters.
Confidence: verified-source.

**F08 — Anthropic's own guidance names four ways to gate the stop; only the last two are unattended-safe.**
Evidence (https://www.anthropic.com/engineering/claude-code-best-practices): "In one prompt ... Across a session: set
the check as a /goal condition ... As a deterministic gate: a Stop hook runs your check as a script and blocks the
turn from ending until it passes. Stop input covers the cap on consecutive blocks. By a second opinion: a
verification subagent or a dynamic workflow that checks its own findings has a fresh model try to refute the result,
so the agent doing the work isn’t the one grading it." Also "The /goal and Stop hook versions are what let an
unattended run finish correctly without you" and "Have Claude show evidence rather than asserting success".
Confidence: verified-source.

**F09 — An in-session loop accumulates context; the technique's author and practitioners say that misses the point,
and a Stop hook cannot start a fresh session.**
Evidence: Huntley's ralph post links a video captioned "watch this to learn why the claude code plugin isn’t it"
(https://ghuntley.com/ralph/). Issue #125 (open since 2026-01-06) contrasts "Fresh each iteration" with "Accumulates"
and lists "Context overflow on long-running loops (>20-30 iterations)". Its follow-up comment records the dead end:
"**Stop hooks run in a non-terminal context** (`-t 0` is always false), making it impossible to spawn an interactive
Claude session from within the hook". HumanLayer (Dex Horthy, 2026-01-06,
https://www.humanlayer.dev/blog/brief-history-of-ralph): the plugin "misses the key point of ralph which is not "run
forever" but in "carve off small bits of work into independent context windows"". Issue #274 reports a loop that
"blocks compaction, causing infinite loop when context exhausted".
Confidence: reported (Huntley, HumanLayer, issues); verified-source (issue text).

**F10 — Dynamic workflows fit a "wave": the script holds the plan, agents run in fresh contexts in the background,
and the runtime is bounded. They cannot take input mid-run, a failed agent reruns everything started after it, and
usage-limit pausing does not apply under Remote Control.**
Evidence (https://code.claude.com/docs/en/workflows.md):
- "A workflow script holds the loop, the branching, and the intermediate results itself, so Claude's context holds
  only the final answer."
- Limits: "No mid-run user input ... For sign-off between stages, run each stage as its own workflow"; "Up to 16
  concurrent agents by default, fewer when Claude Code has fewer CPUs"; "1,000 agents total per run | Prevents runaway
  loops"; "Up to 4,096 items in a single `parallel()` or `pipeline()` call"; `Date.now()` and `Math.random()` throw.
- Resume: "If a script starts A, B, C, and D in that order and B fails, relaunching returns A from cache and runs B, C,
  and D again." A relaunch is refused while agents of the stopped run are still alive.
- Usage limit: the run pauses only if "The session is interactive and signed in with a claude.ai subscription. A run
  doesn't pause in non-interactive mode with `claude -p` or the Agent SDK, in a background session, or in a Remote
  Control or agent team teammate session"; otherwise "the affected agent fails".
- Warning: "Large workflow" is shown past "25 agents, or its projected token total passes 1.5 million" (advisory).
- The Stop input lists running workflows under `background_tasks` (F06).
Confidence: verified-source. That a finished workflow wakes the orchestrator with a new turn is **inferred** from the
background-task behaviour documented for `/goal` (F07) and the Bash tool.

**F11 — Session-scoped schedules (`/loop`, `CronCreate`) fire only while the session is open and idle, in local
time, with jitter and a 7-day expiry.**
Evidence (https://code.claude.com/docs/en/scheduled-tasks.md):
- "A scheduled prompt fires between your turns, not while Claude is mid-response."
- "All times are interpreted in your local timezone."
- "Recurring tasks fire up to 30 minutes after the scheduled time (or up to half the interval, for tasks that run more
  often than hourly)."
- "Recurring tasks automatically expire 7 days after creation."
- "No catch-up for missed fires."
- "Tasks only fire while Claude Code is running and idle."
- "A session can hold up to 50 scheduled tasks."
Confidence: verified-source.

**F12 — Skill-frontmatter hooks stay registered for the rest of the session, so the house pattern gates them on a
marker file; `/harden` already solves ralph's cwd and loop bugs. The user's existing Stop hooks never block.**
Evidence:
- Skill hooks: "Claude Code registers them when you or Claude invoke the skill and keeps running them for the rest of
  the session" (hooks.md). "All matching hooks run in parallel."
- `/harden` declares PreToolUse and Stop hooks in `~/.claude/skills/harden/SKILL.md:6-18` that call
  `scripts/hook_guard.py` through Python, not jq.
- `hook_guard.py:23-27`: "Run root: the first directory holding `.harden/active` found by walking up from ... the tool
  target's directory ..., the input "cwd", then $CLAUDE_PROJECT_DIR ... No marker: exit 0 at once".
- `hook_guard.py:196`: "Stop / SubagentStop: exit 0 when stop_hook_active is true (never loop)".
- `~/.claude/settings.json` has two Stop handlers: an async `notify-on-complete.sh`, which cannot block ("Async hooks
  can't block"), and `session_signals.py done`, which only emits a `terminalSequence` for the tab title (read
  `~/.claude/hooks/session_signals.py`).
Confidence: verified-source.

### B. State files

**F13 — Anthropic's long-running harness keeps state in an init script, a progress file, git, and a JSON feature
list whose only mutable field is `passes`.**
Evidence (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents, 2025-11-26):
- "an init.sh script, a claude-progress.txt file that keeps a log of what agents have done, and an initial git
  commit".
- "over 200 features ... These features were all initially marked as “failing”". Entries look like
  `{"category": ..., "description": ..., "steps": [...], "passes": false}`.
- "We prompt coding agents to edit this file only by changing the status of a passes field, and we use
  strongly-worded instructions like “It is unacceptable to remove or edit tests...”". "After some experimentation, we
  landed on using JSON for this, as the model is less likely to inappropriately change or overwrite JSON files
  compared to Markdown files."
- Each session starts with `pwd`, reading the progress file and `git log`, choosing "the highest-priority feature
  that's not yet done", and running "a basic end-to-end test before implementing a new feature".
- The two failures it targets: the agent "tended to try to do too much at once—essentially to attempt to one-shot
  the app", and "a later agent instance would look around, see that progress had been made, and declare the job
  done."
Confidence: verified-source.

**F14 — Huntley's Ralph keeps its memory only in files and git, and the operator watches and discards the plan
often.**
Evidence (https://ghuntley.com/ralph/, 2025-07-14): "deterministically allocate the stack the same way every loop.
The items that you want to allocate to the stack every loop are your plan ("@fix_plan.md") and your specifications."
The prompt ends each loop with "When the tests pass update the @fix_plan.md`, then add changed code and @fix_plan.md
with "git add -A" ... "git commit" ... "git push"". Also "The @AGENT.md is the heart of the loop" and "The TODO list is
what I'm watching like a hawk. And I throw it out often."
Confidence: reported (author's account).

**F15 — Anthropic's hosted agent service keeps an append-only event log outside the harness, so a crashed harness
resumes from the last event.**
Evidence (https://www.anthropic.com/engineering/managed-agents, 2026-04-08): "Because the session log sits outside the
harness, nothing in the harness needs to survive a crash. When one fails, a new one can be rebooted with
wake(sessionId), use getSession(id) to get back the event log, and resume from the last event." Also "If messages are
transformed by a compaction step, the harness removes compacted messages from Claude’s context window, and these are
recoverable only if they are stored."
Confidence: verified-source.

**F16 — Two sessions in one folder cannot both run ralph: one project-wide state file, overwritten without a check,
so the first loop dies silently. Agent teams cannot span sessions either.**
Evidence: setup writes `cat > .claude/ralph-loop.local.md <<EOF` unconditionally (`setup-ralph-loop.sh:140`) with
`session_id: ${CLAUDE_CODE_SESSION_ID:-}` (`:144`); the other session's hook then exits silently (F03, case F). Earlier
versions without a `session_id` blocked every session in the folder: #64 "Stop hook affects all sessions in project",
#370, #1224 "stop hook fires in all sessions when CLAUDE_CODE_SESSION_ID is unset", #1775; #1324 reports a "race
condition when another session deletes state file". `CLAUDE_CODE_SESSION_ID` "matches the `session_id` field in the
hook JSON input and is updated on `/clear`" (env-vars.md), so `/clear` also orphans the loop. Agent teams: "One team
per session ... You can't create additional named teams or share a team across sessions" (agent-teams.md,
Limitations).
Confidence: verified-source (code, docs), reported (issues).

### C. Granularity of a work item

**F17 — Every harness that works converges on one small, independently verifiable item per fresh context, with its
acceptance criteria written before the code.**
Evidence:
- Huntley: "One item per loop. I need to repeat myself here—one item per loop. You may relax this restriction as the
  project progresses, but if it starts going off the rails, then you need to narrow it down to just one item."
- Anthropic harness: "the next iteration of the coding agent was then asked to work on only one feature at a time.
  This incremental approach turned out to be critical".
- Harness design (2026-03-24, https://www.anthropic.com/engineering/harness-design-long-running-apps): "Before each
  sprint, the generator and evaluator negotiated a sprint contract: agreeing on what "done" looked like for that chunk
  of work before any code was written", and "Sprint 3 alone had 27 criteria covering the level editor".
- Agent teams sizing (agent-teams.md): "Too small: coordination overhead exceeds the benefit ... Too large: teammates
  work too long without check-ins ... Just right: self-contained units that produce a clear deliverable, such as a
  function, a test file, or a review", and "Having 5-6 tasks per teammate keeps everyone productive".
- CooperBench, successful traces: "The successful agents move from vague intentions to specific commitments ... “I
  will modify ONLY lines 68-84. I will NOT touch anything else.”" (https://cooperbench.com/blog/curse-of-coordination)
Confidence: verified-source.

**F18 — A delegated task needs an objective, an output format, tool guidance and explicit boundaries; without them
agents duplicate work, leave gaps, or over-spawn.**
Evidence (https://www.anthropic.com/engineering/multi-agent-research-system, 2025-06-13): "Each subagent needs an
objective, an output format, guidance on the tools and sources to use, and clear task boundaries. Without detailed
task descriptions, agents duplicate work, leave gaps, or fail to find necessary information." Early failures included
"spawning 50 subagents for simple queries". Their fix was explicit effort scaling: "Simple fact-finding requires just 1
agent with 3-10 tool calls, direct comparisons might need 2-4 subagents with 10-15 calls each".
Confidence: verified-source.

### D. The verification oracle

**F19 — Models grade their own work leniently; a separate, deliberately skeptical evaluator with hard thresholds is
the lever, and it needs tuning.**
Evidence (harness design post):
- "When asked to evaluate work they've produced, agents tend to respond by confidently praising the work—even when, to
  a human observer, the quality is obviously mediocre."
- "tuning a standalone evaluator to be skeptical turns out to be far more tractable than making a generator critical
  of its own work".
- "Out of the box, Claude is a poor QA agent. In early runs, I watched it identify legitimate issues, then talk itself
  into deciding they weren't a big deal and approve the work anyway. It also tended to test superficially".
- "Each criterion had a hard threshold, and if any one fell below it, the sprint failed".
- "Communication was handled via files".
- Even on Opus 4.6 "The generator was still liable to miss details or stub features".
- "the evaluator is not a fixed yes-or-no decision. It is worth the cost when the task sits beyond what the current
  model does reliably solo."
- Cost: solo "20 min | $9" against full harness "6 hr | $200"; "over 20x more expensive".
The best-practices post adds: "A fresh context improves code review since Claude won’t be biased toward code it just
wrote."
Confidence: verified-source.

**F20 — With a loop running unattended, the verifier must be nearly perfect, guard against regressions, and keep its
output small; a green suite is not completion.**
Evidence (https://www.anthropic.com/engineering/building-c-compiler, 2026-02-05):
- "So it’s important that the task verifier is nearly perfect, otherwise Claude will solve the wrong problem."
- "near the end of the project, Claude started to frequently break existing functionality each time it implemented a
  new feature. To address this, I built a continuous integration pipeline and implemented stricter enforcement".
- Context pollution: "At most, it should print a few lines of output and log all important information to a file ...
  if there are errors, Claude should write ERROR and put the reason on the same line so grep will find it."
- Time blindness: "Claude can't tell time and, left alone, will happily spend hours running tests instead of making
  progress", fixed with "a default --fast option that runs a 1% or 10% random sample" that is "deterministic
  per-agent but random across VMs".
- "For autonomous systems, it is easy to see tests pass and assume the job is done, when this is rarely the case."
- Anthropic's harness saw the same: Claude "would fail recognize that the feature didn’t work end-to-end", fixed by
  browser automation, with a blind spot: "Claude can’t see browser-native alert modals through the Puppeteer MCP".
The user's `Coding/BNB/holdover/scripts/completion-check.mjs:1-24` encodes the same rule: "A green suite measures the
code that exists. It is silent about the code that was planned and never written", with gates such as
`G1.A1.run` "executed on mainnet, both hashes recorded".
Confidence: verified-source.

**F21 — In 1,600+ multi-agent traces, verification and termination failures are frequent, and a verifier helps but is
"not a silver bullet".**
Evidence (Cemri et al., arXiv 2503.13657v3, https://arxiv.org/html/2503.13657v3):
- Frequencies: "step repetitions (FM-1.3, 15.7%)", "not recognizing task completion (FM-1.5, 12.4%)", "premature
  termination (FM-3.1, 6.20%), no or incomplete verification (FM-3.2, 8.20%), or incorrect verification (FM-3.3,
  9.10%)".
- "Systems with explicit verifiers like MetaGPT and ChatDev generally show fewer total failures ... However, the
  presence of a verifier is not a silver bullet". Their example: "a ChatDev-generated chess program passes superficial
  checks (e.g., code compilation) but contains runtime bugs because it fails to validate against actual game rules".
- Caveat: older models (GPT-4, Claude 3) and frameworks.
Confidence: verified-source.

**F22 — Claude Code can enforce a proof at the moment a task is marked done, and can run a verifier as a hook.**
Evidence (hooks.md): TaskCompleted "Exit code 2: the task is not marked as completed and the stderr message is fed back
to the model as feedback"; agent hooks spawn "a subagent that can use tools like Read, Grep, and Glob ... After up to
50 turns, the subagent returns a structured `{ "ok": true/false }` decision", but "Agent hooks are experimental ... For
production workflows, prefer command hooks". Prompt hooks on Stop accept `"impossible": true`, and "Claude Code then
lets the turn end instead of feeding the reason back".
Confidence: verified-source.

### E. Parallel agents on one codebase: the counter-evidence

**F23 — Cognition argues that parallel agents make conflicting implicit decisions; this is reasoned from examples,
not measured.**
Evidence (Walden Yan, 2025-06-12, https://cognition.ai/blog/dont-build-multi-agents): "Principle 1 Share context, and
share full agent traces, not just individual messages"; "Principle 2 Actions carry implicit decisions, and
conflicting decisions carry bad results". The Flappy Bird example: one subagent "started building a background that
looks like Super Mario Bros"; with shared context "you might end up with a bird and background with completely
different visual styles". Conclusion: "in 2025, running multiple agents in collaboration only results in fragile
systems. The decision-making ends up being too dispersed".
Confidence: reported (argument and illustration).

**F24 — Measured: two coding agents splitting work that one agent handles do worse, and communicating does not fix
it.**
Evidence (Khatua et al., arXiv 2601.13295v2; https://cooperbench.com/blog/curse-of-coordination):
- Abstract: "agents achieve on average 30% lower success rates when working together compared to performing both
  tasks individually".
- Blog: "GPT-5 and Claude Sonnet 4.5 achieve only 25% success when two agents cooperate. That’s 50% lower than one
  agent doing both features alone."
- Scaling: "With 2 agents we saw 68.6% success. With 3 it fell to 46.5%. With 4 it dropped to 30.0%."
- "Communication does reduce merge conflicts ... But communication does not improve overall success. Despite fewer
  merge conflicts, the final merged code does not pass more tests"; "Agents spend up to 20% of their action budget on
  communication."
- Self-declared completion: "The agent promises “I’ll add the validation check.” Later it says “Done ✓”. But after
  merge, the validation code is missing." And "A merge can look clean and still be broken."
Confidence: verified-source.

**F25 — Measured across 260 configurations: multi-agent helps decomposable work, hurts sequential work, and
unchecked parallel agents amplify errors.**
Evidence (Kim et al., arXiv 2512.08296v3, abstract): "Relative performance change compared to single-agent baseline
ranges from +80.8% on decomposable financial reasoning to -70.0% on sequential planning"; "architectures without
centralized verification tend to propagate errors more". Google Research blog
(https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/):
- "on tasks requiring strict sequential reasoning ... every multi-agent variant we tested degraded performance by
  39-70%".
- "independent multi-agent systems (agents working in parallel without talking) amplified errors by 17.2x ...
  Centralized systems (with an orchestrator) contained this amplification to just 4.4x. The orchestrator effectively
  acts as a "validation bottleneck"".
Confidence: verified-source.

**F26 — Declaring each agent's write scope before it writes raised integration success from 65.6% to 96.7%, mostly by
serializing the work.**
Evidence (Nikolaev, arXiv 2608.00947, abstract, 30 CooperBench pairs, 360 runs): "Static Claim Plane raised pair
pass from 23.3% under unconstrained parallel execution to 50.0% ... and raised integration success from 65.6% to
96.7%. On conflict-labeled pairs, pair pass rose from 6.7% to 60.0%. However, static admission serialized 96.7% of
executions ... and therefore recovered reliability largely by collapsing toward serial execution", and "they do not
establish useful wall-clock parallel speedup". Caveats: single-author preprint, DeepSeek models, small sample.
Confidence: verified-source (abstract only).

**F27 — Anthropic's 16-agent compiler build ran each agent in a fresh process, claimed tasks with lock files arbitrated
by git, and stalled once the work stopped decomposing.**
Evidence (C compiler post):
- Scale: "16 agents ... nearly 2,000 Claude Code sessions and $20,000 in API costs", "2 billion input tokens and
  generated 140 million output tokens".
- Loop: `while true; do ... claude --dangerously-skip-permissions -p "$(cat AGENT_PROMPT.md)" ... done`, with "Run this
  in a container, not your actual machine" and "I did see Claude pkill -9 bash on accident, thus killing itself and
  ending the loop".
- Claiming: "Claude takes a "lock" on a task by writing a text file to current_tasks/ ... If two agents try to claim
  the same task, git's synchronization forces the second agent to pick a different one", then "pulls from upstream,
  merges changes from other agents, pushes its changes, and removes the lock. Merge conflicts are frequent".
- "I don’t use an orchestration agent."
- Limit: "compiling the Linux kernel is one giant task. Every agent would hit the same bug, fix that  bug, and then
  overwrite each other's changes. Having 16 agents running didn't help". The fix was an oracle that split the problem
  ("GCC as an online known-good compiler oracle").
- Duplicates: "LLM-written code frequently re-implements existing functionality, so I tasked one agent with coalescing
  any duplicate code it found."
Confidence: verified-source.

**F28 — Multi-agent spends about 15x the tokens of chat and wins mainly by spending them; Anthropic warns coding is
less parallelizable than research.**
Evidence (multi-agent research system post): "outperformed single-agent Claude Opus 4 by 90.2% on our internal research
eval"; "token usage by itself explains 80% of the variance"; "agents typically use about 4× more tokens than chat
interactions, and multi-agent systems use about 15× more tokens than chats"; "most coding tasks involve fewer truly
parallelizable tasks than research, and LLM agents are not yet great at coordinating and delegating to other agents
in real time"; "we built systems that can resume from where the agent was when the errors occurred ... deterministic
safeguards like retry logic and regular checkpoints"; and "Synchronous execution creates bottlenecks ... the entire
system can be blocked while waiting for a single subagent".
Confidence: verified-source.

**F29 — Claude Code's own docs warn that parallel teammates overwrite each other, that the lead stops early, and that
task status lags.**
Evidence (agent-teams.md):
- "Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of
  files."
- "The lead can stop early too, deciding the team is finished before all tasks are actually complete."
- "Task status can lag: teammates sometimes fail to mark tasks as completed, which blocks dependent tasks."
- "For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more
  effective."
- "Task claiming uses file locking to prevent race conditions"; "Start with 3-5 teammates for most workflows".
agents.md: "Worktrees give each session a separate git checkout, so parallel sessions never edit the same files."
Confidence: verified-source.

### F. Operational facts for this machine

**F30 — ralph's shell hook does run under Git Bash here: `bash` resolves to Git's, jq comes from scoop and emits
CRLF, and MSYS2 tolerates the CRs; the WSL and profile-echo traps remain.**
Evidence (executed 2026-09-30):
- Shell-form hooks run through "Git Bash on Windows, or PowerShell when Git Bash isn't installed" (hooks.md).
- `which -a bash` -> `/usr/bin/bash` first; `where.exe bash` -> `C:/Program Files/Git/usr/bin/bash.exe` then
  `C:/Windows/System32/bash.exe`, the WSL launcher the README warns about ("may resolve to WSL bash",
  `README.md:176`).
- jq is not part of Git for Windows; here it is `scoop/shims/jq` 1.8.1. Its raw output is `abc-123` followed by CR LF
  (od). MSYS2 command substitution strips a trailing CR LF but keeps interior ones.
- `[[ -f 'C:/.../t.jsonl' ]]` with a backslashed Windows path succeeds.
- A byte-verified CRLF state file still parsed, because GNU sed 4.9 in Git for Windows reads text mode. My CRLF
  hypothesis is refuted on this machine; it would still hold under a Linux or WSL bash.
- Open Windows issues: #1129 "fails on Windows paths with spaces"; #4909 "`jq` is a hard dependency and absent on many
  Windows/Git-Bash setups".
- hooks-guide.md: "Git Bash and some configurations ... still source your profile. If that profile contains
  unconditional `echo` statements, the output gets prepended to your hook's JSON", which then is ignored.
Confidence: verified-executed.

**F31 — Measured today: 16 logical CPUs, so workflows default to 16 concurrent agents, but C: had 2.4 GB free; every
worktree needs its own dependency install.**
Evidence: `nproc` -> `16`; `df -h /c` -> `C: 454G 452G 2.4G 100% /c`, measured during this research (the brief
recorded 6.9 GB this morning). workflows.md: "Up to 16 concurrent agents by default, fewer when Claude Code has fewer
CPUs available ... set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`". worktrees.md: "A worktree is a fresh checkout,
so initialize your development environment there: ask Claude to install dependencies", and "a worktree with changes
stays on disk until the periodic sweep".
Confidence: verified-executed (measurements), verified-source (docs).

**F32 — Long contexts degrade gradually, and compaction or resets each have costs; Opus 4.5+ dropped the need for
resets in Anthropic's harness.**
Evidence:
- Chroma (2025-07-14, https://research.trychroma.com/context-rot): across "18 LLMs ... their performance grows
  increasingly unreliable as input length grows".
- Anthropic context engineering (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):
  "context rot"; Claude Code compaction continues "with this compressed context plus the five most recently accessed
  files" and "overly aggressive compaction can result in the loss of subtle but critical context"; sub-agents return
  "a condensed, distilled summary of its work (often 1,000-2,000 tokens)".
- Harness design: "context anxiety ... wrapping up work prematurely"; "Opus 4.5 largely removed that behavior on its
  own, so I was able to drop context resets".
- Managed Agents: "The resets had become dead weight."
- Huntley (Claude 3.7 era): "approximately 170k of context window to work with ... The more you use the context
  window, the worse the outcomes you'll get."
Confidence: verified-source.

**F33 — Practitioner prior art: Ralph Orchestrator blocks the loop on a human question over Telegram and gates work
behind tests, lint and typecheck.**
Evidence (https://github.com/mikeyobrien/ralph-orchestrator README): "Ralph iterates until it outputs `LOOP_COMPLETE`
or hits the iteration limit"; "Backpressure — Gates that reject incomplete work (tests, lint, typecheck)"; "Agents emit
`human.interact` events; the loop blocks until a response arrives or times out"; "Telegram commands — `/status`,
`/tasks`, `/restart`". Huntley on back pressure (https://ghuntley.com/pressure/): "software engineering is now about
preventing failure scenarios and preventing the wheel from turning over through back pressure to the generative
function".
Confidence: verified-source (README), reported (Huntley).

**F34 — Cost and outcome reference points.**
Evidence:
- Huntley quotes a "$50k USD contract, delivered, MVP, tested + reviewed ... $297 USD" and expects "you'll get 90%
  done" (reported).
- Anthropic's DAW harness run: "Total V2 Harness | 3 hr 50 min | $124.70", of which QA rounds cost $3.24, $3.09 and
  $4.06.
- The C compiler: $20,000, 2B input and 140M output tokens (F27).
- HumanLayer: "If you leave ralph running too long, you end up with all sorts of bizarre emergent behavior, like
  post-quantum cryptography support" ("overbaking").
Confidence: verified-source (Anthropic), reported (Huntley, HumanLayer).

---

## Implications for /execution

### 1. Stop and continue: event-driven, gated by mechanical state, never by a promise string
- **Keep the orchestrator thin.** The user's interactive session is the scheduler: Huntley's "primary context window
  should operate as a scheduler", Anthropic's orchestrator-worker split, and Google's "validation bottleneck". It holds
  the plan path, the current wave and short summaries. Implementation and verification happen in fresh agent contexts
  (F09, F25, F28, F32).
- **One wave is one background dynamic workflow.** Workflows take no mid-run input, so a manual task marks a wave
  boundary and each approval sits between two workflows (F10). The finished workflow wakes the orchestrator with a new
  turn (inferred, F10), which then:
  - re-runs proofs mechanically;
  - updates the plan;
  - pushes the per-wave Notion report (decision 7);
  - launches the next wave.
- **Add a Stop command hook as the deterministic gate** (F08), declared in the skill's frontmatter. Follow the house
  pattern (F12): it acts only while `.execution/active` exists, runs as Python or Node in exec form (no jq, F30), and
  anchors to the repo root from the payload `cwd`, then `CLAUDE_PROJECT_DIR`, then `git rev-parse --show-toplevel`
  (F03). Its decision table:
  - `background_tasks` non-empty -> allow the stop. The session is paused and will be woken (F06).
  - Only manual or blocked tasks runnable -> allow, write state `BLOCKED_ON_HUMAN` with the list of what the developer
    must do, and notify. This is the honest exit ralph lacks (F05).
  - Completion check exits 0, run by the hook itself -> allow, write `BUILD_COMPLETE`, then hand over to /harden.
  - Runnable agent tasks and nothing in flight -> block, with a computed `reason` naming the next wave's task ids. Do
    this only if a hash of (plan state + git HEAD) changed since the last block; otherwise allow and write `STALLED`
    (F04 no-progress detection).
  - `stop_hook_active` is not a reason to allow here. The progress hash and Claude Code's 8-block cap (F06) are the
    backstops. Leave `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` at its default unless a test shows orchestrator turns legitimately
    exceed it.
- **Treat `/goal` as optional, not as the gate.** Its evaluator only reads the transcript (F07). If used, pair it with
  the command hook, never instead of it. How the two interact in one session is untested (open question 5).
- **Do not add an external `claude -p` loop for the Origins run.** Fresh context per iteration is its strength (F09,
  F27). Its costs here: no workflow pause on usage limits under `-p` (F10), unclear Remote Control reach, and
  permission handling. Keep it as a fallback design only.

### 2. State files (repo-anchored, per run, outside the conversation)
- `.execution/plan.json` is the plan (JSON, not Markdown, F13). One entry per task: id, owner (agent, devA, devB),
  deps, wave, declared file scope, proof `{type, command|tx|url|file, expected}`, estimate (time and tokens), model and
  effort, status, attempts, receipts. Agents never edit it directly; a script (`plan.py tick|claim|block`) does, and
  only a verifier result sets `proven` (F13, F19).
- `.execution/events.jsonl` is an append-only log (wave start and end, verifier verdicts, manual reports, user
  decisions). Resume means replaying it (F15). It covers compaction, a crash, laptop sleep in transit, and a
  phone-driven restart.
- `.execution/progress.md` holds short notes for fresh agents, plus git history (F13, F14). Commit after every proven
  task, following the user's conventional commits with no AI attribution.
- `.execution/receipts/<task>.txt` holds the proof output: short, with ERROR on the failing line and the full log in a
  file (F20).
- `.execution/active` is the hook marker, carrying the run id and session id. Namespace everything by run id so a
  second session in the folder cannot clobber it (F16).

### 3. Granularity (a planning rule the plan validator can enforce)
- One task produces one deliverable, is checked by one proof written at plan time (the sprint contract, F17) and
  approved in the one plan approval, and has a declared file scope and a size one fresh agent context can finish.
- Each task description carries objective, output format, tools, boundaries and "do not assume it's not implemented,
  search first" (F18, F14).
- A task too large for one proof splits. A task that only moves a shared file (types, config, schema) runs alone before
  the wave that depends on it: pin shared decisions first (F23).

### 4. The verification oracle
- **Accepted proof types**, each re-checked by the verifier, never taken from the implementer's words:
  - a command that exits 0, re-run in a clean state;
  - a tx hash re-read on chain;
  - a CI run id re-queried;
  - a file that exists with a content check;
  - a URL that resolves.
- **The verifier is a separate agent with a skeptical prompt and hard thresholds** (F19). It checks that a proof
  cannot pass trivially: skipped tests, stubs, TODOs (F20, F21, F24).
- **Two levels of "done".** The task proof, plus a plan-level completion check in the style of `completion-check.mjs`,
  kept out of CI and run by the Stop hook. A regression gate (full suite or CI) closes each wave (F20).
- **Oracle output hygiene:** a few lines, ERROR lines greppable, a deterministic `--fast` sample for slow suites (F20).

### 5. Parallelism policy
- Put tasks in the same wave only when their file scopes are disjoint and they share no undecided interface. Overlap
  serializes (F24, F26, F27, F29). Use worktree isolation only where disk allows (F31).
- Use a single validation agent per wave for builds and tests, to avoid contention (Huntley back pressure, F14 and
  ralph post).
- Cap concurrency by disk first: set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` well below 16, and check free space
  before each wave (F31).
- **Dev A and dev B:** two orchestrators on one repository reproduce CooperBench's setup (F24). Partition tasks by
  owner and file scope at plan time. Claims need an atomic arbiter: a git push rejected as non-fast-forward is proven
  (F27); Notion's atomicity is an open question for the Notion researcher. Always re-verify after integrating the
  other developer's commits.

### 6. Budgets and brakes
- Enforce a maximum number of waves, a per-task attempt cap (the /harden house rule is 3, each from the last green
  commit), a per-wave token budget (workflows show per-agent usage; warning above 25 agents or 1.5M tokens, F10), and a
  wall-clock deadline stored in UTC.
- Guard against scope creep: anything not in the plan becomes a proposal to the user, never work (decision 2). Running
  unattended past the plan's scope "overbakes" (F34).
- Budget tokens against the multipliers: about 15x chat for multi-agent (F28), and more than 20x for an
  evaluator-heavy harness (F19).

### 7. Manual tasks, the phone and the clock
- A manual task ends the turn honestly (`BLOCKED_ON_HUMAN`). The developer's report (tx hash, screenshot path,
  transcript) is recorded as an event, then verified mechanically before dependants unblock (F05, F33).
- Under Remote Control, a workflow agent that hits the usage limit fails instead of pausing (F10). Prefer small waves
  and keep `autoContinueAtUsageLimit` on in the laptop's own interactive session.
- Fixed-cadence tasks (channel re-reads, the T-6h demo audit) scheduled with cron fire only when the session is idle.
  They use the laptop's local timezone, which moves from Paris to Singapore, jitter by up to 30 minutes, and have no
  catch-up (F11). Store deadlines in UTC and let the orchestrator compute due tasks at each wake rather than trusting
  cron alone.

---

## Risks and failure modes to design against

| # | Failure mode | Seen in | Design answer |
| :- | :- | :- | :- |
| R1 | Declaring the project done early; one agent looks around and stops | F13, F29 ("The lead can stop early"), F21 FM-3.1/FM-1.5, F24 ("Done ✓") | completion decided by the hook's mechanical check, never by the model |
| R2 | Lenient self-grading; QA agent talks itself out of real bugs | F19 | separate skeptical verifier, hard thresholds, tuned on traces |
| R3 | Placeholder, stub or minimal implementations | F14 ("inherent bias to do minimal and placeholder implementations"), F19 ("stub features") | verifier checks for stubs and TODOs; proof must exercise behaviour |
| R4 | False "not implemented" leading to duplicate implementations | F14 ("Achilles' heel"), F27 (dedupe agent) | search-first instruction; dedupe check in wave review |
| R5 | New work breaks old work | F27, F20 | regression gate (full suite or CI) closes each wave |
| R6 | Runaway or no-progress loop | F04 (6,239 iterations), F21 (step repetition 15.7%) | progress hash, wave and attempt caps, 8-block cap |
| R7 | Honest agent trapped by human-only work | F05 | explicit BLOCKED_ON_HUMAN exit |
| R8 | Silent loop death (cwd drift, session mismatch, hook exit 1) | F03, F16 | anchored paths, loud logging to the events log, heartbeat in the Notion report |
| R9 | Completion signal missed (transcript lag, delegated work) | F02 | never parse the transcript; read plan and receipts |
| R10 | Context rot or overflow in the orchestrator | F09, F32 | thin orchestrator; state in files; summaries of 1-2k tokens |
| R11 | Parallel overwrites, merge conflicts, conflicting implicit decisions | F23, F24, F26, F27, F29 | disjoint declared scopes; pin shared decisions first; serialize overlap |
| R12 | Error amplification without a central check | F25 (17.2x against 4.4x) | orchestrator verifies every wave before the next starts |
| R13 | Token blow-up | F28, F19, F34 | per-wave budgets; model and effort per task |
| R14 | Workflow relaunch reruns finished agents after a mid-fan-out failure | F10 | small waves; idempotent tasks; proofs recorded before relaunch |
| R15 | Usage-limit failure under Remote Control | F10 | small waves; run from the interactive laptop session |
| R16 | Disk exhaustion from parallel installs and worktrees | F31 (2.4 GB free) | disk check before each wave; low concurrency cap |
| R17 | Agent kills or bypasses its own loop (`pkill -9 bash`; deletes the marker) | F27, F12 | treat marker removal as run-control; log it; hook refuses edits to `.execution/active` |
| R18 | Cron in local time drifts across timezones; up to 30 min jitter; no catch-up | F11 | UTC deadlines computed at each wake |
| R19 | Windows shell pitfalls (WSL bash, missing jq, profile echo, paths with spaces) | F30 | Python or Node hooks in exec form; absolute anchored paths |
| R20 | Hooks of other sources interfering (any single blocking Stop hook wedges the turn) | F12, #5312 | audit Stop hooks at setup; the user's current ones never block |

---

## Open questions

1. Does tool use between blocks reset Claude Code's 8-consecutive-block counter? The reference says "eight times in a
   row"; the guide says "without progress" (F06). Test it in a throwaway session before relying on either reading.
2. Does a finished workflow start a new turn that also resets the counter? Inferred yes (F10); verify with a
   one-agent workflow.
3. Is `CLAUDE_CODE_SESSION_ID` exported inside a skill's or slash command's `!` shell block? Issues #1224 and #1319
   suggest it once was not. This matters for namespacing state by session.
4. Can Notion via MCP give an atomic claim (compare-and-set on a status property) for dev A and dev B? If not, claims
   belong in git (F27) and Notion stays a mirror.
5. How do `/goal` and a custom Stop command hook interact in one session (both run; which verdict wins)? Only needed if
   `/goal` is adopted.
6. Do Stop hooks and background-task wake-ups behave the same in a session driven through Remote Control from the phone?
   The docs confirm `/goal` works there and that workflow usage-limit pauses do not (F07, F10).
7. How do session crons behave when the laptop's timezone changes mid-session (Paris to Singapore)?
8. Should the verifier be a workflow agent in the same wave or a separate verification workflow? The first is cheaper;
   the second avoids sharing a run with the implementer. The harness-design post used separate agents communicating
   via files (F19).

---

## Sources

Local files (read in full unless noted):
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/`: `README.md`, `hooks/hooks.json`,
  `hooks/stop-hook.sh`, `scripts/setup-ralph-loop.sh`, `commands/ralph-loop.md`, `commands/cancel-ralph.md`,
  `commands/help.md`, `.claude-plugin/plugin.json` (LICENSE listed, not read).
- `~/.claude/skills/harden/SKILL.md` (frontmatter and run-state lines); `~/.claude/skills/harden/scripts/hook_guard.py`
  (docstring lines 16-205).
- `~/.claude/settings.json` (hook commands and key names only); `~/.claude/hooks/session_signals.py` (header).
- `~/Documents/Coding/BNB/holdover/scripts/completion-check.mjs`; `~/Documents/Coding/Hedera/research/findings/TASKLIST.md`
  (header and first sections).
- Executed experiments: an unmodified copy of `stop-hook.sh` driven with scripted state and transcript files, cases
  A-I, in the session scratchpad (`ralphexp/`); jq and MSYS2 byte tests; `nproc`; `df -h /c`; `claude --version`
  (2.1.285).

Claude Code documentation (fetched as Markdown on 2026-09-30):
- https://code.claude.com/docs/en/hooks.md (Stop, SubagentStop, TaskCompleted, TeammateIdle, exit codes, shell form,
  prompt and agent hooks, async hooks, skill hooks)
- https://code.claude.com/docs/en/hooks-guide.md (Stop hook hits the block cap; Hook JSON has no effect)
- https://code.claude.com/docs/en/env-vars.md (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, `CLAUDE_CODE_SESSION_ID`,
  `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`, `CLAUDE_CODE_BRIDGE_SESSION_ID`)
- https://code.claude.com/docs/en/goal.md
- https://code.claude.com/docs/en/workflows.md
- https://code.claude.com/docs/en/agents.md
- https://code.claude.com/docs/en/agent-teams.md
- https://code.claude.com/docs/en/worktrees.md
- https://code.claude.com/docs/en/scheduled-tasks.md
- https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (v2.1.143 block cap; background_tasks;
  last_assistant_message)

Anthropic engineering:
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents (2025-11-26, Justin Young)
- https://www.anthropic.com/engineering/harness-design-long-running-apps (2026-03-24, Prithvi Rajasekaran)
- https://www.anthropic.com/engineering/multi-agent-research-system (2025-06-13)
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (2025-09-29)
- https://www.anthropic.com/engineering/building-c-compiler (2026-02-05, Nicholas Carlini)
- https://www.anthropic.com/engineering/claude-code-best-practices
- https://www.anthropic.com/engineering/managed-agents (2026-04-08)

Ralph, practitioners and the plugin tracker:
- https://ghuntley.com/ralph/ (2025-07-14); https://ghuntley.com/loop/ (2026-01-17); https://ghuntley.com/pressure/
  (2026-01-17, public part)
- https://www.humanlayer.dev/blog/brief-history-of-ralph (2026-01-06)
- https://github.com/mikeyobrien/ralph-orchestrator (README)
- anthropics/claude-plugins-official issues #64, #125, #274, #370, #1224, #1324, #1699, #1129, #3632, #3989, #4909,
  #5312, #5536, and PR #5605 (https://github.com/anthropics/claude-plugins-official/issues/<n>)

Counter-evidence and measurements:
- https://cognition.ai/blog/dont-build-multi-agents (2025-06-12, Walden Yan)
- https://arxiv.org/abs/2601.13295 and https://cooperbench.com/blog/curse-of-coordination (CooperBench)
- https://arxiv.org/abs/2512.08296 and https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
- https://arxiv.org/abs/2503.13657 (MAST; section text from https://arxiv.org/html/2503.13657v3)
- https://arxiv.org/abs/2608.00947 (Claim Plane confirmatory study); https://arxiv.org/abs/2607.21909
- https://research.trychroma.com/context-rot (2025-07-14)
