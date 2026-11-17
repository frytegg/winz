# cc-runtime

## Summary
1. Idle wake-ups exist. A finished background Bash command, background subagent or Workflow run, a cron or /loop fire, a Monitor line, a cross-session message or an asyncRewake hook starts a new turn in an idle interactive session. A turn that ends with nothing armed stays idle for good (F01, F13-F18).
2. Enforce "never stop without a wake source" with a skill-scoped Stop hook (its input has background_tasks and session_crons) plus a CronCreate heartbeat (F17, F13).
3. The orchestrator must be the main loop. Subagents never get Workflow, ScheduleWakeup or AskUserQuestion (F10). A Workflow resumes only in the same session ("Same session only"); otherwise recover from journal.jsonl (F08).
4. Each wave is one Workflow run: no user input mid-run, 16 agents at once by default, 1,000 per run, Date.now() not allowed (F09).
5. Survival: a plain terminal session ends when its window closes. /bg sessions survive a closed terminal and S3 sleep but not a shutdown; they drop Monitors, restart running workflow agents, and never wait at a usage limit (F04-F06, F30, F31).
6. Network: 10 API retries by default; CLAUDE_CODE_RETRY_WATCHDOG=1 gives about 3 h. Interactive Remote Control reconnects without limit; server mode exits after about 10 min offline (F07, F26).
7. Limits: the 5h and weekly windows are shared by all surfaces, and a large fan-out can use up the weekly window. The automatic continue (on by default) needs an interactive subscription session, a reset less than 24 h away, at most 2 re-arms, and Enter after more than 30 min of sleep. A used-up weekly window stops the build (F29-F31).
8. Usage can be read only from the status-line JSON rate_limits (5h/7d percent and resets_at) or the SDK rate_limit_event. statusline.py prints it but never saves it (F32).
9. Phone: pushes arrive only while Remote Control is connected. agentPushNotifEnabled (set) covers pushes Claude decides to send; inputNeededNotifEnabled (NOT set) is needed for pushes on prompts and questions. No push while the user is at the terminal. The phone can send prompts and photos, answer questions and permission prompts, stop tasks, and run a few built-in commands; it cannot select bypass or auto (F22-F27).
10. Cloud: claude --cloud sessions keep running with the laptop closed, but clone from GitHub, lack user-level skills, CLAUDE.md and MCP unless committed, run on 4 vCPU/16 GB/30 GB, pause when idle, and lose background work on reclaim. Routines run at least 1 h apart, act as the user and can use claude.ai connectors. Agent isolation:"remote" is gated and undocumented (F19, F34, F35).
11. Models per MTok in/out: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5, Fable 5.1 $10/$50. Fable's consent prompt ends unattended turns after 5 min. agent() takes opts.model and opts.effort; identical configurations share a cache prefix; the subagent cache TTL is 5 min unless set to 1h (F37-F41).
12. Machine: C: 1.9-4.8 GB free today; auto-update moved 2.1.285 to 2.1.286 during the research; clock on Paris time, so cron runs in Paris time and SGT is Paris + 6 h (F43-F45).

