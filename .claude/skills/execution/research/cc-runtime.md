# /execution research dossier: Claude Code runtime behaviour for a multi-hour, multi-day autonomous orchestrator

- Dimension: Claude Code runtime (background work, scheduling, reaching the human, usage limits, cloud execution, models and effort).
- Date: 2026-09-30, Paris (Romance Standard Time).
- Installed Claude Code: `2.1.285` when this research started; the native binary auto-updated itself to `2.1.286` at 21:09 during the research (`claude --version`, file `C:/Users/Utilisateur/.local/bin/claude.exe`, mtime 21:09).
- Documentation: raw Markdown of `https://code.claude.com/docs/en/<page>.md`, fetched 2026-09-30 (changelog head = 2.1.285, "September 29, 2026"). "Lnnn" below is the line number in that raw `.md` on that date.
- Binary evidence: printable strings of the installed native binary. The code is minified, so any reading of logic from it is marked as an interpretation.
- Method limits: research only. No test session was started, no usage limit was triggered, nothing was sent to Notion, GitHub or any service. Behaviours that need a live test are listed under Open questions.

## Summary for the designer

1. **Idle wake-ups exist.** When a background Bash command, background subagent or Workflow run finishes, a cron or `/loop` job fires, a Monitor emits a line, another session sends a message, or an `asyncRewake` hook exits 2, an idle interactive session starts a new turn by itself (F01, F13-F18). A turn that ends with nothing armed stays idle for good. /execution needs a rule that it never stops with no wake source: a skill-scoped Stop hook (its input includes `background_tasks` and `session_crons`) plus one CronCreate heartbeat (F17, F13).
2. **The orchestrator has to be the main loop of one interactive session.** Subagents never get `Workflow`, `ScheduleWakeup` or `AskUserQuestion` (F10). A Workflow run can be resumed only in the same session (`resumeFromRunId`: "Same session only"). Otherwise its results have to be recovered by hand from `journal.jsonl` (F08). Each wave should be one Workflow run: no user input mid-run, at most 16 agents at once by default, 1,000 per run, and `Date.now()` is not allowed (F09).
3. **What survives what.**
   - A plain terminal session ends when its window closes.
   - A `/bg` or `claude --bg` session survives a closed terminal and S3 sleep, but not a shutdown. Backgrounding stops Monitors, restarts workflow agents that are still running, and removes the automatic wait at a usage limit (F04-F06, F30, F31).
   - Remote Control needs the local process running. In an interactive session it reconnects no matter how long the outage lasts; server mode exits after about 10 minutes offline (F26).
   - The API gives up after 10 retries by default. `CLAUDE_CODE_RETRY_WATCHDOG=1` stretches that to about 3 hours (F07).
4. **Limits.** The 5-hour and weekly windows are shared by claude.ai, Claude Code and cloud sessions, and a large fan-out can use up the weekly window. The automatic continue after a limit (on by default) only works in an interactive subscription session, when the reset is less than 24 h away, for at most 2 re-arms, and it needs Enter after more than 30 minutes of sleep. Running out of the weekly window stops the build (F29-F31). A session can read usage only from the status-line JSON `rate_limits` or the SDK `rate_limit_event`, so `statusline.py` should also write a snapshot file (F32).
5. **Phone.** Pushes reach the phone only while Remote Control is connected. `agentPushNotifEnabled` (set) covers pushes Claude decides to send. `inputNeededNotifEnabled` (not set) is needed for pushes on permission prompts and questions. No push is sent while the user is at the terminal (F22, F23). From the phone the user can send prompts and photos, answer `AskUserQuestion` and permission prompts, stop tasks, and run a short list of built-in commands. The phone cannot select bypass or auto mode (F25-F27).
6. **Cloud.** `claude --cloud` sessions keep running with the laptop closed. They clone from GitHub, have no user-level skills, CLAUDE.md or MCP servers unless these are committed to the repo, run on 4 vCPU / 16 GB / 30 GB Ubuntu, pause when idle, and lose background work when the VM is reclaimed. Routines run at least 1 h apart, act as the user, and can use the claude.ai Notion connector (F19, F34). `isolation:"remote"` for the Agent tool exists in the binary but is gated and undocumented (F35).
7. **Models.** Prices per million input/output tokens: Opus 5.5 $4/$20 (cache hit 0.05x), Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5, Fable 5.1 $10/$50. Fable can bill to usage credits, and its consent prompt ends an unattended turn after 5 minutes (F37, F41). Workflow `agent()` accepts `opts.model` and `opts.effort`. Agents with the same model, effort, type, tools, schema and working directory share one prompt-cache prefix. A subagent's cache lives 5 minutes unless `subagentPromptCacheTtl` is set to `"1h"` (F39, F40).
8. **Machine.** C: had 1.9 GB free at 21:16 today and 4.8 GB at 21:22. Two old copies of `claude.exe`, about 485 MB, sit in `~/.local/bin`. Auto-update is on the `latest` channel and changed the version during this research. The machine is on Paris time, so cron runs in Paris time, and SGT is Paris + 6 h (F43-F45).

## Findings

Confidence scale: **verified-executed** (I ran it on this machine), **verified-source** (official docs, the shipped tool descriptions, or strings in the installed binary), **reported** (secondary source), **inferred** (my deduction, not sourced).

### Q1. Background work, wake-ups and lifecycle

**F01. When background work finishes after the turn has ended and the user is idle, Claude Code re-invokes the model automatically (new turn).** Load-bearing.
- Evidence:
  - `https://code.claude.com/docs/en/goal.md` L152: "When the background work finishes, Claude Code delivers the result to Claude as a new turn, so you don't have to prompt."
  - `sub-agents.md` L906: "A background subagent's results reach Claude as a completion notification in a later turn."
  - The Bash tool description shipped in this session: "`run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits."
  - `agent-sdk/typescript.md` (WorkflowOutput): "Returns immediately after the tool accepts the invocation. The final result arrives later as a task completion."
  - A string in the binary, from the self-paced `/loop` prompt: "If you were woken by a `<task-notification>` rather than this prompt: handle the event in the context of the loop task".
  - Executed in this session: a background grep finished and was delivered mid-turn as `<task-notification> ... <status>completed</status>`, preceded by "This is an automated background-task event, NOT a message from the user."
- Confidence: verified-source; delivery format verified-executed (in a workflow-agent context).
- Implication: after launching a wave, /execution can end its turn with no polling. The wave's completion notification wakes it.

**F02. When several background tasks finish together, their notifications are queued and shown collapsed. Batching into a single turn is not documented.** Not load-bearing.
- Evidence:
  - Changelog v2.1.6 (L6541): "Changed task notification display to cap at 3 lines with overflow summary when multiple background tasks complete simultaneously".
  - Changelog v2.1.234 (L2356): "Background task notifications delivered between turns are now sent to the model inside `<system-reminder>` tags, matching mid-turn delivery".
  - `scheduled-tasks.md` L166: "A scheduled prompt fires between your turns, not while Claude is mid-response. If Claude is busy when a task comes due, the prompt waits until the current turn ends."
- Confidence: display cap verified-source. My reading is inferred: notifications that arrive during a turn are injected between tool calls, and those that arrive while idle start one turn that later arrivals join.
- Implication: the tick handler must be idempotent. It reads the state file and handles every finished task it finds, not only the one that woke it.

**F03. Automatic compaction does not stop background work, but it cuts what the orchestrator remembers.** Load-bearing.
- Evidence:
  - `context-window.md` L1607: "Background commands and background subagents | Keep running. Claude Code reminds Claude which ones are still running so it doesn't start a duplicate".
  - Changelog v2.1.260 (L1639): "Fixed Workflow tool subagents being restarted as stalled while a long context compaction was still in progress". This shows workflows keep running during compaction.
  - `context-window.md` L1606: "Invoked skill bodies | Re-injected, capped at 5,000 tokens per skill and 25,000 tokens total; oldest dropped first". L1615: "Truncation keeps the start of the file, so put the most important instructions near the top of `SKILL.md`."
- Confidence: verified-source.
- Implication: the /execution state machine and its invariants must fit in the first ~5,000 tokens of `SKILL.md`. Plan state belongs on disk and in Notion, not in the conversation.

**F04. A plain terminal session ends when its terminal closes, and its background work ends with it. The results of a workflow run stay on disk.** Load-bearing.
- Evidence:
  - `agent-view.md` L773: "a session started by running `claude` directly is tied to that terminal and ends when it closes, unless you send it to the background."
  - `interactive-mode.md` L313: "Background tasks are automatically cleaned up when Claude Code exits."
  - `agent-view.md` L404: "Exiting a session that still has background work running, such as subagents, background shell commands, workflows, or monitors, shows a `Background work is running` dialog instead of quitting immediately. Choose `Move to background and exit` ... The option isn't shown when agent view is turned off."
  - `workflows.md` L391: "If you choose `Exit and stop tasks` instead, or the option isn't offered, the run stops with the session. Claude Code keeps the run's saved results under that session's directory in `~/.claude/projects/`, so a session you resume with `claude --resume` can replay them when you ask Claude to relaunch the workflow. In a session you start fresh, Claude has no earlier run to relaunch and starts the workflow over as a new run."
- Confidence: verified-source. Inferred: closing the Windows Terminal window with its X button kills the process without showing that dialog.

**F05. A background session (`/bg`, `claude --bg`, run by the supervisor) survives a closed terminal and sleep, not a shutdown. Some work does not carry over into it.** Load-bearing.
- Evidence (`agent-view.md`):
  - L779: "The supervisor is a background service that runs your background sessions so they keep working after you close agent view or your terminal."
  - L783-784: "Working, paused on a permission prompt or other dialog, or attached: the process keeps running. A running subagent, workflow, or monitor counts as working." and "Finished or waiting for your next message, and unattached for about an hour: the supervisor stops the process to free resources ... Pin a session with `Ctrl+T` to keep its process running."
  - L852: "Sleep alone doesn't stop sessions. Sessions are preserved across sleep and the supervisor reconnects to them on wake."
  - L845: "Shutting down or restarting your machine stops running background sessions."
  - L433: "running background shell commands, backgrounded subagents, dynamic workflows, scheduled tasks you created with `/loop`, and Claude's automatic replies to artifact comments all carry over".
  - L435: "subagents that were still running start over from the beginning, so the tokens they used so far are spent again."
  - L437: "Claude Code stops work that can't carry over, such as a running monitor".
  - L739-765: `claude agents --json [--all]` reports `state` as one of `working`, `blocked`, `done`, `failed` or `stopped`, and gives `waitingFor` for a blocked session.
- Confidence: verified-source.
- Implication: backgrounding is a way to survive a closed terminal, but it costs something (see F30, F31: no automatic wait at a usage limit). Background the session only between waves, never while a wave's agents are running.

**F06. Laptop sleep: API requests broken by sleep are retried. A usage-limit reset that happens during more than 30 minutes of sleep needs Enter. This machine only has S3 sleep.** Load-bearing.
- Evidence:
  - `errors.md` L354: "A connection that Claude Code detects was broken by your computer going to sleep partway through a request. Claude Code counts it as a dropped connection under the rules above".
  - `interactive-mode.md` L667: "After your computer slept: if it slept for more than about 30 minutes and the limit reset while it slept, the line reads `Your usage limit has reset · press enter to continue`."
  - `remote-control.md` L16: "if your laptop sleeps or your network drops, Claude Code reconnects automatically when your machine comes back online."
  - `scheduled-tasks.md` L209: "No catch-up for missed fires."
  - Executed `powercfg /a`: only "Veille (S3)" is available; hibernation is not enabled.
- Confidence: verified-source and verified-executed. Inferred: during S3 every process is frozen (claude, background shells, workflow agents), so nothing makes progress while the lid is closed.

**F07. When the network drops, a turn fails after 10 retries by default. The retry watchdog stretches that to about 3 hours. Remote Control server mode exits after about 10 minutes offline.** Load-bearing.
- Evidence:
  - `errors.md` L348: "Claude Code retries transient failures up to 10 times with exponential backoff before showing you an error."
  - `env-vars.md` L356, `CLAUDE_CODE_RETRY_WATCHDOG`: "Set to `1` for unattended sessions such as eval harnesses, CI jobs, or remote workers. Retries `429` and `529` capacity errors indefinitely ... The watchdog backs off up to 5 minutes between attempts, or until the limit resets when the response carries a rate-limit reset time, so a session that hits a usage limit waits out the remaining window. On v2.1.199 or later it also raises the default retry count for other transient errors, such as server errors, timeouts, and dropped connections, to 300, roughly three hours of backoff".
  - `remote-control.md` L340-341: "Server mode: Claude Code gives up after roughly 10 minutes and the `claude remote-control` process exits." and "Interactive session: keep working locally. Claude Code retries for as long as the outage lasts and reconnects on its own when the network returns."
- Confidence: verified-source.

**F08. A Workflow run can be resumed only within the same session. A resumed or backgrounded copy of that session can replay it. Otherwise it has to be recovered by hand from the journal.** Load-bearing.
- Evidence:
  - `agent-sdk/typescript.md` L3096: "`resumeFromRunId` ... Run ID of a prior `Workflow` invocation to resume. Completed `agent()` calls with unchanged inputs usually return cached results; the rest run live. ... Same session only".
  - `workflows.md` L382-386 gives the replay rules. A completed agent returns its saved result; the first agent whose prompt differs "runs again, and so does every agent after it". An agent that failed runs again, and so do all agents started after it.
  - `workflows.md` L395: when saved results are missing, "the relaunch fails with a `nothing to resume` error".
  - Binary (Workflow tool text): "Per-agent results: .../journal.jsonl — one {"type":"result",...} line per completed agent with its full return value." and "Fallback when no journal is available: Read agent-<id>.jsonl files in the transcript directory and hand-author a continuation script."
- Confidence: verified-source.
- Implication: for each wave, the state file must record `runId`, `scriptPath` and `transcriptDir`. Recovery goes `claude --resume <session>`, then `Workflow({scriptPath, resumeFromRunId})`. If the session is lost, a new session reads `journal.jsonl` and relaunches only the unfinished items.

**F09. Workflow runtime limits.** Load-bearing.
- Evidence (`workflows.md` L362-368):
  - "No mid-run user input | A run pauses on its own only for agent permission prompts and a usage-limit wait. For sign-off between stages, run each stage as its own workflow".
  - "Up to 16 concurrent agents by default, fewer when Claude Code has fewer CPUs available ... `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` to a value from 1 to 256".
  - "Up to 4,096 items in a single `parallel()` or `pipeline()` call"; "1,000 agents total per run".
- Evidence (other lines of `workflows.md`):
  - L334: "Claude Code makes `Date.now()`, `Math.random()`, and a no-argument `new Date()` throw inside the script".
  - L183: "Bypass permissions | Claude Code doesn't prompt you. The run starts immediately".
  - L416: a `Large workflow` warning appears above 25 agents or 1.5M projected tokens.
  - L445: "The default is `medium`" (size guideline, fewer than 10 agents).
- Executed: `nproc` = 16.
- Confidence: verified-source; CPU count verified-executed.

**F10. Subagents never get `Workflow`, `ScheduleWakeup` or `AskUserQuestion`, so the orchestrator has to be the main loop.** Load-bearing.
- Evidence:
  - `sub-agents.md` L424-433 lists the tools removed from every subagent: "`AskUserQuestion` ... `EnterPlanMode` ... `ScheduleWakeup` ... `WaitForMcpServers` ... `Workflow`".
  - L435: a background subagent keeps only `Read, Grep, Glob, LSP, Bash, PowerShell, Edit, Write, NotebookEdit, WebFetch, WebSearch, TodoWrite, Skill, ToolSearch, EnterWorktree, ExitWorktree, Monitor, TaskStop, SendMessage, Artifact` (plus MCP tools).
  - L1011: nesting goes "up to three layers below the main conversation".
  - L1042: "when 20 subagents are running in a session, spawning another with the Agent tool fails with `Concurrent subagent limit reached`" (workflow agents follow their own limit).
- Executed: in this workflow-agent session, ToolSearch for `ScheduleWakeup` returned nothing.
- Confidence: verified-source and verified-executed.

**F11. A background Bash or PowerShell command gets 30 minutes by default and 2 hours at most. A command started by a foreground subagent dies with that subagent.** Load-bearing.
- Evidence:
  - `tools-reference.md` L188: "A command that Claude starts in the background gets 30 minutes, or the `timeout` Claude passes with `run_in_background`, up to a maximum of 2 hours". The limit can be raised with `BASH_DEFAULT_TIMEOUT_MS` or `BASH_MAX_TIMEOUT_MS`.
  - L184: "A command that a foreground subagent started stops when that subagent's run ends ... A command that the main conversation or a background subagent started keeps running after a final response, until it exits, is stopped, or reaches its time limit."
  - Executed: the result of one of my own commands that timed out read "it is terminated when you give your final response and no notification can follow that".
- Confidence: verified-source and verified-executed.
- Implication: long watchers (CI, a chain) must be started by the main loop, or re-armed, never by short-lived workers.

**F12. `--resume` restores cron jobs that have not expired and a goal that was still active. It does not restore background work and does not start a turn.** Load-bearing.
- Evidence (`sessions.md`):
  - L41: "Scheduled tasks: tasks that haven't expired are restored. Background Bash and monitor tasks aren't."
  - L42: "a background subagent, background Bash command, or workflow that ended with the previous process shows up in the resumed transcript as a note that it didn't finish. Claude Code doesn't start a turn from those notes; Claude reads them with your next prompt."
  - L100: "Sessions whose first prompt was a `/loop` command don't appear in the picker, and `claude --continue` skips them too."
- Evidence (other pages):
  - `goal.md` L102 says an active goal is restored on every resume route.
  - `remote-control.md` L209 says to bring Remote Control back with `claude --continue` or `--resume`.
- Confidence: verified-source.
- Implication: after a crash the user types `claude --resume "<name>"`. That start needs a named session, and its first prompt must not be `/loop`.

### Q2. Scheduling primitives

**F13. CronCreate, CronList and CronDelete are session-scoped in-memory jobs. They fire only while the session is idle, expire after 7 days, allow 50 per session, run in local time, and never catch up. The shipped tool text and the docs disagree on jitter.** Load-bearing.
- Evidence (the tool description shipped in this session, 2.1.285):
  - "Jobs live only in this Claude session — nothing is written to disk, and the job is gone when Claude exits."
  - `durable`: "Has no effect — durable persistence is not available."
  - "Jobs only fire while the REPL is idle (not mid-query). ... recurring tasks fire up to 10% of their period late (max 15 min)".
  - "Recurring tasks auto-expire after 7 days".
- Evidence (`scheduled-tasks.md`):
  - L11: "When you resume with `--resume` or `--continue`, Claude Code restores tasks that haven't expired".
  - L162: "A session can hold up to 50 scheduled tasks at once."
  - L168: "All times are interpreted in your local timezone."
  - L174: "Recurring tasks fire up to 30 minutes after the scheduled time (or up to half the interval, for tasks that run more often than hourly)." This contradicts the tool text above.
  - L208: "Tasks only fire while Claude Code is running and idle. Closing the terminal or letting the session exit stops them firing. Backgrounding the session carries `/loop` tasks over to a background session".
  - L27: the minimum interval is 1 minute.
- Confidence: verified-source; the jitter discrepancy is flagged.
- Implication: use off-minute cron expressions. Don't count on minute-precise fire times. Treat a cron job as a heartbeat, not a deadline alarm.

**F14. `/loop` has a fixed-interval mode (cron) and a self-paced mode (`ScheduleWakeup`).** Load-bearing.
- Evidence:
  - `scheduled-tasks.md` L64: "After each iteration it picks a delay between one minute and one hour based on what it observed".
  - L124: "Claude calls the `ScheduleWakeup` tool with `stop: true` ... If an iteration ends without either rescheduling or stopping, Claude Code schedules one fallback wakeup about 20 minutes later and ends the loop when that iteration doesn't reschedule either."
  - L210: "A self-paced `/loop` isn't restored, so run `/loop` again to restart it."
  - `agent-sdk/typescript.md` L3320: "The runtime clamps `delaySeconds` to between 60 and 3600 seconds."
  - Binary, self-paced loop prompt: "If a [monitor] is armed ..., keep `delaySeconds` at 1200-1800s — the [monitor] is the wake signal and this is only the fallback heartbeat."
  - `workflows.md` L137: the `ultracode` keyword does not start a workflow from "a scheduled task prompt".