## Recommendations
1. Host the orchestrator as the main loop of one named interactive session: `claude --remote-control "<proj>-exec" --dangerously-skip-permissions -n "<proj>-exec"`, started with env CLAUDE_CODE_RETRY_WATCHDOG=1. Never make /loop its first prompt, and never /bg it while a wave is running (F05, F07, F10, F12, F30, F31).
2. Liveness invariant: every orchestrator turn must end with at least one wake source armed (a running Workflow or background task, a Monitor, or a CronCreate heartbeat). Enforce it with a skill-scoped Stop hook, active only while a marker file exists, that reads background_tasks and session_crons and blocks the stop when the plan is open and no manual task is pending. Mind the 8-continuation cap (F17).
3. Create one recurring CronCreate heartbeat at an off-minute every 20-30 min with the prompt '/execution tick'. The tick is idempotent: reread the state file, reconcile all finished tasks, re-verify proofs, relaunch null or failed agents with resumeFromRunId, re-arm Monitors, and push the Notion report when due. It also recovers from failed turns and from usage-limit stops (F02, F13, F31).
4. Each wave is one Workflow run launched by the main loop. Scripts are deterministic (timestamps through args). Proofs are checked by verifier agents that did not write the code, using a schema. null means rerun. Record runId, scriptPath and transcriptDir in .execution/state.json. Set CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS below 16 to fit 16 GB RAM and a nearly full disk (F08, F09, F44).
5. Manual tasks must not block the loop: write the ask to Notion, call PushNotification, leave other waves and the heartbeat armed, and end the turn. The user's reply from phone or terminal starts the next turn. Reserve AskUserQuestion for moments when nothing else can proceed (F27).
6. Preflight checklist that /execution itself verifies: Remote Control connected; 'Push when actions required' (inputNeededNotifEnabled) on; agentPushNotifEnabled true; disk free above a threshold; lid-close and idle sleep off on AC; time zone settled; auto-update frozen (DISABLE_AUTOUPDATER=1) if the user agrees; weekly usage percentage and reset time read from the snapshot (F06, F22, F23, F32, F43-F45).
7. Extend ~/.claude/statusline.py to also atomically write ~/.claude/usage-snapshot.json (five_hour and seven_day used_percentage and resets_at, plus the capture timestamp), and set statusLine refreshInterval. Gate each wave on the remaining budget: above about 85% of the 5h window run only critical-path waves; if the weekly window cannot cover the plan, stop and ask the user (F29, F32).
8. Put the state machine, the invariants and the recovery playbook in the first ~5,000 tokens of SKILL.md, because only that much survives compaction. Put no model: in the SKILL.md frontmatter (F03, F39).
9. Recovery playbook: terminal closed → `claude --resume "<name>"` → /execution resume (CronList check, relaunch with resumeFromRunId, re-arm Monitors). Session lost → read journal.jsonl and relaunch only the unfinished items. Remote Control dropped → /remote-control. Slept through a reset → Enter or any prompt from the phone (F06, F08, F12, F26).
10. Model and effort policy per task: orchestrator Opus 5.5 medium (high when re-planning); code writers Opus 5.5 or Sonnet 5.5 medium; verifiers and judges Opus 5.5 high; mechanical proof checks Haiku low; never Fable unattended. Group identical agent configurations to share the cache prefix; set subagentPromptCacheTtl=1h only when a prefix is reused after gaps longer than 5 min (F37-F41).
11. For long single waits (one CI run, a chain confirmation), use one background Bash `until ...; do sleep 30; done` (up to 2 h) instead of chaining 30-min Monitors. Use Monitors for multi-event streams and re-arm them from the tick (F11, F15).
12. Offload to the cloud per task only (`claude --cloud`) for self-contained work that needs no local secrets or wallets: push first, commit the needed skills to the repo's .claude/skills, record the session id, and steer with `claude -p ... --cloud <id>`. Do not rely on Agent isolation:'remote' (F34, F35).
13. Optional watchdog that runs without the laptop: an hourly routine with the claude.ai Notion connector checks the plan page and the pushed commits, and writes a Notion mention or comment when the build is stale (more than 2 h), so the push arrives through the Notion app (F19).
14. Two developers: Notion and git are the only shared bus, since cross-session messaging does not cross accounts. Each orchestrator claims only tasks owned by its developer or its own agent, and dev B repeats the same preflight (Remote Control and push settings on his own account) (F18).
15. Optionally run `/goal node scripts/completion-check.mjs exits 0 and all plan proofs re-verified, or stop after N turns` in the orchestrator session as a backstop, with the tick printing proof results into the transcript (F16).
16. Store every deadline (T-6h demo audit, submission) in UTC in the state file and convert to local time when scheduling one-shot crons. Treat crons as up to 15-30 min late, so schedule alarms early (F13, F45).

## Risks
1. The orchestrator goes silently idle: a turn ends with no background task, cron or Monitor (for example after a failed API turn or a forgotten re-arm), and nothing wakes it until the user types (F01, F13, F17).
2. A blocking AskUserQuestion for one manual task stalls every other wave; completion notifications queue behind the open dialog (F27).
3. In a background or Remote Control session, workflow agents that hit the usage limit fail with null instead of pausing, and a script that treats null as done ticks tasks falsely (F31).
4. The weekly window runs out mid-event (large fan-outs make this likely), and nothing auto-resumes when the reset is more than 24 h away (F29, F30).
5. If an interactive session with Remote Control on counts as a 'Remote Control session', the automatic usage-limit wait never arms (unverified) (F30).
6. The lid is closed at the venue (S3 sleep): all work freezes, and a reset during more than 30 min of sleep needs a manual Enter or prompt (F06).
7. Venue Wi-Fi drops: without the retry watchdog a turn fails after 10 retries; server-mode Remote Control exits after about 10 min offline; the phone loses contact (F07, F26).
8. The terminal window is closed with its X button: the session and all background tasks die; Monitors and self-paced loops are not restored; workflows must be relaunched from the resumed session (F04, F12).
9. The session is backgrounded mid-wave: running workflow agents restart from zero (tokens spent twice) and Monitors are stopped (F05).
10. Auto-update installs a new Claude Code version mid-event (observed today), changing behaviour; background sessions are restarted by the supervisor (F43).
11. The disk fills up (1.9 GB free observed): installs, worktrees, Docker and old binaries make builds and agents fail in confusing ways (F44).
12. Time zone mismatch (Paris vs SGT, 6 h) makes the T-6h audit and other scheduled tasks fire at the wrong wall-clock time; cron jitter adds up to 15-30 min (F13, F45).
13. A 30-min Monitor expires without being re-armed and CI watching stops silently (F15).
14. An agent routed to Fable waits on a consent prompt that the phone never sees, and the turn ends without sending (F41).
15. Crypto or key-handling content trips the safety classifier; with switchModelsOnFlag=false the session pauses for a choice (F42).
16. Cloud offload loses uncommitted work when the VM is reclaimed, can push only to the session branch, and cannot use local secrets, wallets or user-level skills (F34).
17. Dev A's and dev B's orchestrators both pick up the same task without a strict owner field in Notion, because their sessions cannot message each other (F18).
18. An orchestrator session started with /loop as its first prompt disappears from --continue and the picker, which complicates recovery (F12).