- Confidence: verified-source.

**F15. Monitor turns each stdout line into an event. Each watch lasts at most 30 minutes and must be re-armed.** Load-bearing.
- Evidence:
  - `tools-reference.md` L353: "Every watch Claude starts has a deadline: 5 minutes by default, at most 30 minutes, and at most 10 minutes in a non-interactive run".
  - The Monitor tool description: "Stdout lines within 200ms are batched into a single notification"; "Monitors that produce too many events are automatically stopped"; its example polls `gh pr checks ... sleep 30` until every check has left the pending state.
  - `tools-reference.md` L363: "It is also not available when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set."
  - `agent-view.md` L437: a monitor does not carry over when the session is backgrounded.
- Confidence: verified-source.
- Implication: to watch a GitHub Actions run, a Monitor re-armed every 30 minutes works, and so does a single background Bash `until gh run view ...` loop (one notification, up to 2 h). The docs recommend the second for a single event.

**F16. `/goal` is a turn-after-turn keep-going engine with a small-model evaluator, idle check-ins and pause/resume at usage limits.** Load-bearing.
- Evidence (`goal.md`):
  - L9: "After each turn, a small fast model checks whether the condition holds. If the model judges it not yet met, Claude starts another turn instead of returning control to you."
  - L56: "It doesn't run commands or read files independently, so write the condition as something Claude's own output can demonstrate."
  - L146: "after a failure that a retry would only repeat, such as an API rate limit, a claude.ai usage limit, or a hook that ended the turn, a notice starting with `Goal paused` names the cause. If the session is waiting to continue automatically when a usage limit resets, Claude resumes work toward the goal then."
  - L154-157: "Once background work has kept the goal waiting for 30 minutes, a check-in is due ... Claude Code starts at most three idle check-ins per goal between your prompts."
  - L108: "`/goal` works in non-interactive mode, in the desktop app, and through Remote Control."
  - L134-138: the goal clears on authentication failure, exhausted credit, context overflow, or a model that is unavailable.
- Confidence: verified-source.
- Implication: `/goal node scripts/completion-check.mjs exits 0 and every proof in <plan> is re-verified` could drive the "until proven complete" loop. The evaluator only reads the transcript, so proofs must be run and printed by the agent.

**F17. The Stop-hook input shows whether any wake source is armed, and `asyncRewake` hooks can wake an idle session.** Load-bearing.
- Evidence (`hooks.md`):
  - L2543: "Stop hooks receive `stop_hook_active`, `last_assistant_message`, `background_tasks`, and `session_crons` ... Claude Code applies an 8-consecutive-continuation cap".
  - L2547: "The `background_tasks` and `session_crons` arrays let hooks distinguish 'session is done' from 'session is paused waiting for background work to wake it back up'."
  - L2554: task types include `shell`, `subagent`, `monitor`, `workflow`, `teammate`, `cloud session`.
  - L455: "`asyncRewake` ... If `true`, runs in the background and wakes Claude on exit code 2."
  - L3694: "Claude Code still enforces `timeout` on a hook you run with `asyncRewake`." The default command-hook timeout is 600 s (L424).
  - L3766: "an `asyncRewake` hook that exits with code 2 wakes Claude immediately even when the session is idle."
- Confidence: verified-source.
- Implication: a skill-scoped Stop hook, active only while the /execution marker exists (the /harden pattern), can block a stop when the plan is open, no manual task is pending, and both arrays are empty.

**F18. Cross-session messages and the inbox socket start a turn in an idle session. This works only between sessions of the same account.** Load-bearing.
- Evidence (`cross-session-messaging.md`):
  - L59: "When the receiving session is idle, Claude Code starts a new turn with the message."
  - L137-141: sessions on another machine are reached "Through Anthropic servers, arriving over that machine's Remote Control connection".
  - L201: "The receiving session bypasses permission prompts: Claude Code holds each message for your approval. It delivers one only when the sending session identifies itself as also bypassing."
  - L232-255: a script or hook can post to its own session through `CLAUDE_CODE_MESSAGING_SOCKET`. On native Windows the first line must be an auth line carrying `CLAUDE_CODE_MESSAGING_TOKEN`.
  - L305: sessions beyond this machine need Remote Control and "a claude.ai sign-in".
- Confidence: verified-source. Inferred: dev B uses his own claude.ai account, so his sessions are not "your sessions". Notion and git are the only channel between dev A and dev B.

**F19. Routines (`/schedule`, `RemoteTrigger`) run in the cloud, keep going with the laptop off, run at least 1 hour apart, act as the user and can use claude.ai connectors.** Not load-bearing (optional watchdog).
- Evidence (`routines.md`):
  - L9: "Routines are in research preview."
  - L13: "Routines execute on Anthropic-managed cloud infrastructure ... so they keep working when your laptop is closed."
  - L51: "there is no permission-mode picker".
  - L65: "Anything a routine does through your connected GitHub identity or connectors appears as you".
  - L145: "The minimum interval is one hour".
  - L342: "Connectors are the claude.ai integrations on your account."
  - L388: scheduled runs are limited to "100 per hour" per account.
  - L396: "Without usage credits, additional runs are rejected until your usage window resets."
- Evidence (elsewhere): the RemoteTrigger tool description lists actions `list/get/create/update/run/create_webhook_trigger/list_runs/get_run_log`.
- Confidence: verified-source.

**F20. Desktop scheduled tasks exist for the Desktop app only. They fire only while the app is open and the machine is awake.** Not load-bearing.
- Evidence: `desktop-scheduled-tasks.md` L70: "Tasks only run while the desktop app is running and your computer is awake. If your computer sleeps through a scheduled time, the run is skipped."
- Confidence: verified-source.

**F21. Channels push Telegram, Discord or iMessage bot messages into an open local session.** Not load-bearing.
- Evidence: `channels.md`: "Events only arrive while the session is open, so for an always-on setup you run Claude in a background process or persistent terminal." Also: "Channels are a research preview feature"; the plugins need Bun; they are bots the user messages, not readers of an event's Discord server.
- Confidence: verified-source.

### Q3. Reaching the human

**F22. `PushNotification` sends a terminal notification, plus a phone push only while Remote Control is connected. It is skipped when the user is active at the terminal and gated by `agentPushNotifEnabled` (true for this user).** Load-bearing.
- Evidence:
  - The tool description shipped in this session: "This tool sends a desktop notification in the user's terminal. If Remote Control is connected, it also pushes to their phone." and "When the user is actively at the terminal, your output already reaches them — a notification on top of it would be a duplicate, so the tool skips it".
  - Binary result strings: "Terminal notification sent. Mobile push not sent (Remote Control inactive)." and "Mobile push requested."
  - `settings-reference.md` L5165: "`agentPushNotifEnabled`: Allow Claude to send a push notification to your phone when it decides one is worth sending ... pushes arrive while Remote Control is connected. Appears in `/config` as **Push when Claude decides**." The default is `false`.
  - `remote-control.md` L331: "Claude Code skips mobile push notifications while you are typing in or focused on the connected terminal."
  - `C:/Users/Utilisateur/.claude/settings.json` L155: `"agentPushNotifEnabled": true`.
- Confidence: verified-source; the user setting verified-executed.

**F23. The user has not set `inputNeededNotifEnabled` ("Push when actions required"), so permission prompts and questions do not push to the phone.** Load-bearing.
- Evidence:
  - `settings-reference.md` L5293: "Get a push notification on your phone when a permission prompt or question is waiting for your input. Claude Code sends these only while Remote Control is connected." The default is `false`.
  - Executed: a grep of `~/.claude/settings.json` and `~/.claude.json` for `inputNeededNotifEnabled` found nothing.
- Confidence: verified-executed.
- Implication: before the event, turn on **Push when actions required** in `/config`. Otherwise /execution has to call PushNotification itself for every manual task.

**F24. Notification hook types and when they fire.** Not load-bearing.
- Evidence:
  - `hooks.md` L309 lists the types `permission_prompt, idle_prompt, auth_success, elicitation_dialog, elicitation_url_dialog, elicitation_complete, elicitation_response, agent_needs_input, agent_completed, quota_auto_resume_fired, quota_auto_resume_stale, quota_auto_resume_disabled`.
  - L2263: "`idle_prompt` | Claude finished responding about 60 seconds ago and you haven't typed since".
  - L2269-2270: `agent_needs_input` fires "while agent view is open in a terminal", and `agent_completed` "Fires only while agent view is open in a terminal".
  - L2287: "Claude Code doesn't send `idle_prompt` while it waits for a claude.ai usage limit to reset."
  - The binary's type list also has undocumented types: `push_notification`, `worker_permission_prompt`, `computer_use_enter`, `computer_use_exit`, `model_refusal_fallback`.
  - The user's hooks (`settings.json` L100-135) feed `notify-on-complete.sh` (Windows toast through PowerShell, local only) and `session_signals.py` (Windows Terminal tab title and taskbar progress). Neither reaches the phone.
- Confidence: verified-source and verified-executed.

**F25. With Remote Control, the phone becomes a window into the local session. Here is what the phone can and cannot do.** Load-bearing.
- Evidence (`remote-control.md`):
  - L18: "your computer has to stay on and the `claude` process has to keep running."
  - L14: "the conversation and the progress of subagents and dynamic workflows stay in sync across all connected devices".
  - L154: "When you connect, the device shows any subagents and workflows the session already has running in the background. Stop one of them from the device, and Claude Code stops that task on your machine."
  - L197: "each interactive Claude Code process registers one remote session."
  - L345-354: commands that only work in the terminal (such as `/plugin` and `/resume`) are local-only. Those that work from the phone: `/compact, /clear, /context, /usage, /exit, /usage-credits, /recap, /reload-plugins`, `/model`, `/effort`, `/fast`, `/color`, `/rename` with an argument, `/mcp`, `/config key=value`, `/autocompact`, `/advisor`, `/output-style`, `/focus`.
  - L24: the plans are "Pro, Max, Team, and Enterprise ... API keys are not supported".
  - L60: server mode (`claude remote-control`) serves up to 32 sessions at once ("Default is 32").