## Open questions
1. Does an interactive session with /remote-control (or started with --remote-control) count as a 'Remote Control session' for interactive-mode.md L690 and workflows.md L405, disabling the automatic usage-limit wait and the workflow pause? Test in rehearsal or ask Anthropic.
2. Does a cron heartbeat that fires during a usage-limit wait count as 'You send a prompt' and cancel the automatic continue?
3. Does CLAUDE_CODE_RETRY_WATCHDOG=1 wait out a claude.ai plan limit in sessions where the automatic wait is not offered (background, Remote Control), and how does it interact with autoContinueAtUsageLimit?
4. Are CronCreate jobs restored on --resume in 2.1.286 (the docs say yes; the shipped tool text says 'gone when Claude exits')? Is recurring jitter 10% (max 15 min) or up to 30 min?
5. Is the user on Max 5x or Max 20x, and when does the weekly window reset relative to 6-7 Oct SGT? Check /usage before flying.
6. Does a custom user skill typed from the phone over Remote Control (e.g. '/execution resume') run as a skill in the local session?
7. Are the server-side push flags (tengu_kairos_push_notifications, tengu_kairos_input_needed_push) on for this account? A rehearsal PushNotification should return 'Mobile push requested.'
8. Is the claude.ai Notion connector available in cloud sessions and routines for this account?
9. When several background completions land while the session is idle, are they delivered in one turn or several?
10. Does the status-line rate_limits data refresh from workflow and subagent API responses, or only from main-loop responses?
11. Is Agent isolation:'remote' enabled for this account? This only matters if the design ever wants it.

## Findings
- F01 [verified-source, LB] When background work finishes after the turn has ended and the user is idle, Claude Code re-invokes the model with a new turn. This covers background Bash commands, background subagents and Workflow runs.
  -> After launching a wave the orchestrator can end its turn without polling; the wave's completion notification wakes it.
- F02 [inferred] Several completions at once are queued and shown collapsed (3 lines plus an overflow summary). Delivery in a single turn is not documented.
  -> The tick handler must be idempotent and reconcile every finished task from the state file, not only the one that woke it.
- F03 [verified-source, LB] Auto-compaction does not stop background commands, subagents or workflows. Skill bodies are re-injected afterwards, capped at 5,000 tokens per skill with the start of the file kept.
  -> The /execution state machine and its invariants must fit in the first ~5k tokens of SKILL.md. Plan state belongs on disk and in Notion.
- F04 [verified-source, LB] A plain terminal session ends when its terminal closes, and its background tasks are cleaned up. Workflow results stay on disk and can be replayed only from the resumed same session.
  -> Recovery must be claude --resume <named session>, then relaunch the recorded runs. Closing the window with its X button kills everything (inferred: no exit dialog).
- F05 [verified-source, LB] Background sessions (/bg, claude --bg, run by the supervisor) survive a closed terminal and sleep but not a shutdown. /loop tasks, workflows, background shells and subagents carry over; Monitors stop, and workflow agents that were running restart from zero.
  -> Background the session only between waves. It also loses the usage-limit wait (F30, F31). claude agents --json exposes the state to scripts.
- F06 [verified-source, LB] Sleep: API requests broken by sleep are retried. A usage-limit reset during more than 30 minutes of sleep needs Enter. This machine has S3 sleep only, so every process freezes.
  -> A manual preflight task: plug in and disable lid and idle sleep at the venue. Any prompt from the phone also resumes.
- F07 [verified-source, LB] On network loss a turn fails after 10 retries by default. CLAUDE_CODE_RETRY_WATCHDOG=1 gives about 3 h and waits out rate limits. Interactive Remote Control retries without limit; server mode exits after about 10 min.
  -> Launch the orchestrator with CLAUDE_CODE_RETRY_WATCHDOG=1, in interactive Remote Control mode rather than server mode.
- F08 [verified-source, LB] A Workflow run is resumable only within the same session (a resumed or backgrounded copy of it replays the run). Otherwise results must be recovered from journal.jsonl or the agent transcripts.
  -> Record runId, scriptPath and transcriptDir per wave in the state file. Relaunch with Workflow({scriptPath, resumeFromRunId}).