- Evidence (other pages):
  - `mobile.md` L80: "Remote Control sessions offer Manual, Accept edits, and Plan. You can't select Bypass permissions from the app ... and you can't select Auto for a Remote Control session."
  - `mobile.md` L64: phone photos are saved under `~/.claude/uploads/`.
  - `whats-new/2026-w34.md` L68-80: "Any machine running `claude remote-control` now shows up as a device card ... Tap it to pick a directory and start a session there."
  - `workflows.md` L133: the `ultracode` keyword works when typed "in a Remote Control client".
- Confidence: verified-source. Inferred, to be tested: a user skill such as `/execution resume` typed on the phone is invoked.
- Implication: start the orchestrator with `claude --remote-control "<name>"` (interactive, one remote session), in bypass mode chosen at launch. Optionally keep `claude remote-control` (server mode) running in a second terminal so the phone can start a fresh session if the orchestrator dies.

**F26. Remote Control failure modes.** Load-bearing.
- Evidence (`remote-control.md`):
  - L336: "If you close the terminal, quit the Desktop app or VS Code, or otherwise stop the `claude` process, the session goes offline".
  - L338: after a VPN or network change, HTTP 403 is retried "for up to three minutes".
  - L340: server mode "gives up after roughly 10 minutes".
  - L342: "if an interactive session disconnects with `could not reach the Remote Control server for about 30 minutes`, run `/remote-control` to reconnect."
  - L343: "When Claude Code forwards another kind of dialog ... it waits five minutes by default, then closes the dialog and continues with the dialog's no-action default."
  - L344: "The Fable usage-credits consent prompt isn't forwarded".
  - L178: after compaction or `/resume`, a reconnect archives the old server session.
  - L211: a second terminal that resumes the same conversation does not take Remote Control from the first.
  - L25: Remote Control needs a claude.ai login. Tokens from `setup-token` are refused (L370).
- Confidence: verified-source.

**F27. `AskUserQuestion` blocks until answered, and from the phone it is forwarded and kept open. Permission prompts never auto-resolve.** Load-bearing.
- Evidence:
  - `tools-reference.md` L23: "Questions stay open until you answer them by default."
  - L133: optional `askUserQuestionTimeout` of `60s`, `5m` or `10m`.
  - L137: "permission prompts, including plan approval, never auto-resolve on idle."
  - `remote-control.md` L343: "Claude Code keeps permission prompts and `AskUserQuestion` questions open until you answer them."
  - `permission-modes.md` L40: `AskUserQuestion` is never auto-approved, even in bypass.
- Confidence: verified-source. Inferred: while a question is open the main loop is stuck inside that tool call, and wave-completion notifications wait behind it.
- Implication: for a manual task, don't block on a question while other waves could run. Write the ask to Notion, send a push, leave wake sources armed, and end the turn. The user's reply, from the phone or the terminal, starts the next turn.

**F28. Files can travel both ways between session and phone.** Not load-bearing.
- Evidence: `tools-reference.md` L50: "`SendUserFile` | Sends files from the session to you ... Available when a Remote Control client is connected or in a cloud session". `mobile.md` L64: photos attached in the app are saved under `~/.claude/uploads/`.
- Confidence: verified-source.

### Q4. Usage limits

**F29. Max plan: the session window resets every 5 hours, the weekly window resets at a fixed time per account, all Claude surfaces share them, and some limits are per model.** Load-bearing.
- Evidence:
  - support.claude.com article 11049741 ("What is the Max plan?"): "Your session-based usage limit will reset every five hours." and "Max plans also have a weekly usage limit that applies across all models. The weekly limit resets at a fixed time each week that is assigned to your account." It also says Max 5x gets 5 times Pro's per-session allowance and Max 20x gets 20 times.
  - Article 11647753: "your usage of all different Claude product surfaces (claude.ai, Claude Code, Claude Desktop) counts towards the same usage limit."
  - `errors.md` L658-664 lists "You've hit your weekly limit" and "You've hit your Opus limit", and notes "The session and weekly limits are shared across all models".
  - L668: "A single burst of heavy activity, such as a large workflow fanout, can exhaust the weekly allowance before the session window resets."
  - L679: a warning such as "You've used 85% of your session limit".
- Confidence: verified-source (support pages via WebFetch are reported summaries of the page).

**F30. The automatic continue at a usage limit is on by default in interactive subscription sessions, with conditions and exceptions.** Load-bearing.
- Evidence (`interactive-mode.md`):
  - L656: "Claude Code waits in the open session and continues the task on its own after the limit resets. Automatic continue is on by default in interactive sessions signed in with a claude.ai subscription. Requires Claude Code v2.1.234 or later."
  - L670: "re-arms the wait on its own at most twice in a row".
  - L681-682: the wait ends if "You exit Claude Code", or if the session is handed to "Claude Desktop, a background session, or the cloud".
  - L690-691: Claude Code does not start the wait on its own for "Remote Control and agent team teammate sessions" or "A reset more than 24 hours away".
  - L698: "Background sessions and `-p` runs: the menu row isn't available."
- Evidence (other sources):
  - `settings-reference.md` L3013: the `autoContinueAtUsageLimit` default is `true`; the user has not set it.
  - The binary's continuation prompt: "Your claude.ai usage limit has reset. Continue the task you were working on when the limit was reached; do not repeat work that is already complete."
  - The user's settings (L124) already hook `quota_auto_resume_fired|stale|disabled`.
- Confidence: verified-source. Open: whether an interactive session that ran `/remote-control` counts as a "Remote Control session" here (see Open questions).

**F31. A Workflow run at a usage limit pauses, but only under the same conditions. Otherwise the agents that hit the limit fail.** Load-bearing.
- Evidence (`workflows.md`):
  - L399: "the run pauses rather than failing that agent ... Requires Claude Code v2.1.271 or later".
  - L405: "A run doesn't pause in non-interactive mode with `claude -p` or the Agent SDK, in a background session, or in a Remote Control or agent team teammate session."
  - L407: "The limit resets within 24 hours."
  - L408: "When it hits the limit a third time, the agent fails."
  - L315: "An `agent()` call resolves to `null` if you stop it mid-run or it hits an unrecoverable API error."
- Confidence: verified-source.
- Implication: the wave scripts must treat `null` results as "rerun later", never as done. After a limit, the heartbeat relaunches with `resumeFromRunId`.

**F32. The only way for a session to read its 5h and 7d usage is the status-line JSON, or `rate_limit_event` in the SDK. There is no CLI subcommand. The user's `statusline.py` shows the figures but does not save them.** Load-bearing.
- Evidence:
  - `statusline.md` L193-194: "`rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` | Percentage of the 5-hour or 7-day rate limit consumed" and "`rate_limits.five_hour.resets_at`, `rate_limits.seven_day.resets_at` | Unix epoch seconds".
  - `statusline.md` L339: "appears only for claude.ai Pro and Max subscribers ... and only after the first API response in the session".
  - `statusline.md` L154: "The event-driven triggers can go quiet when the main session is idle ... set `refreshInterval`".
  - `C:/Users/Utilisateur/.claude/statusline.py` L47-51 reads `rate.get("five_hour")` and `rate.get("seven_day")` and only prints them.
  - `agent-sdk/typescript.md` (SDKRateLimitEvent): `status: "allowed" | "allowed_warning" | "rejected"; resetsAt?; utilization?`.
  - `claude --help` (executed) lists no usage command. `/usage` works from the phone (`remote-control.md` L346).
- Confidence: verified-source and verified-executed.
- Implication: have `statusline.py` also write `~/.claude/usage-snapshot.json`, atomically and with a timestamp, so the tick and preflight can read `five_hour` and `seven_day` from the file.

**F33. What spends quota when nobody types, and cache lifetimes.** Not load-bearing.
- Evidence:
  - `costs.md` L360-363: "a scheduled task fires on its interval even while the session is idle, sending your full context each time". Cross-session messages and goal check-ins do the same, and every workflow agent "sends its own requests".
  - `prompt-caching.md` L272-273: the main conversation gets a one-hour cache TTL on a subscription within plan usage. "Everything else" (subagents, workflows, compaction) gets "Five minutes".
  - L275: once usage credits are drawn, the main conversation also drops to 5 minutes.
- Confidence: verified-source.
- Implication: keep the orchestrator's transcript small. Each cron tick resends it.

### Q5. Cloud execution

**F34. Cloud sessions (`claude --cloud`, claude.ai/code) survive a closed laptop, with hard requirements and limits.** Load-bearing.
- Evidence (`claude-code-on-the-web.md`):
  - L13: "The session keeps running after you close your laptop".
  - L86: it clones "your current directory's GitHub remote at your current branch, not your local checkout, so push first". Without a remote or the GitHub App, it uploads a bundle, which must be under 100 MB (L126-139).
  - L151: `claude -p "your message" --cloud <session-id>` queues a follow-up from any machine.
  - L75: from the CLI, hand-off is one way (`--teleport` pulls a session in).
  - L368: "Background work that was still running when the VM was reclaimed, such as subagents and shell commands, isn't restored."
  - L374: "cloud sessions share rate limits with all other Claude and Claude Code usage ... There is no separate compute charge for the cloud VM."
- Evidence (`cloud-environments.md`):
  - L278: "Your user `~/.claude/skills/`, `~/.claude/agents/`, `~/.claude/commands/` | No". L277: the user CLAUDE.md is not available either. Both must be committed to the repo's `.claude/`.
  - L195, and `routines.md` L342: claude.ai MCP connectors, including Notion, do work.
  - L374-376: "4 vCPUs, 16 GB of RAM, 30 GB of disk".
  - L389: an idle VM pauses and can be reclaimed.
  - L241: "git push works only against the session's current working branch".
  - L90-92: on Pro and Max, API credentials attach keys outside the VM. Environment variables can be read by anyone using the environment.
- Evidence (`permission-modes.md`):
  - L58: cloud sessions ignore bypass mode set in settings files.
- Confidence: verified-source.
- Implication: cloud fits CPU-heavy or long jobs that need no wallet keys. It does not fit steps that need the laptop's secrets, Docker images or files that are not in git.

**F35. The Agent tool's `isolation: "remote"` (a cloud "CCR" sandbox) exists in the binary but is gated and undocumented.** Not load-bearing.
- Evidence (binary strings):
  - "You can set `isolation: "remote"` to run the agent in a remote CCR environment. This is always a background task; you'll be notified when it completes."
  - The gate function checks, among other things, `hasUsedRemoteSession`, `hasRemoteEnvironment` and feature flag `tengu_neapolitan`.
  - Fallback messages: "[remote agent] isolation:'remote' is unavailable (no claude.ai login or feature gate off); falling back to isolation:'worktree'".
  - For workflows: "agent({... isolation:'remote'}) is not available in this build".
  - `sub-agents.md` documents only `isolation: worktree` (L316). WorkflowOutput has `status: "remote_launched"` with a `sessionUrl` (agent-sdk/typescript.md).
- Confidence: verified-source (strings). Whether it is on for this account is not known.
- Implication: do not design on it. Use the documented `claude --cloud` if a task must run off the laptop.

**F36. Projects are a cloud coordinator in public beta: web, desktop and mobile only, not in the CLI.** Not load-bearing.
- Evidence: `claude-projects.md` L9: "Projects are in public beta on Pro and Max plans and rolling out gradually". L399: "A thread that reaches your plan's limit waits and continues on its own when the limit resets". L407: "The enforced limit is 200 new threads per day". L439: "not in the terminal CLI".
- Confidence: verified-source.

### Q6. Models, effort, cost, caching

**F37. Model aliases and API list prices, the best available proxy for relative plan-usage cost.** Load-bearing.
- Evidence:
  - `model-config.md` L46: on the Anthropic API, `opus` resolves to "Opus 5.5" and `sonnet` to "Sonnet 5.5". L53: `fable` resolves to Fable 5.1. `haiku` is "the fast and efficient Haiku model".
  - `platform.claude.com/docs/en/about-claude/pricing.md` L17-34, per million input / output tokens:
    - Fable 5.1: $10 / $50
    - Opus 5.5: $4 / $20 (cache hits $0.20)
    - Opus 5: $5 / $25
    - Sonnet 5.5: $2 / $10 (cache hits $0.20)
    - Haiku 4.5: $1 / $5 (cache hits $0.10)
  - L150: a cache hit costs 10% of input (5% on Opus 5.5).
  - Support article 11647753: usage is affected by "which Claude model you're chatting with, and the effort level you've selected".
- Confidence: verified-source. Inferred: plan usage scales roughly with these prices.

**F38. Effort levels, defaults, and the user's saved levels.** Load-bearing.
- Evidence:
  - `model-config.md` L574: Opus 5.5 and Sonnet 5.5 offer `low, medium, high, xhigh, max`.
  - L583: "Opus 5.5 and Sonnet 5.5 default to `medium`".
  - L585: "a top-level `effortLevel` in your user settings file doesn't count for Opus 5.5".
  - L639: `max` "is prone to overthinking".
  - `prompt-caching.md` L99: "On Opus 5.5, Sonnet 5.5, and Fable 5.1 ... changing effort keeps the cache".
  - The user's `settings.json` L142-149: `"effortLevel": "high"` and `modelSettings.claude-opus-5-5.effortLevel = "medium"`. So Opus 5.5 sessions and the subagents that inherit from them run at medium unless overridden.
- Confidence: verified-source and verified-executed.