- F09 [verified-source, LB] Workflow limits: no user input mid-run, 16 agents at once by default (capped by CPU count, adjustable 1-256), 1,000 agents and 4,096 items per call, and Date.now()/Math.random() throw. Bypass mode starts runs without a prompt.
  -> One wave is one workflow; manual sign-off happens between workflows. Pass timestamps through args. Lower the concurrency to fit 16 GB RAM and <5 GB disk.
- F10 [verified-source, LB] Subagents never get Workflow, ScheduleWakeup or AskUserQuestion. Background subagents get a reduced built-in tool set, nesting stops at depth 3, and 20 subagents can run at once.
  -> The orchestrator must run as the main loop of one interactive session and launch the workflows itself.
- F11 [verified-source, LB] A background Bash or PowerShell command gets 30 minutes by default, 2 hours at most (env vars raise this). A command started by a foreground subagent ends with that subagent.
  -> CI and chain watchers belong to the main loop and must be re-armed by the heartbeat.
- F12 [verified-source, LB] --resume restores cron jobs that have not expired and an active goal. It does not restore background Bash or Monitors and starts no turn. Sessions whose first prompt was /loop are hidden from the picker and --continue.
  -> Name the orchestrator session (-n) and never open it with /loop. The resume playbook must re-arm Monitors and relaunch runs.
- F13 [verified-source, LB] CronCreate jobs are session-scoped and in memory. They fire only when idle, expire after 7 days, are capped at 50 per session, run in local time and never catch up. The shipped tool text (up to 10% late, max 15 min; durable has no effect) contradicts the docs (up to 30 min late; restored on resume).
  -> Use cron as a coarse heartbeat at off-minutes, not as a precise deadline alarm. Check CronList after every resume.
- F14 [verified-source, LB] /loop has a fixed mode (cron) and a self-paced mode (ScheduleWakeup, clamped to 60-3600 s; stop:true ends it; a single fallback about 20 min later). A self-paced loop is not restored on resume. The internal loop prompt uses a Monitor as the wake signal and a 1200-1800 s wakeup as the fallback heartbeat.
  -> Prefer an explicit CronCreate heartbeat plus Monitors over a self-paced /loop for a multi-day run.
- F15 [verified-source, LB] Monitor turns each stdout line (or WebSocket frame) into an event. Each watch lasts 5 minutes by default and at most 30 minutes, then needs re-arming. Monitors are stopped when the session is backgrounded, and noisy ones are killed.
  -> For one GitHub Actions run, a background Bash `until gh run view ...` loop (one notification, up to 2 h) is simpler than re-arming a Monitor.
- F16 [verified-source, LB] /goal keeps starting turns until a small-model evaluator, which reads only the transcript, judges the condition met. It waits for background work and checks in after 30 min idle (at most 3 idle check-ins), pauses at usage limits, and resumes with the automatic continue.
  -> /goal on completion-check.mjs can serve as the keep-going backstop, as long as the proof output is printed into the transcript.
- F17 [verified-source, LB] The Stop-hook input includes background_tasks and session_crons, and at most 8 continuations in a row are allowed. asyncRewake hooks wake an idle session on exit code 2 (their timeout is enforced, 600 s by default).
  -> A Stop hook gated by a marker file, in the /harden style, can enforce the liveness invariant: never stop with the plan open and no wake source armed.
- F18 [verified-source, LB] A cross-session message, or a post to the session's own inbox socket, starts a turn in an idle session. It works only between sessions of the same account. A bypass-mode session holds messages from senders that are not in bypass.
  -> Dev A and dev B are on separate accounts (inferred), so Notion and git are the only channel between them.
- F19 [verified-source] Routines (/schedule, RemoteTrigger) run in the cloud with the laptop off, at least 1 hour apart and at most 100 scheduled runs per hour. They have no permission prompts, act as the user and can use claude.ai connectors. They are in research preview.
  -> Possible watchdog that runs without the laptop: an hourly Notion staleness check. It cannot restart the laptop.
- F20 [verified-source] Desktop scheduled tasks fire only while the Desktop app is open and the machine is awake.
  -> Not useful for a CLI-based /execution.
- F21 [verified-source] Channels (Telegram/Discord/iMessage bots, research preview, need Bun) push messages into an open local session only.
  -> A possible phone bridge, but Remote Control already covers it. It cannot read an event's Discord server.
- F22 [verified-source, LB] PushNotification sends a terminal notification plus a phone push, the push only while Remote Control is connected. It is skipped when the user is active at the terminal and gated by agentPushNotifEnabled (true for this user).
  -> Keep Remote Control connected at all times. Push only on events the user must act on.
- F23 [verified-executed, LB] inputNeededNotifEnabled (Push when actions required) is not set, so permission prompts and questions do not push to the phone.
  -> Preflight: the user turns it on in /config, or /execution calls PushNotification for every manual task.
- F24 [verified-source] Notification hook types include permission_prompt, idle_prompt (about 60 s), agent_needs_input and agent_completed (only while agent view is open), and quota_auto_resume_fired/stale/disabled. The user's hooks only produce local toasts and tab titles.
  -> A Notification hook can forward quota and prompt events to Notion, but nothing reaches the phone except Remote Control or Notion's own app.
- F25 [verified-source, LB] Remote Control makes the phone a window into the local session. The phone can send prompts and photos, answer AskUserQuestion and permission prompts, stop subagents and workflows, and run a limited set of built-in commands. It cannot select bypass or auto mode. Server mode lets the phone start new sessions on the laptop.
  -> Start the orchestrator with claude --remote-control <name> and bypass mode at launch. Optionally run server mode in a second terminal for restarts from the phone. Custom skills typed on the phone still need testing.
- F26 [verified-source, LB] Remote Control failure modes: offline when the claude process stops; server mode exits after about 10 min offline; after 30 min of failed heartbeats a manual /remote-control is needed; forwarded dialogs other than permission prompts and questions expire after 5 min; the Fable consent prompt is not forwarded; setup-token logins are refused.
  -> The tick should check Remote Control status and push via Notion when Remote Control is down.
- F27 [verified-source, LB] AskUserQuestion stays open until answered (a timeout is optional) and is forwarded to the phone and kept open. Permission prompts never auto-resolve. While a question is open the main loop is blocked (inferred).
  -> For manual tasks: write to Notion, push, leave wake sources armed and end the turn. The user's reply starts the next turn. Use AskUserQuestion only when nothing else can run.
- F28 [verified-source] SendUserFile sends files to the phone when Remote Control is connected. Photos from the phone land in ~/.claude/uploads/.
  -> Screenshots or proofs the user brings back from the phone can land on disk directly.
- F29 [verified-source, LB] On Max the session window resets every 5 h and the weekly window at a fixed time per account. Both are shared across claude.ai, Code, Desktop and cloud, and some limits are per model (Opus, Sonnet). A large fan-out can use up the weekly window.
  -> Budget waves against the weekly window and check the weekly reset time before the event.
- F30 [verified-source, LB] Automatic continue at a usage limit is on by default in interactive subscription sessions. It re-arms at most twice, only when the reset is less than 24 h away, needs Enter after more than 30 min of sleep, and is cancelled by exit or handoff. It is not started automatically in Remote Control or teammate sessions, and is unavailable in background and -p sessions.
  -> Do not rely on it alone. The heartbeat cron re-triggers after a reset. Whether a session with /remote-control on counts as a Remote Control session must be tested.
- F31 [verified-source, LB] A Workflow run at a usage limit pauses and continues only under the same conditions (v2.1.271+). In background or Remote Control sessions, or after a third hit, the agents fail and agent() returns null.
  -> Wave scripts must treat null as 'rerun', never 'done'. The tick relaunches with resumeFromRunId after the reset.
- F32 [verified-source, LB] A session can read its 5h and 7d usage only from the status-line JSON rate_limits (used_percentage and resets_at; Pro/Max only; present after the first API response) or the SDK rate_limit_event. There is no CLI command. The user's statusline.py prints it but does not save it.
  -> Extend statusline.py to also write an atomic usage snapshot file, read by preflight and the tick. /usage also works from the phone.
- F33 [verified-source] Quota is spent while nobody types by cron fires, cross-session messages, goal check-ins and every subagent or workflow agent. The main conversation gets a 1h cache TTL within plan usage; subagents and workflows get 5 min.
  -> Keep the orchestrator transcript small: each tick resends it. /compact at wave boundaries.
- F34 [verified-source, LB] Cloud sessions keep running with the laptop closed. They need GitHub (push first, or a bundle under 100 MB) and lack user-level skills, CLAUDE.md and MCP, while claude.ai connectors work. They run on 4 vCPU/16 GB/30 GB Ubuntu, pause and are reclaimed when idle (background work lost), push only to the session branch, ignore bypass from settings, share rate limits and carry no compute charge.
  -> Offload only self-contained tasks that need no local secrets. Commit the needed skills to the repo's .claude/skills. Steer with claude -p ... --cloud <id>.
- F35 [verified-source] The Agent tool's isolation:"remote" (a cloud CCR sandbox) exists in the binary but is gated by feature flag and account state and is undocumented. The agent({isolation:'remote'}) form is not available in this build.
  -> Do not design on it. Use the documented claude --cloud instead.
- F36 [verified-source] Projects (a cloud coordinator; threads auto-continue at limits; 200 threads per day) are in public beta, rolling out gradually, and not available in the CLI.
  -> Not a building block for a CLI skill.