**F39. How subagents and workflow agents choose their model and effort.** Load-bearing.
- Evidence:
  - `sub-agents.md` L360-363 gives the order: "The per-invocation `model` parameter", then frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then "The main conversation's model".
  - L393: `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces one model on every subagent, teammate and workflow agent.
  - `workflows.md` L423: "Claude Code picks each workflow agent's model in the same order it uses for subagents."
  - Binary, workflow script reference: "agent(prompt: string, opts?: {label?, phase?, schema?, model?: string, effort?: string, isolation?, agentType?: string})". It continues: "opts.effort overrides the reasoning effort for this agent call ('low' | 'medium' | 'high' | 'xhigh' | 'max') — omit to inherit the session effort; use 'low' for cheap mechanical stages and higher tiers only for the hardest verify/judge stages." It also says that `opts.isolation: 'worktree'` is "EXPENSIVE (~200-500ms setup + disk per agent)".
  - `prompt-caching.md` L93: "When a skill or command's frontmatter names a `model` other than the session's current model, that turn is also a model switch: the next request reads the entire conversation history with no cache hits."
- Confidence: verified-source.
- Implication: do not put `model:` in the /execution `SKILL.md` frontmatter. Choose model and effort per agent in the wave scripts instead.

**F40. Prompt caching for many similar agents.** Load-bearing (token optimisation).
- Evidence (`workflows.md`):
  - L350: "Two agents that run with the same model, effort level, agent type, tools, output schema, and working directory build the same tools-and-system-prompt prefix".
  - L352: "its cache holds for five minutes by default, including on a Claude subscription. To keep it for an hour, set `subagentPromptCacheTtl` to `1h`. The API bills 1-hour cache writes at a higher rate."
  - L354: matching agents are held until the first responds, capped by `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS` (5000 by default).
- Evidence (other pages):
  - Pricing L150: caching "pays off after one cache read for the 5-minute duration (1.25x write), or after two cache reads for the 1-hour duration (2x write)".
- Confidence: verified-source.
- Implication: group agents of the same kind (same model, effort, type and schema) into the same wave. Prefer `pipeline()` fan-outs that start together. Set the 1h TTL only when a wave re-uses a prefix after gaps longer than 5 minutes.

**F41. Fable can bill to usage credits, and in unattended sessions its consent prompt ends the turn after 5 minutes.** Load-bearing.
- Evidence (`model-config.md`):
  - L95: "Depending on your plan and seat tier, Fable usage can bill to usage credits".
  - L104: "In a session with Remote Control connected, a background session, or an agent team teammate's session, nobody may be at the terminal, so Claude Code holds the mid-session consent prompt for the `dialogExpiry` deadline, five minutes by default. If nobody has answered by the deadline, Claude Code ends the turn without sending the request".
- Evidence (other pages):
  - `remote-control.md` L344: that prompt is not forwarded to the phone.
- Confidence: verified-source.
- Implication: /execution must not pick `fable` for any agent unless the user has consented beforehand and accepts credit billing.

**F42. Safety classifiers can switch models on security- or biology-flavoured requests.** Not load-bearing.
- Evidence: `model-config.md` L513-515: "Fable 5.1, Fable 5, and Opus 5.5: biology-flagged requests re-run on Opus 5, and cybersecurity-flagged requests re-run on Opus 4.8". The user has `"switchModelsOnFlag": false` (settings.json L154). A flagged request then pauses the session with two options (L535), which stalls an unattended loop.
- Confidence: verified-source and verified-executed.

### Machine and environment

**F43. Auto-update changed the running version during this research. The background supervisor restarts itself onto new versions.** Load-bearing.
- Evidence:
  - Executed: `claude --version` gave `2.1.285` at the start and `2.1.286` after 21:09. `~/.local/bin` holds `claude.exe` (245 MB, 21:09) plus two `claude.exe.old.*` copies of 242-244 MB each.
  - `settings.json` L151: `"autoUpdatesChannel": "latest"`.
  - `env-vars.md` L420: "`DISABLE_AUTOUPDATER` | Set to `1` to disable automatic background updates."
  - `agent-view.md` L786: after an auto-update, "the supervisor restarts itself onto the new version and moves idle sessions over".
- Confidence: verified-executed and verified-source.

**F44. The C: drive is nearly full.** Load-bearing.
- Evidence: executed `df -h /c`: "454G 452G 1.9G 100%" at about 21:16, and "4.8G 99%" at about 21:22 after I deleted my own 53 MB scratch file (other processes also write). Workflow worktrees cost "disk per agent" (F39). The earlier brief said 6.9 GB.
- Confidence: verified-executed.

**F45. The machine is on Paris time. Cron, `/loop` and routines use local wall-clock time.** Load-bearing.
- Evidence:
  - Executed: `tzutil /g` returned "Romance Standard Time"; `date` gave 21:23 local = 19:23 UTC.
  - `scheduled-tasks.md` L168: "All times are interpreted in your local timezone."
  - `routines.md` L141: "Times are entered in your local zone and converted automatically".
  - The hack window, Tue 6 Oct 12:00 SGT to Wed 7 Oct 23:59 SGT, is 06:00 Tue to 17:59 Wed Paris time (CEST, UTC+2, while SGT is UTC+8).
- Confidence: verified-executed and verified-source. Inferred: if Windows switches the time zone automatically in Singapore, crons created before the switch may fire at unexpected wall-clock times.

**F46. Bypass mode still stops for a few things.** Load-bearing.
- Evidence:
  - `permission-modes.md` L36-42: "Claude Code doesn't auto-approve the following in any mode, including `bypassPermissions`". The list covers explicit ask rules, `AskUserQuestion` and MCP tools marked `requiresUserInteraction`, `rm`/`rmdir` on critical paths, and the cross-session messaging safeguards.
  - L572: "You can't enter `bypassPermissions` from a session you started without it enabled."
  - `agent-view.md` L682: `claude --bg --permission-mode bypassPermissions` is refused until the disclaimer has been accepted once.
- Confidence: verified-source.

## Implications for /execution

1. **Host topology (recommended default).** Run one orchestrator as the main loop of an interactive session:
   - Launch: `claude --remote-control "<project>-exec" --dangerously-skip-permissions -n "<project>-exec"` in Windows Terminal. Name the session so that `claude --resume "<name>"` works. Do not make `/loop` its first prompt (F12).
   - Environment: `CLAUDE_CODE_RETRY_WATCHDOG=1` (F07). `DISABLE_AUTOUPDATER=1` for the event window, if the user agrees (F43). `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` sized to RAM and disk (for example 6-8, not 16) (F09, F44).
   - Why not a background session: keep it interactive and never `/bg` it while a wave is running. A background session loses the usage-limit wait and Monitors (F05, F30, F31).
2. **Liveness invariant.** Every orchestrator turn must end with at least one wake source armed: a running Workflow run or background task, a Monitor, or a CronCreate heartbeat.
   - Enforce it with a skill-scoped Stop hook, active only while `.execution/active` exists (the /harden pattern). It reads `background_tasks` and `session_crons`, and blocks the stop when the plan is open, no manual task is pending, and both arrays are empty. Stay under the 8-continuation cap (F17).
3. **Heartbeat.** Create one recurring CronCreate at an off-minute, every 20-30 minutes, with the prompt `/execution tick`. The tick re-reads the state file, re-verifies proofs, relaunches failed or null agents with `resumeFromRunId`, re-arms Monitors, and pushes the Notion report when due.
   - It also recovers from turns that failed (network, API) and from usage-limit stops where the automatic wait was not armed (F13, F30).
   - Delete and recreate it only after a restart. After `--resume`, check `CronList` (F12, F13).
4. **Waves are Workflow runs.** One wave is one Workflow run launched by the main loop.
   - Scripts must be deterministic: pass timestamps in `args`, no `Date.now()`.
   - Proofs are checked by verifier agents that did not write the code (`agent(..., {schema, effort:'high'})`).
   - `null` results mean "rerun", never "done" (F31).
   - Record `runId`, `scriptPath` and `transcriptDir` in `.execution/state.json` (F08, F09).
5. **Manual tasks without stalling.** Write the ask to Notion and call `PushNotification`. Leave other waves and the heartbeat armed. End the turn, and let the user's reply from phone or terminal start the next one.
   - Use `AskUserQuestion` only when nothing else can proceed, because it blocks the main loop (F27).
   - Ask the user to turn on **Push when actions required** (`inputNeededNotifEnabled`) (F23).
6. **Budget gate.** Extend `statusline.py` to also write a usage snapshot file (F32).
   - Before each wave, estimate its token cost against the remaining `five_hour` and `seven_day` percentages.
   - Above about 85% of the 5-hour window, only critical-path waves start. When the weekly window cannot cover the plan, stop and ask the user (decision 2). Options are usage credits or reduced scope (F29).
7. **Recovery playbook, written into `SKILL.md` near the top.**
   - Terminal closed: `claude --resume "<name>"` → `/execution resume`. Relaunch the recorded runs with `resumeFromRunId`, and re-create Monitors.
   - Session lost: read `journal.jsonl` and relaunch only the unfinished items (F08).
   - Remote Control dropped: `/remote-control` (F26).
   - Laptop slept through a reset: press Enter or send any prompt from the phone (F06, F30).
8. **Laptop at the venue (a manual preflight task for the user).**
   - Plug in, and set lid-close and idle sleep to "do nothing" on AC. The machine only has S3 sleep (F06).
   - Free disk space before the event (F44).
   - Settle the time zone before creating crons (F45).
9. **Optional cloud watchdog.** An hourly routine, using the claude.ai Notion connector, can read the Notion plan and the repo's pushed commits. It flags staleness (no update for more than 2 h) by writing a Notion comment or mention, which pushes through the Notion app. Minimum interval 1 h, research preview (F19). It cannot see or restart the laptop.
10. **Cloud offload is per task, not for the orchestrator.** Use `claude --cloud` only for tasks that need no local secrets, wallets or unpushed state.
    - Commit the needed skills under the repo's `.claude/skills`.
    - Push first.
    - Record the returned session id and steer it with `claude -p "..." --cloud <id>` (F34). Do not use Agent `isolation:"remote"` (F35).
11. **Model and effort policy.**
    - Orchestrator: Opus 5.5, medium by default, high for planning or re-planning.
    - Code-writing agents: Opus 5.5 at medium, or Sonnet 5.5 at medium for routine code.
    - Verifiers and judges: Opus 5.5 at high.
    - Mechanical checks (file exists, command exit code): Haiku at low.
    - Never Fable unattended (F37-F41).
    - Group identical agent configurations to share the cache prefix (F40). No `model:` in `SKILL.md` frontmatter (F39).
12. **Two developers.** Separate claude.ai accounts cannot message each other's sessions (F18), so Notion and git are the only shared state.
    - Each orchestrator claims only tasks whose owner is itself or its developer.
    - Pushes go through branches or rebases to avoid collisions.
    - Each developer needs Remote Control and phone pushes set up on their own account.
13. **Use `/goal` as a backstop, if the rehearsal shows it helps.** For example, `/goal node scripts/completion-check.mjs exits 0 and every plan proof is re-verified, or stop after 40 turns` inside the orchestrator session. The evaluator only reads the transcript, so the tick must print proof results (F16).

## Risks and failure modes

- **An idle orchestrator waits forever.** A turn ends with no background task, no cron and no Monitor, for example after a failed API turn or a turn that "forgot" to re-arm. Nothing wakes it until the user types (F01, F13, F17).
- **Blocking question.** An `AskUserQuestion` for one manual task blocks the main loop while other waves could run. Completion notifications queue behind it (F27).
- **Usage window.** A workflow agent that hits the limit in a background or Remote Control session fails with `null` instead of pausing. A script that treats `null` as done ticks tasks falsely (F31).
- **Weekly window used up mid-event.** Nothing resumes by itself when the reset is more than 24 h away. Heavy fan-outs make this more likely (F29, F30).
- **Remote Control and the automatic wait.** An interactive session with Remote Control on may count as a "Remote Control session" and then not start the usage-limit wait by itself. This is unverified (F30).
- **Sleep through a reset.** More than 30 minutes of sleep across a reset needs Enter (quota_auto_resume_stale). A lid closed at the venue freezes all work (F06).
- **Venue Wi-Fi.** Without the watchdog variable, a turn fails after 10 retries. Server-mode Remote Control exits after about 10 minutes offline (F07, F26).
- **Terminal closed by accident.** The X button kills the session and every background task. Workflows must be relaunched from the resumed session. Monitors and self-paced loops are not restored (F04, F12).
- **Backgrounding mid-wave.** Workflow agents that were running restart from zero, and their tokens are spent twice. Monitors are stopped (F05).
- **Auto-update mid-event.** A new version can change behaviour. Background sessions get restarted by the supervisor (F43).
- **Disk full.** Parallel installs, worktrees, Docker images and old binaries fill the disk, and builds and agents fail in odd ways (F44).
- **Time zone mismatch.** Crons run in Paris time while the event runs in SGT, 6 h apart. The T-6h audit fires at the wrong moment (F45).
- **Cron jitter.** Up to 30 minutes late by the docs, up to 10% capped at 15 minutes by the tool text. Crons cannot serve as precise deadline alarms (F13).
- **Monitor expiry.** A Monitor that expires after 30 minutes and is not re-armed silently stops watching CI (F15).
- **Fable consent.** An agent run on Fable stalls on the consent prompt, and the turn ends after 5 minutes without anything being sent (F41).
- **Classifier pause.** A security-flavoured request, for example crypto or key handling, trips the safety classifier. With `switchModelsOnFlag: false` the session pauses for a choice (F42).
- **Cloud sessions.** Uncommitted work is lost when the VM is reclaimed. Pushes go only to the session branch. Local secrets and wallets cannot be used, and user-level skills are missing (F34).
- **Dev A and dev B.** They cannot message each other's sessions. Without a strict owner field in Notion, both orchestrators can pick up the same task (F18).
- **Hidden session.** A session whose first prompt was `/loop` does not appear in `--continue` or the picker, so recovery gets confusing (F12).

## Open questions

1. Does running `/remote-control`, or starting with `--remote-control`, make an interactive session a "Remote Control session" in the sense of `interactive-mode.md` L690 and `workflows.md` L405? In other words, is the automatic usage-limit wait disabled, and do workflow agents fail instead of pausing? The binary's gate (`wu() && !At() && !Nt()`) seems to exclude background sessions and "remote mode" viewers, not local sessions bridged over Remote Control, but that reading is uncertain. This needs a rehearsal test, or a question to Anthropic.
2. Does a cron fire during a usage-limit wait count as "You send a prompt" and cancel the automatic continue?
3. Does `CLAUDE_CODE_RETRY_WATCHDOG=1` wait out a claude.ai plan limit ("so a session that hits a usage limit waits out the remaining window") in background and Remote Control sessions, where the automatic wait is not offered? How does it interact with `autoContinueAtUsageLimit`?
4. Are CronCreate jobs really restored on `--resume` in 2.1.286? The docs say yes, while the shipped tool text says "nothing is written to disk, and the job is gone when Claude exits". Is the recurring jitter 10% (max 15 min) or up to 30 min?
5. Is the user on Max 5x or Max 20x? When exactly does the weekly window reset relative to 6-7 Oct SGT? Check `/usage` before flying.
6. Does a custom skill typed from the phone (for example `/execution resume`) run as a skill in the local session? The docs list only built-in commands.
7. Are the server-side feature flags for mobile pushes (`tengu_kairos_push_notifications`, `tengu_kairos_input_needed_push`, seen in the binary) on for this account? A rehearsal push would answer it: "Mobile push requested." versus "not sent".
8. Does the claude.ai Notion connector work in a cloud session or routine for this account, as documented for connectors in general?
9. Is Agent `isolation:"remote"` enabled for this account? Irrelevant if not used.
10. When several background completions land while idle, are they delivered in one turn or several? This affects token cost, not correctness.
11. Does the status-line `rate_limits` data refresh from workflow and subagent API responses, or only from main-loop responses?

## Sources

Official Claude Code documentation (raw Markdown, fetched 2026-09-30):
- https://code.claude.com/docs/llms.txt (index)
- https://code.claude.com/docs/en/workflows.md
- https://code.claude.com/docs/en/agent-view.md
- https://code.claude.com/docs/en/interactive-mode.md
- https://code.claude.com/docs/en/scheduled-tasks.md
- https://code.claude.com/docs/en/goal.md
- https://code.claude.com/docs/en/hooks.md
- https://code.claude.com/docs/en/remote-control.md
- https://code.claude.com/docs/en/mobile.md
- https://code.claude.com/docs/en/tools-reference.md
- https://code.claude.com/docs/en/sub-agents.md
- https://code.claude.com/docs/en/agents.md
- https://code.claude.com/docs/en/sessions.md
- https://code.claude.com/docs/en/context-window.md
- https://code.claude.com/docs/en/errors.md
- https://code.claude.com/docs/en/costs.md
- https://code.claude.com/docs/en/statusline.md
- https://code.claude.com/docs/en/settings-reference.md
- https://code.claude.com/docs/en/env-vars.md
- https://code.claude.com/docs/en/permission-modes.md
- https://code.claude.com/docs/en/cross-session-messaging.md
- https://code.claude.com/docs/en/channels.md
- https://code.claude.com/docs/en/routines.md
- https://code.claude.com/docs/en/desktop-scheduled-tasks.md
- https://code.claude.com/docs/en/claude-code-on-the-web.md
- https://code.claude.com/docs/en/cloud-environments.md
- https://code.claude.com/docs/en/claude-projects.md
- https://code.claude.com/docs/en/model-config.md
- https://code.claude.com/docs/en/prompt-caching.md
- https://code.claude.com/docs/en/fast-mode.md
- https://code.claude.com/docs/en/advisor.md
- https://code.claude.com/docs/en/headless.md
- https://code.claude.com/docs/en/agent-sdk/typescript.md
- https://code.claude.com/docs/en/changelog.md
- https://code.claude.com/docs/en/whats-new/2026-w34.md

Pricing and plans:
- https://platform.claude.com/docs/en/about-claude/pricing.md
- https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
- https://support.claude.com/en/articles/17007452-what-is-a-limit-reset

This machine:
- Installed binary: `C:/Users/Utilisateur/.local/bin/claude.exe`. Strings consulted: the Agent tool text on remote isolation, the workflow `agent()` reference, the Workflow resume and journal text, the PushNotification result strings, the notification type list, the usage-limit continuation prompt.
- Tool descriptions shipped to this session: Bash, CronCreate, CronDelete, CronList, Monitor, PushNotification, RemoteTrigger, SendMessage, TaskStop.
- Local files: `C:/Users/Utilisateur/.claude/settings.json` (keys only: hooks, statusLine, effortLevel, modelSettings, autoUpdatesChannel, switchModelsOnFlag, agentPushNotifEnabled), `C:/Users/Utilisateur/.claude/statusline.py`, `C:/Users/Utilisateur/.claude/hooks/session_signals.py`, `C:/Users/Utilisateur/.claude/hooks/notify-on-complete.sh` (mechanism only).
- Commands: `claude --version`, `claude --help`, `nproc`, `df -h /c`, `powercfg /a`, `tzutil /g`, `date`, `ls ~/.local/bin`.

## Verification

Adversarial pass on the 36 load-bearing claims, 2026-09-30 21:30-22:00 Paris, installed Claude Code 2.1.286. The docs were fetched again at 21:34 (raw `.md`). Line numbers below refer to that fetch. The changelog head is now 2.1.286, so changelog line numbers have moved. "Binary" means the JavaScript embedded in `C:/Users/Utilisateur/.local/bin/claude.exe` (2.1.286). It is minified, so every reading of logic is an interpretation; each one names the functions and the approximate byte offset. One tiny headless experiment (E1) ran with `--safe-mode --model haiku` in `scratchpad/cc-experiments/runtime-verify/e1/`. **This section overrides the body where they differ.** The largest correction is under F30/F31: an interactive session with Remote Control connected gets neither automatic usage-limit wait.

- **F01 confirmed.** goal.md L152, sub-agents.md L906 and the shipped Bash text match. agent-sdk/typescript.md L1584: "When the SDK injects a synthetic follow-up turn, such as for a finished background task". L4026 (Workflow): "The final result arrives later as a task completion." Addendum from L1586: "When several background-task completions are queued together, Claude Code can answer them in one turn rather than one turn each" (answers open question 10). A resumed session does not start a turn from work that died with the old process (sessions.md L42).
- **F03 confirmed.** context-window.md L1606-1607 and L1615. Changelog 2.1.260: "Fixed Workflow tool subagents being restarted as stalled while a long context compaction was still in progress". Correction: the 25,000-token total drops the *oldest* invoked skills first (L1615). If the orchestrator later invokes other large skills (such as /hackathon), the /execution body can vanish entirely after compaction, not just get truncated. L1609: SessionStart hooks that match the `compact` source "run ... and add their output to the compacted context". That is a sturdier way to re-inject the state digest.
- **F04 confirmed.** agent-view.md L773, interactive-mode.md L313 and workflows.md L391 quotes match. Corrections:
  - interactive-mode.md L313 says only that "On macOS and Linux" processes "that detached from the task's shell ... stop too". On Windows a detached child may outlive the session (inferred from the wording).
  - The recovery command also needs `--dangerously-skip-permissions` (Missed M2).
  - The X-button claim stays inferred.
- **F05 confirmed.** agent-view.md L433-437, L779, L786, L845 and L852 match. Correction to the implication "background only between waves": between waves the session is idle. agent-view.md L939: "When a session that has finished or is waiting for your next message stays unattached for about an hour, the supervisor stops its process ... Sessions that are working, paused on a permission prompt or other dialog, or pinned aren't stopped this way." A stopped process fires no cron heartbeat. L783 counts "A running subagent, workflow, or monitor" as working; a background Bash command is not listed. Pin a backgrounded orchestrator with `Ctrl+T`.
- **F06 confirmed.** errors.md L354 and interactive-mode.md L667 match. `powercfg /a` run again: only "Veille (S3)", hibernation not enabled, S0 low-power idle unsupported. Addendum (executed, read-only): the Balanced scheme already has idle sleep "never" on AC (STANDBYIDLE AC index 0) and 600 s on battery. The lid-close action is not exposed by `powercfg` on this laptop, even queried by GUID, so it must be checked by hand. With Remote Control connected no automatic wait is armed anyway (F30).
- **F07 confirmed.** errors.md L348, env-vars.md L356 and remote-control.md L340-341 match. Addendum (binary, interpretation, not executed): in the shared API retry loop (offset ~210.80M), the watchdog branch (`y6()` = `CLAUDE_CODE_RETRY_WATCHDOG`) retries 529s and 429s, except the spend-limit and exhausted-credit 429s that `NMo` excludes. When a 429 carries the `anthropic-ratelimit-unified-reset` header, it sleeps until that time, each sleep capped at 21,600,000 ms, i.e. 6 h (`HMo`, `rOe`). Otherwise it backs off for up to 5 minutes. The branch has no Remote Control or background check, so it is the only automatic usage-limit wait left in an RC-connected session. While it sleeps, the turn stays busy: crons cannot fire and phone prompts queue (inferred).
- **F08 confirmed.** agent-sdk/typescript.md L3096 says "Same session only". Binary (~230.93M): "Fallback when no journal is available: Read agent-<id>.jsonl files in the transcript directory and hand-author a continuation script." Binary (~216.90M): the completion text names `<transcriptDir>/journal.jsonl`. For failed or killed runs it also appends a `<recovery>` block containing the exact `Workflow({scriptPath, resumeFromRunId})` call. Addendum from L4026: "a script that fails its syntax check returns `status: "async_launched"` with `error` set, and never runs". Check `error` before recording a wave as launched.
- **F09 confirmed.** The workflows.md L362-368 table matches, as do L334 and L183. Addendum from env-vars.md L404: "Each running agent's transcript stays in Claude Code's memory, so higher values raise memory use."
- **F10 confirmed.** sub-agents.md L424-435, L1011 and L1042 match. The concurrency limit can be changed with `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, and ultracode sessions are exempt. Executed in this workflow agent: `ToolSearch select:Workflow,AskUserQuestion,Agent,ScheduleWakeup` returned "No matching deferred tools found". Nuance (executed): this workflow agent's deferred tools *do* include CronCreate, CronList, CronDelete, PushNotification, Monitor, RemoteTrigger and SendMessage. Workflow agents therefore do not get the reduced background-subagent set. Where a cron created by a wave agent would land was not tested, because the test could fire into the live orchestrator.
- **F11 confirmed.** tools-reference.md L182-192 and interactive-mode.md L319-322 match. A foreground command that reaches its timeout is moved to the background, unless it starts with `sleep`.
- **F12 confirmed and executed.** sessions.md L41-42 and L100 match. E1 on 2.1.286:
  - Step 1: `claude -p --session-id <uuid>` created recurring job `5e6486bf` (`43 4 * * *`). Its tool result read "Session-only (not written to disk, dies when Claude exits)".
  - Step 2: a new process, `claude -p --resume <uuid>`, ran CronList. It returned "5e6486bf · Every day at 4:43 AM (recurring) [session-only]: E1 marker noop", so the job came back on resume.
  - Correction to the implication: bypass mode is not restored on resume (M2).