- F37 [verified-source, LB] Aliases: opus = Opus 5.5 ($4/$20 per MTok, cache hit 0.05x), sonnet = Sonnet 5.5 ($2/$10), haiku = Haiku 4.5 ($1/$5), fable = Fable 5.1 ($10/$50). API prices are the best proxy for relative plan usage.
  -> Plan cost estimates per task: Opus is about 2x Sonnet and 4x Haiku; Fable is 2.5x Opus.
- F38 [verified-source, LB] Effort levels are low/medium/high/xhigh/max. Opus 5.5 defaults to medium; the top-level effortLevel does not apply to Opus 5.5. The user saved Opus 5.5 at medium. Changing effort keeps the cache on Opus 5.5, Sonnet 5.5 and Fable 5.1.
  -> Set effort per agent explicitly (high for verifiers, low for mechanical checks). Do not assume 'high'.
- F39 [verified-source, LB] A subagent's or workflow agent's model is chosen in this order: per-invocation parameter, then frontmatter, then CLAUDE_CODE_SUBAGENT_MODEL, then the session model. agent() opts accept model, effort, isolation:'worktree' and agentType. A model in skill frontmatter causes a full cache-miss turn.
  -> Put no model: in the /execution SKILL.md. Choose model and effort per agent in the wave scripts.
- F40 [verified-source, LB] Agents in a fan-out with the same model, effort, type, tools, schema and working directory share a cache prefix (stagger up to 5 s). A workflow agent's cache TTL is 5 min even on a subscription unless subagentPromptCacheTtl is 1h (a 1h write costs 2x, a 5m write 1.25x).
  -> Group identical agent configurations within a wave. Set the 1h TTL only when a prefix is reused after gaps longer than 5 minutes.
- F41 [verified-source, LB] Fable can bill to usage credits. In Remote Control, background or teammate sessions its consent prompt waits dialogExpiry (5 min), is not forwarded to the phone, and then ends the turn without sending.
  -> Never pick fable for unattended /execution agents unless the user consented beforehand and accepts billing.