- **F13 confirmed as stated, and now resolved.**
  - Restore on resume: E1 shows that the docs are right and the tool text ("gone when Claude exits") is misleading.
  - Jitter: the binary's default config `qq={recurringFrac:0.5,recurringCapMs:1800000,oneShotMaxMs:90000,...,recurringMaxAgeMs:604800000}` (~208.43M) is applied as `min(hash*0.5*period, 30 min)`. That matches the docs (half the period, capped at 30 min), not the tool text (10%, capped at 15 min).
  - The config is read from the server flag `tengu_kairos_cron_config` (~216.26M), so the live value can differ per account. Plan for up to 30 minutes of lateness.
- **F14 confirmed.** agent-sdk/typescript.md L3320 and scheduled-tasks.md L124 and L210 match. Binary (~232.87M): "keep `delaySeconds` at 1200–1800s — the ${Monitor} is the wake signal and this is only the fallback heartbeat".
- **F15 confirmed.** tools-reference.md L353 and agent-view.md L437 match. The Monitor text shipped to this agent says "Every monitor expires after `timeout_ms` (default 5 minutes, at most 30 minutes)" and "Monitors that produce too many events are automatically stopped". For a single notification it recommends Bash `run_in_background` with an `until` loop instead.
- **F16 confirmed.** goal.md L9, L56, L146 and L152-157 match. Consequence of F30: in an RC-connected session no automatic wait is armed, so a goal paused at a usage limit stays paused until a prompt arrives, from a cron tick or the phone. The user types `/goal`. The binary also contains an internal `ProposeGoal` tool (setting `modelProposedGoals`, marked "@internal"). It is not visible to this workflow agent, and whether the main session has it is unknown.
- **F17 confirmed.** hooks.md L424, L455, L2543, L2547, L3694 and L3766 match. Addenda:
  - The 8-continuation cap is adjustable with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (L2543).
  - Both arrays "are present when the task registry is reachable" (L2547). The hook must treat an absent array as "unknown", not as "nothing armed".
- **F18 confirmed.** cross-session-messaging.md L59, L195-205, L232-255 and L305 match. Every scope is "your" sessions, and discovery beyond this machine goes through Remote Control on your claude.ai sign-in. The separate-accounts part stays inferred.
- **F22 confirmed.** The PushNotification text shipped to this agent matches, and settings-reference.md L5163-5170 gives default `false`. Binary (~232.52M):
  - The tool exists only when the server flag `tengu_kairos_push_notifications` is on. It is listed here, so the flag is on for this account.
  - Mobile push goes out when `CLAUDE_CODE_REMOTE` is set or the Remote Control bridge is active.
  - The skip reasons are `config_off`, `user_present` and `no_transport`.
- **F23 confirmed.** A key-only grep of `settings.json`, `settings.local.json` and `~/.claude.json` found no `inputNeededNotifEnabled`; the default is `false` (settings-reference.md L5291-5300).
- **F25 confirmed.** remote-control.md L18, L154 and L345-354, mobile.md L80 and whats-new w34 match. Addenda:
  - Server mode takes its own `--permission-mode <mode>` after `remote-control` (L62). A global flag such as `--dangerously-skip-permissions` placed before the subcommand makes it refuse to start (L68). Whether bypass is accepted there is untested.
  - `/rate-limit-options` is not in the list of commands the phone can run.
- **F26 confirmed.** remote-control.md L336-344 match, and the setup-token refusal appears under "Remote Control requires a full-scope login token". Addendum from L445: `claude --resume` or `--continue` "reconnects to the Remote Control session recorded in that conversation".
- **F27 confirmed.** tools-reference.md L23, L133 and L137, remote-control.md L343 and permission-modes.md L40 match. That the main loop is blocked while a question is open stays inferred.
- **F29 confirmed.** errors.md L664 and L668 match. Support article 11049741, fetched again: "Your session-based usage limit will reset every five hours. Max plans also have a weekly usage limit that applies across all models. The weekly limit resets at a fixed time each week that is assigned to your account."
- **F30 confirmed. Open question 1 is resolved, against the recommended topology.** interactive-mode.md L656-698 matches. Binary, 2.1.286 (interpretation, consistent with the docs' wording):
  - The auto-arm function `Lhr` (~215.13M) returns early `if(xm())`.
  - `xm(){return Vl()||At()||mb()!==void 0}` (~204.10M), where `Vl(){return n().surfaceCapabilities.replBridgeActive()}` (~201.09M), `At()` is a background session and `mb()` is a teammate.
  - `replBridgeActive` is set true (`WIe(!0)`, ~227.35M) when the REPL's Remote Control bridge reaches `connected` or `ready`.
  - So a session started with `--remote-control`, or after `/remote-control`, counts as a Remote Control session while connected, and automatic continue never arms. model-config.md L104 names the same three cases: "a session with Remote Control connected, a background session, or an agent team teammate's session".
  - The only manual path is at the local terminal: `/rate-limit-options`, then "Wait here, then continue automatically" (interactive-mode.md L694).
  - Implication #1 of the body must be revised (M1).
- **F31 confirmed, with the same resolution.** workflows.md L315 and L399-408 match. Binary: the run's limit handler `#f` (~221.14M) returns `{outcome:"declined"}` when `!JCt()||!FXt()||xm()`, using the same `xm` imported from the same chunk. In an RC-connected orchestrator, therefore, every agent that hits the limit fails and `agent()` resolves to `null`. A relaunch reruns the first failed agent and every agent started after it, even completed ones (workflows.md L382-386).
- **F32 confirmed.** statusline.md L154, L193-194 and L339 match, and `statusline.py` L47-51 only prints. Addendum (binary ~208.13M): `/usage` calls an undocumented OAuth endpoint, `/api/oauth/usage`. It needs the user's OAuth credential and is not a supported interface, so do not build on it.
- **F34 confirmed.** claude-code-on-the-web.md L13, L86, L139, L151 and L366-374 match; so do cloud-environments.md L195, L241, L268-285, L374-376 and L389, and permission-modes.md L58. Addendum from cloud-environments.md L278: "Cloud sessions automatically load skills you enable on claude.ai".
- **F37 partly-true.**
  - Confirmed: the aliases and list prices (model-config.md L46-53, pricing.md table fetched again). E1 showed that `haiku` resolves to `claude-haiku-4-5-20251001`.
  - Correction: cache reads do not follow the 2x/4x ratios. Opus 5.5 and Sonnet 5.5 cache hits both cost $0.20/MTok, Haiku 4.5 costs $0.10 and Fable 5.1 costs $0.25 (0.025x). Agent turns are mostly cache reads, so in practice Opus costs well under 2x Sonnet.
  - Unsourced: "API price is the best proxy for plan usage". The support page says only that the model and the effort level affect usage.
- **F38 confirmed.** model-config.md L570-585 match. prompt-caching.md L99 holds with an API key or a Claude subscription, not on Bedrock, Vertex or a gateway. `settings.json` L142-149 has top-level `high`, `claude-opus-5` at `xhigh` and `claude-opus-5-5` at `medium`.
- **F39 confirmed.** sub-agents.md L360-363 matches, with one nuance at L367: a family alias such as `opus` resolves to the main conversation's exact model, `[1m]` included, when the main model belongs to that family. workflows.md L423 and prompt-caching.md L93 match. The binary `agent()` signature (~100.98M) lists `model`, `effort`, `isolation` and `agentType`.
- **F40 confirmed.** workflows.md L350-354 and pricing.md L146-150 match.
- **F41 confirmed.** model-config.md L95-104 and remote-control.md L344 match. Addendum from model-config.md L102: "After you choose to continue on Fable using usage credits, Claude Code doesn't show the prompt again." A one-time consent at the terminal removes the stall, at the cost of accepting credit billing.
- **F43 partly-true.** Confirmed (executed): the version changed. `claude.exe` is 2.1.286, dated 21:09, and the `.old` copies report 2.1.285 and 2.1.282. Corrections:
  - agent-view.md L786: the supervisor "restarts itself onto the new version and moves idle sessions over in the background. Sessions that are working, waiting on you, or attached aren't interrupted." It does not move every background session.
  - `~/.local/share/claude/versions/` holds another full copy of 2.1.282, 2.1.285 and 2.1.286. These are separate files with a link count of 1, about 731 MB, on top of about 731 MB in `~/.local/bin`: roughly 1.2 GB of old or duplicate binaries.
  - `~/.claude.json` contains the legacy `"autoUpdates": false`, which did not prevent today's two updates (11:22 and 21:09). The documented switch is `DISABLE_AUTOUPDATER=1` in the settings `env`.
  - A running process keeps its version, and an update takes effect at the next start or resume (inferred from the `.old` rename).
- **F44 confirmed.** `df -h /c` at 21:46 showed 4.2 GB free (100% used).
- **F45 confirmed.** `tzutil /g` returns "Romance Standard Time": base UTC+1, with daylight saving active (UTC+2). 12:00 SGT is 04:00 UTC and 06:00 CEST; 23:59 SGT is 15:59 UTC and 17:59 CEST. EU daylight saving ends on 25 Oct. Addendum (executed, read-only): automatic time-zone updating is on (`HKLM/SYSTEM/CurrentControlSet/Services/tzautoupdate` Start = 3), so Windows is likely to switch to Singapore time at the venue.
- **F46 confirmed.** permission-modes.md L33-46 and L572 and agent-view.md L682 match. Addendum from L43: with `blockReadsOutsideWorkingDirectories` on, reads outside the working directories also prompt in bypass.

### Missed

- **M1. Neither automatic usage-limit wait works under Remote Control** (F30/F31). The body's host topology keeps RC connected and relies on the automatic wait, which does not arm there. The design must choose one of three options and rehearse it before 4 Oct:
  - (a) Failure and relaunch: after the reset the cron heartbeat relaunches with `resumeFromRunId`. Keep waves small, or pass the list of already-proven items in `args` so the script skips them, because the relaunch reruns everything after the first failure.
  - (b) `CLAUDE_CODE_RETRY_WATCHDOG=1`, which sleeps until the reset without any RC check (binary reading, not executed) but keeps turns busy.
  - (c) Disconnecting RC during heavy waves.
- **M2. Bypass mode is not restored on resume.** sessions.md L60: a session that ended in `bypassPermissions` and is resumed from a terminal starts in "The permission mode a new session would start in"; auto is the built-in default when available (permission-modes.md L62-75). Bypass cannot be entered mid-session (F46), so the recovery command is `claude --resume "<name>" --dangerously-skip-permissions`. Remote Control reconnects on its own (remote-control.md L445).
- **M3. A cron-fired `/execution tick` needs a skill Claude can invoke on its own.** scheduled-tasks.md L43-47: "A scheduled fire only runs skills that Claude is allowed to invoke on its own." A skill with `disable-model-invocation: true` (the /harden style) arrives as plain text, and so do built-in commands. Either /execution stays model-invocable, or the tick prompt is written as plain instructions.
- **M4. A backgrounded orchestrator dies between waves.** An idle, unattached background session has its process stopped after about an hour unless it is pinned (agent-view.md L939), and its heartbeat stops with it.
- **M5. Near-limit wrap-up hints may arrive** (binary ~208.87M, feature flags `tengu_lantern_wick_mode` and `tengu_vellum_anchor`, whose state for this account is unknown). The text is "[Usage limit approaching. Checkpoint now: finish the current step, then list up to 3 short bullets of the most impactful remaining work. Don't start subagents or long-running work.]", plus a "grace window active" variant. /execution should read either one as "stop launching waves", not fight it.
- **M6. A Workflow launch can fail silently.** Check `error` in the result (agent-sdk/typescript.md L4026).
- **M7. Several completions can arrive in one turn** (agent-sdk/typescript.md L1586). The tick must reconcile every finished task from the state file.
- **M8. Wave agents can create crons and send pushes** (executed: this workflow agent has CronCreate, PushNotification, Monitor, RemoteTrigger and SendMessage). Wave prompts should forbid both, so that one heartbeat and one notification owner remain.
- **M9. A compact-matched SessionStart hook can restore the state digest after compaction** (context-window.md L1609). This matters because a skill body can be dropped entirely once 25k tokens of skills have been invoked (L1615).
- **M10. The Windows time zone switches automatically.** Automatic time zone is on, so decide before the flight whether the laptop stays on Paris time or moves to SGT. Create the crons after that decision, and store deadlines in UTC.
- **M11. About 1.2 GB of old or duplicate Claude binaries** sit in `~/.local/bin/*.old.*` and `~/.local/share/claude/versions/{2.1.282,2.1.285}`. Deleting them is a manual clean-up for the user; nothing was deleted here.
- **M12. Crash recovery needs 2.1.286 or later.** The 2.1.286 changelog fixed "`claude --resume` and `--continue` sometimes losing every turn after a batch of parallel tool calls when the earlier session crashed or was killed". Freeze the version at 2.1.286 or above.