- F42 [verified-source] Safety classifiers re-route requests with security or biology content (Opus 5.5 to Opus 4.8 for cyber). With switchModelsOnFlag false (the user's setting), a flagged request pauses the session for a choice.
  -> Crypto or key-handling code can trip this and stall the loop. Consider switchModelsOnFlag true for the event.
- F43 [verified-executed, LB] Auto-update (channel latest) changed the installed version from 2.1.285 to 2.1.286 during this research. Old binaries of about 242-244 MB each are kept. The supervisor restarts background sessions onto new versions.
  -> Freeze the version for the rehearsal and the event with DISABLE_AUTOUPDATER=1, if the user agrees.
- F44 [verified-executed, LB] The C: drive is almost full: 1.9 GB free at about 21:16 and 4.8 GB at about 21:22 today (the brief said 6.9 GB).
  -> Disk space is a preflight gate and a limit on worktree isolation and parallel installs.
- F45 [verified-executed, LB] The machine is on Paris time. Cron, loop and routine times are local wall-clock time. The hack window, 6 Oct 12:00 to 7 Oct 23:59 SGT, is 06:00 Tue to 17:59 Wed Paris time.
  -> Store deadlines in UTC and convert when scheduling. Settle the Windows time zone before creating crons.
- F46 [verified-source, LB] Bypass mode still stops for ask rules, AskUserQuestion and requiresUserInteraction MCP tools, rm of critical paths, and cross-session safeguards. Bypass cannot be entered mid-session unless enabled at launch.
  -> Launch the orchestrator in bypass mode. Expect AskUserQuestion to be the only user-blocking tool.

## Verification
- F01: CONFIRMED — Holds for background Bash commands, background subagents and Workflow runs. Several finished tasks can be answered in one turn, so the tick must reconcile everything in the state file. A resumed session does not start a turn from work that ended with the previous process.
- F03: CONFIRMED — Past the 25,000-token total, the oldest invoked skills are dropped entirely, not only truncated. If the orchestrator later invokes other large skills, the /execution body can vanish after compaction. A SessionStart hook that matches the compact source can re-inject the state digest.
- F04: CONFIRMED — On Windows, a process that detached from its task's shell may outlive the session: the docs say such processes are killed only on macOS and Linux (inferred from the wording). Recovery also needs --dangerously-skip-permissions, because bypass is not restored on resume (see missed). The X-button claim remains inferred.
- F05: CONFIRMED — The implication "background the session only between waves" is unsafe. An idle, unattached background session has its process stopped by the supervisor after about an hour unless it is pinned with Ctrl+T, and that also stops its cron heartbeat. Only a running subagent, workflow or monitor counts as working.
- F06: CONFIRMED — Idle sleep on AC is already set to never, and to 600 s on battery. The lid-close action is not exposed by powercfg on this laptop, so the user must check it by hand. With Remote Control connected no automatic wait is armed anyway (F30), so the "press Enter after sleep" case applies only without Remote Control.
- F07: CONFIRMED — Binary reading, not executed. With the watchdog on, the shared retry loop retries 529s and 429s (except spend-limit and exhausted-credit 429s) with no Remote Control or background check. When a 429 carries a reset header, the request sleeps until that time, at most 6 h per sleep. It is therefore the only automatic usage-limit wait left in a session with Remote Control connected. While it sleeps the turn stays busy, so crons cannot fire and phone prompts queue (inferred).
- F08: CONFIRMED — The launch result must also be checked for `error`: a script that fails its syntax check still returns status async_launched with error set, and never runs. Failed or killed runs append a recovery block that contains the exact resume call.
- F09: CONFIRMED — Also, each running agent's transcript is held in memory, so raising the concurrency raises RAM use.
- F10: CONFIRMED — Workflow agents do not get the reduced background-subagent tool set. This workflow agent has CronCreate, CronList, CronDelete, PushNotification, Monitor, RemoteTrigger and SendMessage available. It was not tested where a cron created by a wave agent would land. The 20-subagent limit can be changed with CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, and ultracode sessions are exempt from it.
- F11: CONFIRMED — A foreground command that reaches its timeout is moved to the background, with 30 minutes counted from the move, unless it starts with sleep.
- F12: CONFIRMED — Verified by execution on 2.1.286: a CronCreate job survived the process exit and came back on --resume. Bypass mode is NOT restored on a terminal resume, so the recovery command must include --dangerously-skip-permissions (see missed).
- F13: CONFIRMED — The contradiction is real, and it is now resolved in favour of the docs. Execution shows jobs are restored on resume. The built-in jitter default is up to half the period, capped at 30 minutes, not 10% capped at 15 minutes. A server flag can override it per account. Budget up to 30 minutes of lateness per fire.
- F14: CONFIRMED
- F15: CONFIRMED
- F16: CONFIRMED — With Remote Control connected no automatic usage-limit wait is armed (F30), so a goal paused at a limit stays paused until a prompt arrives, either a cron tick or one sent from the phone. The user must type /goal. An internal ProposeGoal tool exists in the binary but is marked @internal and is not visible to this agent.
- F17: CONFIRMED — The 8-continuation cap can be changed with CLAUDE_CODE_STOP_HOOK_BLOCK_CAP. The two arrays are present only "when the task registry is reachable", so the hook must treat an absent array as unknown, not as "nothing armed".
- F18: CONFIRMED — That dev A and dev B use separate accounts remains inferred. The docs scope everything to "your" sessions, and reaching sessions on another machine needs Remote Control under your own claude.ai sign-in.
- F22: CONFIRMED — PushNotification exists only when the server flag tengu_kairos_push_notifications is on. It is listed in this agent, so the flag is on for this account. Mobile push goes out only when the Remote Control bridge is active or CLAUDE_CODE_REMOTE is set.
- F23: CONFIRMED
- F25: CONFIRMED — Server mode takes its own --permission-mode after the remote-control subcommand, and refuses to start if a global flag such as --dangerously-skip-permissions is placed before it; whether bypass is accepted there is untested. /rate-limit-options is not among the commands usable from the phone. Whether a custom skill typed on the phone runs is still untested.
- F26: CONFIRMED — Resuming with claude --resume or --continue reconnects the Remote Control session recorded in the conversation.
- F27: CONFIRMED — That the main loop is blocked while a question is open remains inferred.
- F29: CONFIRMED
- F30: CONFIRMED — Open question 1 is resolved, and against the design. An interactive session started with --remote-control, or after /remote-control, counts as a Remote Control session while the bridge is connected, so automatic continue never arms in the recommended topology. The only manual path is /rate-limit-options at the local terminal. The heartbeat cron, not auto-continue, is the primary recovery path.
- F31: CONFIRMED — Same resolution as F30: in a session with Remote Control connected, workflow agents that hit the limit fail and agent() returns null; they never pause. A relaunch reruns the first failed agent and every agent started after it, even completed ones.
- F32: CONFIRMED — /usage calls an undocumented OAuth endpoint, /api/oauth/usage. It needs the user's credential and is not a supported interface, so do not build on it.
- F34: CONFIRMED — Cloud sessions also load skills the user has enabled on claude.ai.
- F37: PARTLY-TRUE — The aliases and list prices are correct. Cache reads do not follow the 2x/4x ratios: Opus 5.5 and Sonnet 5.5 cache hits both cost $0.20/MTok, Haiku 4.5 $0.10 and Fable 5.1 $0.25 (0.025x). Agent turns are dominated by cache reads, so Opus is well under 2x Sonnet in practice. "API price is the best proxy for plan usage" has no source.
- F38: CONFIRMED — Changing effort keeps the cache only with an API key or a Claude subscription, not on Bedrock, Vertex or a gateway. The user's settings also have claude-opus-5 at xhigh.
- F39: CONFIRMED — A family alias such as opus, passed per invocation, resolves to the main conversation's exact model, including [1m], when the main model is in that family.
- F40: CONFIRMED
- F41: CONFIRMED — If the user consents once at the terminal to continue on Fable with usage credits, the prompt is not shown again, which removes the stall but accepts credit billing.
- F43: PARTLY-TRUE — The supervisor moves only IDLE background sessions onto a new version; sessions that are working, waiting on the user or attached are not interrupted. ~/.local/share/claude/versions holds another full copy of 2.1.282, 2.1.285 and 2.1.286 (about 731 MB), so about 1.2 GB of binaries are old or duplicated. The legacy "autoUpdates": false in ~/.claude.json did not stop two updates today. DISABLE_AUTOUPDATER=1 in the settings env block is the documented switch. A running process keeps its version (inferred).
- F44: CONFIRMED — Free space keeps fluctuating: 4.2 GB at 21:46.
- F45: CONFIRMED — Automatic time-zone updating is on, so Windows will likely switch to Singapore time at the venue. Decide the time zone before creating crons, and keep deadlines in UTC.
- F46: CONFIRMED — Bypass mode also prompts for reads outside the working directories when blockReadsOutsideWorkingDirectories is on. Bypass is not restored on a terminal resume (see missed).

### Missed
1. The recommended topology loses both automatic usage-limit waits. In an interactive session with Remote Control connected, auto-continue never arms and workflow agents fail at a usage limit instead of pausing (binary 2.1.286: xm() includes replBridgeActive). Before 4 Oct, choose and rehearse one of: (a) cron heartbeat, then relaunch with resumeFromRunId, keeping waves small or passing the list of proven items in args so reruns skip them; (b) CLAUDE_CODE_RETRY_WATCHDOG=1, which sleeps until the reset with no Remote Control check (binary reading, not executed) but keeps the turn busy; (c) disconnect Remote Control during heavy waves.
2. Bypass mode is not restored on resume. sessions.md L60: a session that ended in bypassPermissions resumes from a terminal in 'The permission mode a new session would start in' (auto is the built-in default when available), and bypass cannot be entered mid-session. The recovery command must be `claude --resume "<name>" --dangerously-skip-permissions`. Remote Control reconnects by itself on resume (remote-control.md L445).
3. A cron can only run skills Claude may invoke on its own. scheduled-tasks.md L43-47: 'A scheduled fire only runs skills that Claude is allowed to invoke on its own.' A skill with disable-model-invocation: true (the /harden style), and any built-in command, arrives as plain text. So a heartbeat prompt '/execution tick' needs /execution to stay model-invocable, or the tick must be written as plain instructions.
4. A backgrounded orchestrator stops between waves. An idle, unattached background session has its process stopped by the supervisor after about an hour unless it is pinned with Ctrl+T (agent-view.md L939), and its cron heartbeat stops with it.
5. Feature-flagged near-limit hints exist in the binary (tengu_lantern_wick_mode, tengu_vellum_anchor, around offset 208.87M; state for this account unknown). Claude Code may inject '[Usage limit approaching. Checkpoint now: finish the current step ... Don't start subagents or long-running work.]' or a 'grace window active' variant. /execution should treat either as a stop-launching signal.
6. A Workflow launch can fail silently. A script that fails its syntax check still returns status async_launched with `error` set and never runs (agent-sdk/typescript.md L4026). Check `error` before recording a wave as launched.
7. Several background completions can be answered in one turn (agent-sdk/typescript.md L1586). The tick must reconcile every finished task from the state file, not only the one that woke it.
8. Workflow agents keep CronCreate, PushNotification, Monitor, RemoteTrigger and SendMessage (executed in this workflow agent). Wave prompts should forbid creating crons or sending pushes, so the orchestrator stays the single heartbeat and notification owner.
9. A SessionStart hook with the 'compact' matcher re-injects its output after compaction (context-window.md L1609). This is sturdier than relying on the 5,000-token skill-body re-injection, which drops the oldest invoked skills entirely once 25,000 tokens are exceeded.
10. Windows automatic time-zone updating is on (tzautoupdate Start = 3). Decide before the trip whether the laptop stays on Paris time or switches to SGT, create the crons afterwards, and store all deadlines in UTC.
11. About 1.2 GB of old or duplicate Claude binaries sit in ~/.local/bin/claude.exe.old.* and ~/.local/share/claude/versions (2.1.282, 2.1.285 and a second copy of 2.1.286). This is a candidate for manual clean-up by the user, given the disk-space gate.
12. The 2.1.286 changelog fixed '`claude --resume` and `--continue` sometimes losing every turn after a batch of parallel tool calls when the earlier session crashed or was killed'. Crash recovery through resume depends on version 2.1.286 or later, so any version freeze must be at or above it.