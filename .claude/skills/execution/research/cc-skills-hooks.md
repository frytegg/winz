# Claude Code skills and hooks as /execution will use them

Research dossier for the /execution designer. Dimension: skill frontmatter, skill-scoped and settings hooks, the Stop
hook, SessionStart/PreCompact/UserPromptSubmit, the Workflow and Skill tools, and permissions for unattended runs.

- Written 2026-09-30 by a research subagent.
- Documentation: raw Markdown pages fetched from `https://code.claude.com/docs/en/<page>.md` at 2026-09-30T18:59Z.
  Line numbers below ("snapshot line N") refer to those snapshots. The `slash-commands` page is byte-identical to
  the `skills` page.
- Installed binary: `C:\Users\Utilisateur\.local\bin\claude.exe`, a Bun-compiled single executable of about 245 MB.
  The bundled JavaScript is readable with `grep -a`.
  - It reported 2.1.285 at the start. It auto-updated to 2.1.286 at 2026-09-30T19:09:21Z, one second into
    experiment R1 (F29).
  - Binary greps were made on 2.1.285, and their key strings were re-confirmed on 2.1.286.
  - R1 ran on 2.1.285; R2 to R10 ran on 2.1.286.
- Experiments: 12 headless runs in a throwaway folder, about USD 1.33 at list prices in total. Every command and
  output is in Appendix A.

## Summary for the designer

1. **Skill hooks: lifetime.** Hooks in /execution's frontmatter register when the skill is invoked. They persist
   across turns and through compaction in that process, but die on `/clear` and on any restart or `--resume`
   (F06, F07).
2. **Skill hooks: gaps.** In a skill, SessionStart, PreCompact and PostCompact never fired (F08). A skill's hooks
   never see tool calls inside subagents or workflow agents, and a skill's SubagentStop never fires (F09).
3. **Settings hooks are the durable layer.** Hooks in `.claude/settings.local.json` reach every agent and survive
   resume and compaction. Written mid-session, they were live on the next turn (F22). Put the Stop gate, the
   SessionStart(compact/resume) re-injection and the PreToolUse guards there, gated by a marker file and by the
   orchestrator's `session_id`.
4. **The Stop gate must let waits through.** Stop fires at the end of every model turn, including the turn that
   launches a background workflow. That workflow then appears in `background_tasks` (F13). Block only when the plan
   is open and nothing is in flight or awaited.
5. **How to block.** Use JSON `{"decision":"block"}`: exit 2 also shows Claude the hook's command line (F11).
   `stop_hook_active` and the 8-block cap (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) apply (F12).
6. **Re-reading state after compaction.** A settings SessionStart hook with matcher `compact` reached the model
   after both manual and automatic compaction (F16). This is the orchestrator's "re-read your state" channel, capped
   at 10,000 characters.
7. **Launching waves.** A skill that tells Claude to call Workflow is an explicit opt-in (F18). Bypass mode shows no
   approval prompt. Workflows take no mid-run input, so each wave is one Workflow call (F19). Only the main thread
   has Workflow, AskUserQuestion and PushNotification (F21).
8. **Calling other skills.** One skill can invoke another through the Skill tool, including `context: fork` skills
   (F20). `disable-model-invocation` refuses that call (F03). /execution can therefore call /hackathon and /prose,
   never /harden.
9. **If /execution is `disable-model-invocation`,** Claude cannot re-invoke it after compaction. Only the first
   5,000 tokens of its body are re-attached (F25).
10. **Paths and permissions.** `${CLAUDE_SKILL_DIR}` works in the SKILL.md body but is empty in hook commands (F05).
    `allowed-tools` and `model` last a single turn (F04), so rely on bypass mode. Deny rules and a PreToolUse
    `deny` still bind in bypass, which gives the mainnet gate (F23).
11. **Pin the version.** Claude Code auto-updated during this session. Set `DISABLE_AUTOUPDATER=1` before the
    flight and re-run the probes on the pinned version (F29).

## Findings

### F01 — Skill frontmatter: every documented field and its meaning

- **Claim:** Claude Code documents 20 SKILL.md fields, all optional.
- **The fields:** `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`,
  `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`,
  `hooks`, `paths`, `shell`, `metadata`, `license`, `compatibility`.
- **Unknown fields:** ignored silently.
- **Evidence:** https://code.claude.com/docs/en/skills (snapshot lines 363-390).
  - "All fields are optional. Only `description` is recommended so Claude knows when to use the skill. A field name
    must match the table exactly, hyphens included: Claude Code ignores a field it doesn't recognize without
    reporting an error."
  - Table rows, verbatim:
    - `name`: "Command name shown in the `/` menu. Defaults to the directory name."
    - `description`: "What the skill does and when to use it. … the combined `description` and `when_to_use` text is
      truncated at 1,536 characters in the skill listing."
    - `argument-hint`: "Hint shown during autocomplete to indicate expected arguments."
    - `arguments`: "Named positional arguments for `$name` substitution in the skill content."
    - `context`: "Set to `fork` to run in a forked subagent context."
    - `agent`: "Which subagent type to use when `context: fork` is set."
    - `background`: "Only applies with `context: fork`. Set to `false` to wait for the forked subagent's result in
      the turn that invoked the skill … Default: `true`."
    - `effort`: "Effort level when this skill is active. Overrides the session effort level."
    - `paths`: "Glob patterns that limit when this skill is activated."
    - `shell`: "Shell to use for `` !`command` `` and ` ```! ` blocks in this skill. Accepts `bash` (default) or
      `powershell`."
    - `metadata`: "Free-form YAML map … Claude Code doesn't act on its contents."
    - `license` and `compatibility`: "Claude Code accepts the field but doesn't act on it."
  - Also: "Boolean fields accept `yes`, `no`, `on`, `off`, `1`, and `0` in any letter case" (snapshot line 367).
  - F03 and F04 cover the rows for `disable-model-invocation`, `user-invocable`, `allowed-tools`,
    `disallowed-tools`, `model` and `hooks`.
- **Confidence:** verified-source.

### F02 — The binary's schema adds internal fields and describes `hooks` more narrowly than the docs

- **Claim:** The 2.1.285/2.1.286 frontmatter schema has further keys marked `@internal`: `version`, `fallback`,
  `created_by`, `improved_by`, and plugin-level keys.
- **`context`:** an enum of `inline` or `fork`.
- **`hooks`:** described as "registered while this skill is active". F06 and F07 show the real lifetime.
- **Evidence:** grep of `claude.exe`, near byte offset 207969973.
  - `version: … describe("@internal — bookkeeping, not surfaced to users")`
  - `hooks: … describe("Hooks registered while this skill is active. Same shape as settings.json `hooks`.")`
  - `context: W(["inline","fork"]) … describe("Where the skill runs: `inline` expands into the current conversation;
    `fork` spawns a subagent.")`
  - `"disable-model-invocation": … describe("If true, the model cannot invoke this via the Skill tool; only users can
    type the slash command.")`
  - `fallback: … describe("@internal — interim defense-in-depth for thin-pointer skill stubs …")`
  - Re-confirmed on 2.1.286 with `grep -a -c -F` (count 2).
- **Confidence:** verified-source.

### F03 — What `disable-model-invocation: true` blocks, and what it does not

- **Claim: it blocks four things.**
  1. Claude's Skill-tool calls to the skill. They are refused with a fixed error that also forbids re-doing the
     skill's steps another way.
  2. The skill's description, which is removed from Claude's context.
  3. Preloading into subagents.
  4. Running as a scheduled task's prompt.
- **Claim: it does not block the user.** Typing `/name` still runs the skill, including as the prompt of `claude -p`.
  All four test skills that set the flag ran from a `-p` prompt (R1, R3, R4, R8).
- **Evidence:**
  - https://code.claude.com/docs/en/skills (snapshot line 376): "Set to `true` to prevent Claude from automatically
    loading this skill. Use for workflows you want to trigger manually with `/name`. Also prevents the skill from
    being preloaded into subagents. As of v2.1.196, also prevents the skill from running when a scheduled task fires
    with the skill as its prompt."
  - Snapshot line 543 (table): "`disable-model-invocation: true` | Yes | No | Description not in context, full skill
    loads when you invoke".
  - Snapshot line 536: "If Claude tries anyway, Claude Code blocks the call and instructs it not to reproduce the
    deploy steps another way".
  - R5 (executed, 2.1.286). A `/caller` skill told Claude to call the Skill tool with `manualonly`. The tool result
    was: `<tool_use_error>Skill manualonly cannot be used with Skill tool due to disable-model-invocation. Ask the user
    to run /manualonly themselves — it cannot be invoked via the Skill tool. Do not replicate this skill's workflow by
    other means — it is reserved for explicit user invocation.</tool_use_error>`.
  - Binary template: `message:`Skill ${s} cannot be used with ${uo} tool due to disable-model-invocation. ${de(s)} Do
    not replicate this skill's workflow by other means — it is reserved for explicit user invocation.``
  - `user-invocable: false` is the mirror image (snapshot line 828): "With `user-invocable: false`, you can't invoke
    the skill, but Claude still can."
- **Confidence:** verified-executed.

### F04 — `allowed-tools`, `disallowed-tools` and `model` last only for the turn that invoked the skill

- **Claim:** Each of these three fields applies to the invoking turn and clears at the next user message. The skill
  content itself stays in context.
- **Evidence:** https://code.claude.com/docs/en/skills
  - Snapshot line 378: "Tools Claude can use without asking permission during the turn that invokes this skill. The
    grant clears when you send your next message."
  - Line 379: "The restriction clears when you send your next message."
  - Line 380: "The override applies for the rest of the current turn and isn't saved to settings. The session model
    resumes when you send your next prompt."
  - Line 562: "It does not restrict which tools are available: every tool remains callable … To pre-approve tools
    for the whole session rather than a single turn, add allow rules to those permission settings instead."
  - Line 564: "Workspace trust doesn't gate this field."
- **Confidence:** verified-source.

### F05 — `${CLAUDE_SKILL_DIR}` works in the skill body but is unavailable in the skill's hook commands

- **Claim: in hook commands it is neither substituted nor exported.** A hook command using `${CLAUDE_SKILL_DIR}`
  failed with an empty path, and no hook saw the variable in its environment.
- **Claim: `CLAUDE_PROJECT_DIR` is exported** to both settings hooks and skill hooks.
- **Claim: the body gets the directory.** It is substituted, and the loaded content is prefixed with "Base
  directory for this skill:".
- **Evidence:**
  - https://code.claude.com/docs/en/skills (snapshot line 450): "Claude Code substitutes `${CLAUDE_SKILL_DIR}` and
    `${CLAUDE_PROJECT_DIR}` in two places: the skill's markdown content, and Bash rules in the `allowed-tools`
    frontmatter." Hooks are not listed.
  - R1 (executed, 2.1.285). Skill PostToolUse hook `node "${CLAUDE_SKILL_DIR}/hooklog.js" …` returned
    `exit_code 1`, stderr `Error: Cannot find module 'C:\hooklog.js'`.
  - In R1 every hook recorded `env_CLAUDE_SKILL_DIR: null` and `env_CLAUDE_PROJECT_DIR:
    "C:/Users/Utilisateur/AppData/Local/Temp/claude/…/cc-experiments/x1"`.
  - R5: the loaded helper skill arrived as "Base directory for this skill:
    C:\Users\Utilisateur\…\x5\.claude\skills\helper\n\nReply with the single word HELPER-LOADED."
  - House precedent: /harden's hook commands already use `D="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/harden}"`
    (`C:/Users/Utilisateur/.claude/skills/harden/SKILL.md:11`). On this machine that works only through the
    fallback.
- **Confidence:** verified-executed.

### F06 — Skill hooks register at invocation and persist across later turns and compaction in the same process

- **Registration:**
  - A skill's hooks register when the skill is invoked.
  - Its UserPromptSubmit hook even fired for the invoking `/probe` prompt itself.
- **Persistence:**
  - They kept firing on later turns of the same process, including after a manual `/compact`.
  - Invoking the skill again did not register a second copy.
- **Evidence:**
  - https://code.claude.com/docs/en/hooks (snapshot line 671): "**Skill hooks**: Claude Code registers them when you
    or Claude invoke the skill and keeps running them for the rest of the session, on turns after the skill's own
    turn as well. To have Claude Code remove a hook after its first successful run instead, set `once: true` on it."
  - The same page (snapshot line 704) lists the source "`Session Hooks`: registered in memory for the current
    session".
  - R1: `{"tag":"skill","event":"UserPromptSubmit",…,"action":"additionalContext"}` fired on the `/probe` prompt, and
    Claude quoted both `UPS-MARKER-settings-4417` and `UPS-MARKER-skill-4417`.
  - R3 (stream-json, 3 messages): the skill's UserPromptSubmit and Stop fired again at 19:12:04 and 19:12:08.
    Compaction had run at 19:11:54-19:12:03.
  - R8: `/dup`, `/dup`, then a plain prompt. Each turn produced exactly one skill UserPromptSubmit and one skill Stop
    entry, so there was no duplicate registration.
- **Confidence:** verified-executed.

### F07 — Skill hooks are dropped by `/clear` and are not restored when a session is resumed in a new process

- **Claim:** After `claude -p --resume <id>` in a new process, none of the skill's hooks fired; only settings hooks
  did. After `/clear` (new session id), the skill's hooks stopped firing too.
- **Evidence:**
  - R2 (`--resume` of R1's session; R1 ran on 2.1.285, R2 on 2.1.286). Only `settings` entries appeared:
    SessionStart `source:"resume"`, UserPromptSubmit, PreToolUse Bash `echo after-resume`, PostToolUse, Stop. There
    was no `skill` entry.
  - R10a/R10b, both on 2.1.286 (removes the version confound). Run A with `/dup` logged skill UserPromptSubmit and
    Stop. Run B (`--resume` of the same session, result `RESUMED`, same sid `4ff1bcc9`) logged nothing from the skill.
  - R8: after `/clear` the session id changed from `beeb617d` to `5b19779c`, and the prompt "Reply with the single
    word AFTERCLEAR." produced no skill hook entry.
- **Confidence:** verified-executed.

### F08 — SessionStart, PreCompact and PostCompact hooks declared in skill frontmatter did not fire

- **Claim:** In R3 the skill declared SessionStart, PreCompact, PostCompact, UserPromptSubmit and Stop hooks.
  - After `/compact`, only the project-settings SessionStart(compact), PreCompact and PostCompact ran.
  - The skill's copies of those three events never started.
  - The same skill's UserPromptSubmit and Stop kept firing after the compaction.
- **Evidence:**
  - R3 hook log:
    `{"tag":"settings","event":"PreCompact","trig":"manual"}`,
    `{"tag":"settings","event":"SessionStart","action":"additionalContext","src":"compact"}`,
    `{"tag":"settings","event":"PostCompact","trig":"manual"}`. No `skill` entry for these events.
  - The stream held exactly one `hook_started` with `"hook_name":"SessionStart:compact"`.
  - The docs do not say that skill hooks exclude these events; the subagent page even says of subagent frontmatter
    that "All hook events are supported".
- **Confidence:** verified-executed. n = 1, `-p` only.

### F09 — Skill hooks do not reach tool calls inside subagents or workflow agents; settings hooks do

- **Claim: skill hooks.**
  - A skill's PreToolUse and PostToolUse did not fire for the Bash calls of an Agent-tool subagent (R1) or of a
    workflow agent (R4).
  - A skill's SubagentStop never fired; its SubagentStart did.
- **Claim: settings hooks.** They fired for all of these. The input carried `agent_id` and `agent_type`, which is
  `general-purpose`, or `workflow-subagent` for workflow agents.
- **Evidence:**
  - R1: subagent `af037ed986d4`.
    - `{"tag":"settings","event":"SubagentStart","agent_type":"general-purpose"}` and
      `{"tag":"skill","event":"SubagentStart",…}`.
    - `{"tag":"settings","event":"PreToolUse","agent_id":"af037ed986d4","cmd":"echo subagent-bash"}`, with no skill
      PreToolUse for it.
    - `{"tag":"settings","event":"SubagentStop",…,"last":"DONE"}`, with no skill SubagentStop.
  - R4: workflow agent `a306b2eb49`.
    - `{"tag":"settings","event":"SubagentStart","agent_type":"workflow-subagent"}` and the skill equivalent.
    - `{"tag":"settings","event":"PreToolUse","agent_type":"workflow-subagent","tool_name":"Bash","cmd":"echo
      from-workflow-agent"}`, with no skill entry.
    - `{"tag":"settings","event":"SubagentStop",…,"last":"WFDONE"}`, with no skill SubagentStop.
  - Docs, https://code.claude.com/docs/en/hooks (snapshot line 267): "Hooks from settings files, managed policy
    settings, and plugins also run inside subagents." Skills are not named.
  - Sub-agents page (snapshot line 730): "Hooks from settings files, managed policy settings, and plugins all apply
    inside subagents, so a `PreToolUse` hook in `settings.json` also runs before every tool a subagent uses."
  - The owner's earlier measurement on 2.1.282
    (`C:/Users/Utilisateur/.claude/skills/harden/research/pilot-auto-calibration.md:376` and `:436`): "a
    `SubagentStop` hook in a skill's frontmatter never fired … a skill's `PreToolUse` hook with matcher `Bash` did not
    fire for a subagent's Bash call".
- **Confidence:** verified-executed.

### F10 — How skill hooks combine with settings hooks

- **Claim:** Matching hooks from all sources run in parallel, and every hook's context output is delivered.
  - Identical handlers are de-duplicated only across settings files.
  - A skill's copy of a handler stays separate.
  - For PreToolUse, the most restrictive decision wins.
- **Evidence:**
  - https://code.claude.com/docs/en/hooks (snapshot line 410): "All matching hooks run in parallel. If you define the
    same handler in more than one settings file, it runs once. A plugin's or skill's copy of the same handler stays
    separate."
  - Hooks guide: "For `PreToolUse` permission decisions, the most restrictive answer applies, in the order `deny`,
    `defer`, `ask`, `allow`. Text from `additionalContext` is kept from every hook and passed to Claude together."
  - R1: both UserPromptSubmit markers, settings and skill, reached Claude.
- **Confidence:** verified-executed.

### F11 — Stop blocking: JSON `decision: "block"` versus exit code 2, and what the model receives

- **Claim: both forms work.** Both keep the turn going. The continuation's Stop input has `stop_hook_active: true`.
- **What Claude receives:**
  - JSON block: a user-side text `Stop hook feedback:\n<reason>`.
  - Exit 2: `Stop hook feedback:\n[<full hook command line>]: <stderr>`. This leaks the hook's command and paths into
    the model's context.
- **The non-error alternative:** `hookSpecificOutput.additionalContext` also continues the turn, labelled "Stop hook
  feedback", with no error notice.
- **Evidence:**
  - https://code.claude.com/docs/en/hooks:
    - Snapshot lines 2609-2613: "`decision` | `"block"` prevents Claude from stopping. Omit to allow Claude to stop |
      `reason` | Required when `decision` is `"block"`. Tells Claude why it should continue … A hook that blocks by
      exiting 2 routes the same way as `reason`: Claude receives the stderr message as the explanation for why it
      should continue."
    - Line 2622: additionalContext "keeps the conversation going through the same loop protections as `decision:
      "block"` … but the transcript labels it `Stop hook feedback` and no hook error notification is shown".
  - R1 (executed). Hook sequence: `block-json` → Claude replied `BRAVO` → `block-exit2` with `stop_hook_active: true`
    → `CHARLIE` → `allow`. Final result `CHARLIE`, `num_turns: 5`.
  - Messages Claude received:
    - `Stop hook feedback:\nSTOP-GATE-1 (json decision): reply with exactly the word BRAVO and nothing else.`
    - `Stop hook feedback:\n[node "C:/Users/Utilisateur/AppData/Local/Temp/claude/…/hooklog.js" "…/x1/hooklog.jsonl"
      skill stopgate]: STOP-GATE-2 (exit code 2): reply with exactly the word CHARLIE and nothing else.`
  - The stream marked the exit-2 run as `"outcome":"error"`.
- **Confidence:** verified-executed.

### F12 — Loop protection: `stop_hook_active` and the consecutive-block cap

- **Claim:** Claude Code overrides a Stop or SubagentStop block after N consecutive continuations.
  - N defaults to 8 and is set by `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`; `0` disables the cap.
  - With N = 2, blocks 1 and 2 were honoured and block 3 was overridden with an informational message.
  - The `-p` result text was then empty.
- **Evidence:**
  - https://code.claude.com/docs/en/hooks (snapshot line 2543): "The `stop_hook_active` field is `true` when Claude
    Code is already continuing as a result of a stop hook. … Claude Code applies an 8-consecutive-continuation cap:
    after stop hooks have continued the turn eight times in a row, Claude Code overrides the next block and ends the
    turn."
  - https://code.claude.com/docs/en/env-vars (snapshot line 377): "`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` | Maximum number
    of consecutive times a Stop or SubagentStop hook may block the turn from ending before Claude Code overrides it
    and ends the turn anyway (default: 8). Set to `0` to disable the cap."
  - R6 (executed, Haiku 4.5, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=2`, always-block hook). Assistant said `START`,
    `AGAIN1`, `AGAIN2`, then a system/informational message: "A hook blocked the turn from ending 3 consecutive times
    — overriding and ending turn. For Stop/SubagentStop hooks, check stop_hook_active in the input and return success
    while it's true. Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit." The result had `"result":""` and
    `num_turns: 4`.
- **Confidence:** verified-executed.

### F13 — Stop fires at the end of every model turn, including one that ends while a workflow still runs

- **Claim: the launch turn.**
  - Stop fired at the end of the turn in which Claude launched a background workflow and replied `LAUNCHED`.
  - Its input had `background_tasks: [{type:"workflow", status:"running", name:"hookprobe", …}]`.
- **Claim: the completion turn.** When the workflow finished, a notification-driven turn ran (`FINISHED`) and Stop
  fired again with `background_tasks: []`.
- **Claim: command turns.** `/compact` and `/clear` turns with no model response fired no Stop hook.
- **Claim: `-p` waits.** `claude -p` stayed open for the background workflow.
- **Evidence:**
  - https://code.claude.com/docs/en/hooks (snapshot line 2547): "The `background_tasks` and `session_crons` arrays
    let hooks distinguish "session is done" from "session is paused waiting for background work to wake it back
    up"."
    - The `type` labels include "`shell`, `subagent`, `monitor`, `workflow`, `teammate`, `cloud session`, or `MCP
      task`".
    - `name` is "Workflow name. Present only for `workflow` tasks".
  - Hooks guide (snapshot line 952): "`Stop` hooks fire whenever Claude finishes responding, not only at task
    completion. They don't fire on user interrupts."
  - https://code.claude.com/docs/en/headless (snapshot line 69): "If Claude starts a background subagent or workflow,
    `claude -p` instead stays open until that work completes".
  - R4 log:
    - `{"ts":"19:13:20","tag":"settings","event":"Stop","sha":false,"bg":[{"type":"workflow","status":"running","name":"hookprobe",…}],"last":"LAUNCHED"}`
    - `{"ts":"19:13:40","tag":"settings","event":"Stop","sha":false,"bg":[],"last":"FINISHED"}`
    - The stream held two `result` messages: `LAUNCHED` (num_turns 2) and `FINISHED` (num_turns 1).
  - R3: no Stop entry for the `/compact` message (its result had `num_turns: 0`).
- **Confidence:** verified-executed.

### F14 — Stop and SubagentStop inputs as observed on 2.1.285/2.1.286

- **Claim: Stop input keys.** `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`,
  `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`.
- **Claim: SubagentStop adds** `agent_id`, `agent_type` and `agent_transcript_path`.
- **Claim: no `stop_reason` field.** A WebFetch summary of the hooks page claimed one; the raw page has none.
- **Scope of `background_tasks`:** on SubagentStop it describes the parent session. The workflow was still listed
  as running when its agent stopped.
- **Evidence:**
  - R1 `input_keys`, verbatim: `["session_id","transcript_path","cwd","prompt_id","permission_mode","effort","hook_event_name","stop_hook_active","last_assistant_message","background_tasks","session_crons"]`
  - SubagentStop keys: `[…,"agent_id","agent_type","effort","hook_event_name","stop_hook_active","agent_transcript_path","last_assistant_message","background_tasks","session_crons"]`
  - Docs (snapshot line 2400): "SubagentStop hooks also receive the `background_tasks` and `session_crons` arrays …
    Both arrays are scoped to the parent session, not the subagent."
- **Confidence:** verified-executed.

### F15 — Hook timeouts and execution rules that bound a Stop gate

- **Timeouts:** 600 s for `command`, `http` and `mcp_tool` handlers; 30 s for `prompt`; 60 s for `agent`.
  UserPromptSubmit's default is 30 s.
- **A timed-out hook** renders no decision.
- **Exit code 1 is not a block.** It is a non-blocking error.
- **`once: true`** is honoured only in skill frontmatter.
- **`asyncRewake`** hooks can wake an idle session on exit 2.
- **Evidence:** https://code.claude.com/docs/en/hooks
  - Snapshot line 424: "Defaults: 600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for `agent`. Claude
    Code lowers the `command`, `http`, and `mcp_tool` default to 30 on `UserPromptSubmit` …"
  - Line 847: "Claude Code cancels a `command`, `http`, or `mcp_tool` hook that reaches its `timeout`, discarding the
    hook's output, so on most events a timed-out hook renders no decision."
  - Line 842: "Claude Code treats exit code 1 as a non-blocking error and proceeds with the action … If your hook is
    meant to enforce a policy, use `exit 2`."
  - Line 426 (`once`): "Only honored for hooks declared in skill frontmatter; ignored in settings files and agent
    frontmatter".
  - Line 455 (`asyncRewake`): "If `true`, runs in the background and wakes Claude on exit code 2."
  - Line 3766: "an `asyncRewake` hook that exits with code 2 wakes Claude immediately even when the session is idle."
- **Confidence:** verified-source.

### F16 — SessionStart(compact) re-injects context after manual and automatic compaction

- **Claim: a settings-level SessionStart hook injects context after compaction.** Its matcher is `compact` (auto or
  manual), and its `additionalContext` reached the model after compaction in both cases.
- **Claim: PreCompact can fire for a compaction that then fails.** The first automatic attempt failed with
  `too_few_groups`: PreCompact fired, but PostCompact and SessionStart did not.
- **Limits:**
  - Output is capped at 10,000 characters; beyond that the model gets a file path and a preview.
  - SessionStart supports only `command` and `mcp_tool` hooks.
  - `mcp_tool` SessionStart hooks are skipped at launch.
- **Evidence:** https://code.claude.com/docs/en/hooks
  - Snapshot line 1115: "`compact` | Auto or manual compaction".
  - Line 1173: "`additionalContext` | String added to Claude's context at the start of the conversation".
  - Line 1106: "Only `type: "command"` and `type: "mcp_tool"` hooks are supported."
  - Line 919: "A hook's `additionalContext`, `systemMessage`, and `initialUserMessage` strings, and its plain
    stdout, are capped at 10,000 characters".
  - Hooks guide section "Re-inject context after compaction" recommends exactly this pattern.
  - R3 (manual `/compact`, Sonnet 5.5): settings SessionStart `src:"compact"` with `action:"additionalContext"`.
    Claude later listed "`COMPACT-MARKER-settings-9921: the orchestrator state file is .execution/state.json.`"
  - R7 (single prompt, Haiku, `--autocompact 100k`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=35`):
    - `{"event":"PreCompact","trig":"auto"}`.
    - Status: `{"status":null,"compact_result":"failed","compact_error":"too_few_groups"}`.
    - No PostCompact, no SessionStart; Claude answered NONE.
  - R7b (4 stream-json turns, same settings):
    - Hook log: `PreCompact auto` (failed) → `PreCompact auto` → `SessionStart src:"compact"
      action:"additionalContext"` → `PostCompact auto`.
    - `compact_boundary` meta `{"trigger":"auto","pre_tokens":75449,"post_tokens":42369,…}`.
    - Final answer: "`COMPACT-MARKER-settings-9921`".
- **Confidence:** verified-executed.

### F17 — UserPromptSubmit can add context and can block, but cannot rewrite the prompt

- **Claim:** Plain stdout or `hookSpecificOutput.additionalContext` from UserPromptSubmit reaches Claude as a system
  reminder. It can block with `decision: "block"` or exit 2. It cannot replace the prompt.
- **Evidence:**
  - https://code.claude.com/docs/en/hooks (snapshot lines 1354-1359): "There are two ways to add context to the
    conversation on exit code 0: Plain text stdout … JSON with `additionalContext` … Neither channel produces a
    visible transcript entry."
  - Line 1045: "`UserPromptSubmit`: can't replace the prompt; it only injects `additionalContext` alongside it".
  - R1 and R3: Claude quoted `UPS-MARKER-settings-4417` and `UPS-MARKER-skill-4417`, injected this way.
- **Confidence:** verified-executed.

### F18 — A skill whose instructions say "call Workflow" is a valid explicit opt-in, and it works

- **Claim: the tool description allows it.** The Workflow tool's description in the binary lists "The user invoked a
  skill or slash command whose instructions tell you to call Workflow" as an explicit opt-in.
- **Claim: it worked.** Typing `/wfprobe` made Sonnet 5.5 call Workflow with the inline script in `-p` mode, with
  `--allowedTools Workflow`. The keyword `ultracode` does not count as an opt-in when it arrives through `-p`.
- **Evidence:**
  - Binary (2.1.285, re-confirmed on 2.1.286), Workflow tool description: "ONLY call this tool when the user has
    explicitly opted into multi-agent orchestration. … Explicit opt-in means one of: - The user included the keyword
    "ultracode" in their prompt … - Ultracode is on for the session … - The user directly asked you to run a
    workflow … in their own words … - The user invoked a skill or slash command whose instructions tell you to call
    Workflow. - The user asked you to run a specific named or saved workflow."
  - R4 stream: `{"tool_use":"Workflow"}` then `"LAUNCHED"` then `"FINISHED"`, with `permission_denials: []`.
  - https://code.claude.com/docs/en/workflows (snapshot line 133): "The keyword is an opt-in only in a prompt you type
    yourself … It doesn't start a workflow when it reaches the session another way: a prompt passed with `-p`".
- **Confidence:** verified-executed.

### F19 — Workflow facts that shape a wave

- **Approval:** none in bypass mode; in `-p` or the SDK the `Workflow` allow rule, auto mode, bypass or a PreToolUse
  `allow`.
- **No mid-run user input.** For sign-off between stages, run each stage as its own workflow.
- **Concurrency:** 16 concurrent agents by default, fewer on machines with fewer CPUs.
- **Tool inputs:** `script`, `name`, `scriptPath` and `args`.
- **Resume:** `resumeFromRunId`, for the same session only.
- **`agent()` options:** `label`, `phase`, `schema`, `model`, `effort`, `isolation:'worktree'` and `agentType`.
- **Evidence:**
  - https://code.claude.com/docs/en/workflows:
    - Snapshot line 183: "| Bypass permissions | Claude Code doesn't prompt you. The run starts immediately |".
    - Line 188: "**Permission rule**: `Workflow` in your allow rules approves every workflow".
    - Line 362: "| No mid-run user input | A run pauses on its own only for agent permission prompts and a usage-limit
      wait. For sign-off between stages, run each stage as its own workflow |".
    - Line 365: "Up to 16 concurrent agents by default, fewer when Claude Code has fewer CPUs available … set
      `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`".
  - Binary Workflow input descriptions:
    - `resumeFromRunId`: "Run ID of a prior Workflow invocation to resume from. Completed agent() calls with unchanged
      (prompt, opts) return their cached results instantly; only edited or new calls re-run. Same-session only."
    - `scriptPath`: "Every Workflow invocation persists its script under the session directory and returns the path
      in the tool result."
    - `agent(prompt, opts?: {label, phase, schema, model, effort, isolation, agentType})` "opts.agentType uses a
      custom subagent type … resolved from the same registry as the Agent tool".
- **Confidence:** verified-source.

### F20 — One skill can invoke another through the Skill tool, including a `context: fork` skill

- **Plain skills:** a skill that tells Claude to call the Skill tool loads the other skill's content into the
  conversation.
- **Forked skills:** a `context: fork` skill runs as a subagent and returns its result.
- **Refusals:** a `disable-model-invocation` skill is refused (F03).
- **The owner's skills:** /hackathon and /prose set no `disable-model-invocation`, so /execution can call them.
  /harden sets it, so only the user can run /harden.
- **Evidence:**
  - R5 (Sonnet 5.5, `--allowedTools "Bash(echo *)" Skill`):
    - `Skill(helper)` returned `Launching skill: helper`, then the content with "Base directory for this skill: …";
      Claude replied `HELPER-LOADED`.
    - `Skill(forker)` ran `echo from-forked-skill` and returned `Skill "forker" completed (forked
      execution).\n\nResult:\nFORKDONE`.
  - Frontmatter reads:
    - `C:/Users/Utilisateur/.claude/skills/hackathon/SKILL.md`: name and description only.
    - `C:/Users/Utilisateur/.claude/skills/prose/SKILL.md`: `argument-hint` and no invocation flag.
    - `C:/Users/Utilisateur/.claude/skills/harden/SKILL.md:5`: `disable-model-invocation: true`.
  - https://code.claude.com/docs/en/skills (snapshot line 731): forked skills are waited for "In non-interactive mode,
    with the `-p` flag or the Agent SDK". Interactively they run in the background by default.
- **Confidence:** verified-executed.

### F21 — Only the main thread can ask the user, launch workflows or push to the phone

- **Claim: every subagent loses** `AskUserQuestion`, `Workflow`, `EnterPlanMode`, `ScheduleWakeup` and others.
- **Claim: background subagents keep** `Skill`, `Bash`, `Edit`, `Write` and every MCP tool, for example the Notion
  connector. `PushNotification` is not in their list.
- **Evidence:** https://code.claude.com/docs/en/sub-agents
  - Snapshot lines 424-433: "The first filter removes these tools, even when listed in the `tools` field: … `AskUserQuestion` …
    `ScheduleWakeup` … `Workflow`".
  - Line 435: "a background subagent keeps every MCP tool but only these built-in tools: `Read`, `Grep`, `Glob`,
    `LSP`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`,
    `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage`, and `Artifact`".
  - https://code.claude.com/docs/en/tools-reference (snapshot line 42): `PushNotification` "Sends a desktop
    notification, and a phone push when Remote Control is connected".
- **Confidence:** verified-source.

### F22 — Settings-file hooks written mid-session go live on the next turn and survive resume and compaction

- **Claim:** The test wrote `.claude/settings.local.json` with PreToolUse and Stop hooks between turn 1 and turn 2 of
  one `-p` stream-json session. Both hooks fired in turn 2 without a restart.
- **Claim:** Settings hooks kept firing after `--resume` (R2) and after manual and automatic compaction (R3, R7b).
- **Evidence:**
  - R9 driver output: `result #1: "ONE"`, `installed hooks at 2026-09-30T19:20:20.291Z`, `result #2: "TWO"`.
  - R9 hook log: `{"tag":"localsettings","event":"PreToolUse","cmd":"echo after-install ."}` and
    `{"tag":"localsettings","event":"Stop","last":"TWO"}`.
  - https://code.claude.com/docs/en/hooks: "Direct edits to hooks in settings files are normally picked up
    automatically by the file watcher."
- **Confidence:** verified-executed.

### F23 — What still stops an unattended run in bypassPermissions mode

- **Claim: bypass skips every permission prompt except "actions no mode auto-approves":**
  - explicit `ask` rules;
  - connector tools the organization set to `ask`;
  - `AskUserQuestion` and MCP tools marked `requiresUserInteraction`;
  - critical-path `rm`/`rmdir` (a two-minute terminal countdown, then denial);
  - the cross-session messaging safeguards;
  - reads outside the working directories when `blockReadsOutsideWorkingDirectories` is on.
- **Claim: some things still hold in bypass.** Deny rules and a PreToolUse hook's `deny`. `Remove-Item` on system
  paths or wildcard targets is denied in every mode.
- **Claim: bypass propagates.** Subagents and workflow agents inherit bypass, and workflows start without a prompt.
- **Evidence:**
  - https://code.claude.com/docs/en/permission-modes:
    - Snapshot line 30: "Deny rules block in every mode, including `bypassPermissions`. … Allow rules have no effect
      in `bypassPermissions`."
    - Line 36: "Claude Code doesn't auto-approve the following in any mode, including `bypassPermissions`".
    - Line 720: "In `auto` and `bypassPermissions` modes, the terminal prompt for a critical-path removal shows a
      two-minute countdown … If the countdown runs out before you answer, Claude Code denies the command … so an
      unattended session keeps working."
    - Line 734: "**System paths** … Claude Code denies the command in every mode, without asking you."
    - Line 587: "In non-interactive mode no dialog is shown".
  - Hooks guide (snapshot line 967): "A hook that returns `permissionDecision: "deny"` blocks the tool even in
    `bypassPermissions` mode or with `--dangerously-skip-permissions`."
  - https://code.claude.com/docs/en/sub-agents (snapshot line 570): "When the main conversation is in
    `bypassPermissions`, `acceptEdits`, or auto mode, the subagent runs in that same mode and Claude Code ignores the
    `permissionMode` you set."
  - AskUserQuestion (tools reference, snapshot line 133): "Questions stay open until you answer them" unless
    `askUserQuestionTimeout` is set.
- **Confidence:** verified-source.

### F24 — Allowlists versus bypass; trust and setting sources

- **Rule order:** deny, then ask, then allow; the first match wins.
- **Trust:** project `permissions.allow` rules apply only after the interactive workspace trust dialog. In `-p` in a
  never-trusted folder they are not used.
- **Hooks and trust:** settings-file hooks run in interactive sessions only after trust. In `-p` they run without it.
  A project skill's hooks also run in `-p` without trust.
- **Setting sources (observed):** `--setting-sources project,local` also removed the user's personal skills
  (`~/.claude/skills`) from the session.
- **Evidence:**
  - https://code.claude.com/docs/en/permissions:
    - "Rules are evaluated in order: deny, then ask, then allow."
    - Snapshot line 660: "`permissions.allow` rules and `permissions.additionalDirectories` entries in a project's
      `.claude/settings.json` grant capability, so Claude Code applies them only after you accept the workspace trust
      dialog".
    - Line 694 table: "`permissions.allow` rules … | Not used … Not used. Claude Code prints a `this workspace has not
      been trusted` warning".
    - Same table: hooks "and a project skill's hooks and `allowed-tools` | Used | Used".
  - https://code.claude.com/docs/en/hooks (snapshot line 3779): "Interactive session: Claude Code holds back hooks
    from every settings file, including your own `~/.claude/settings.json`, until you accept the workspace trust
    dialog".
  - R4 init under `--setting-sources project,local`: skills were `["wfprobe","deep-research",…,"plugin-authoring"]`.
    There was no hackathon, harden or prose.
- **Confidence:** verified-executed.

### F25 — Skill content lifecycle after compaction: the first 5,000 tokens only

- **In context:** the rendered skill enters context once and is never re-read from disk.
- **After compaction:** only the most recent invocation of each skill is re-attached, and only its first 5,000
  tokens. All re-attached skills share a 25,000-token budget.
- **Evidence:** https://code.claude.com/docs/en/skills
  - Snapshot line 552: "Claude Code does not re-read the skill file on later turns".
  - Line 556: "Claude Code re-attaches the most recent invocation of each skill after the summary, keeping the first
    5,000 tokens of each. Re-attached skills share a combined budget of 25,000 tokens."
  - R3: after `/compact` the model answered "**YES.** I can still see the probe3 skill's instruction text". That
    skill is tiny.
  - For scale: `/harden`'s SKILL.md is 46,556 bytes, far above 5,000 tokens.
- **Confidence:** verified-source.

### F26 — `/goal` is a built-in session-scoped Stop loop with a small-model judge

- **Claim:** `/goal` wraps a session-scoped prompt-based Stop hook.
  - It is judged by the small fast model, which only reads the transcript.
  - It defers evaluation while background work runs.
  - It is restored on resume.
  - It cannot run commands, so it cannot enforce mechanical proofs.
- **Evidence:** https://code.claude.com/docs/en/goal
  - Snapshot line 120: "`/goal` is a wrapper around a session-scoped prompt-based Stop hook."
  - Line 152: "If a subagent or a background shell command is still running when a turn ends, Claude Code skips the
    evaluation for that turn."
  - Line 102: "When you resume a session, Claude Code restores a goal that was still active".
  - "It doesn't run commands or read files independently".
- **Confidence:** verified-source.

### F27 — Remote Control: a window into the same local process

- **Same process:** Remote Control shows the same local process, so skill hooks stay registered while the process
  lives.
- **Stopped process:** a stopped process comes back only by resuming the session, which drops skill hooks (F07).
- **Forwarded prompts:** permission prompts and AskUserQuestion are forwarded and stay open.
- **Skills:** user skills are advertised to Remote Control clients.
- **Evidence:**
  - https://code.claude.com/docs/en/remote-control:
    - Snapshot line 18: "The web and mobile interfaces are a window into that local session, so your computer has to
      stay on and the `claude` process has to keep running."
    - Line 336: "If you close the terminal … or otherwise stop the `claude` process, the session goes offline until
      you bring it back."
    - Resume section: "resume the conversation with `claude --continue` or `claude --resume`".
    - Line 343: "Claude Code keeps permission prompts and `AskUserQuestion` questions open until you answer them."
  - https://code.claude.com/docs/en/skills (snapshot line 846): "`"off"` also hides the skill from the command
    lists advertised to Remote Control clients".
- **Confidence:** verified-source.

### F28 — TaskCreate and TaskUpdate are absent by default on Opus and Sonnet 5.x

- **Claim:** A TaskCompleted gate needs an opt-in on the owner's models. Built-in task tools exist by default only on
  older models; the Sonnet 5.5 test session had none, the Haiku 4.5 session had all four.
- **Evidence:**
  - https://code.claude.com/docs/en/tools-reference (snapshot line 540): "The task-tracking tools … are available by
    default only on Claude 3.x models, Opus 4 through 4.7, Sonnet 4 through 4.6, and Haiku 4.5."
  - Opt-in: `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.
  - R4 init tools (claude-sonnet-5-5) had no TaskCreate. R6 init (claude-haiku-4-5) listed "TaskCreate, TaskGet,
    TaskList, TaskStop, TaskUpdate".
  - TaskCompleted docs: "Exit code 2: the task is not marked as completed and the stderr message is fed back to the
    model as feedback."
- **Confidence:** verified-executed.

### F29 — Claude Code auto-updated mid-session

- **What happened:** Claude Code auto-updated from 2.1.285 to 2.1.286 at 2026-09-30T19:09:21Z. Processes launched
  afterwards ran 2.1.286.
- **How to freeze it:** `DISABLE_AUTOUPDATER=1` stops background updates.
- **Evidence:**
  - `ls -la --time-style=full-iso ~/.local/bin` showed `claude.exe` (245092000 bytes) dated
    `2026-09-30 21:09:21.047 +0200` and `claude.exe.old.1790795388616.13108` dated `2026-09-30 11:22:40`.
  - `claude --version` reported `2.1.286 (Claude Code)`.
  - Per-run `claude_code_version`: r1 2.1.285, r2 to r10 2.1.286.
  - https://code.claude.com/docs/en/env-vars (snapshot line 420): "`DISABLE_AUTOUPDATER` | Set to `1` to disable
    automatic background updates. Manual `claude update` still works. Use `DISABLE_UPDATES` to block both".
- **Confidence:** verified-executed.

### F30 — Windows specifics for hook commands

- **Shell:** shell-form hooks run in Git Bash on Windows. On this machine their JSON stdout parsed correctly, so no
  profile noise was prepended.
- **Exec form** needs a real `.exe`, such as `node`.
- **PowerShell:** a bare `$CLAUDE_PROJECT_DIR` resolves to `$null`.
- **Evidence:**
  - https://code.claude.com/docs/en/hooks: "The `command` string is passed to a shell: `sh -c` on macOS and Linux,
    Git Bash on Windows, or PowerShell when Git Bash isn't installed."
  - Also: "On Windows, exec form requires `command` to resolve to a real executable such as a `.exe`."
  - Also: "Don't write the bare `$CLAUDE_PROJECT_DIR` spelling in a PowerShell hook."
  - R1: JSON outputs (`decision:block`, `additionalContext`) from `node` via Git Bash were honoured.
- **Confidence:** verified-executed.

## Implications for /execution

1. **Two layers of hooks, settings first.**
   - Install the hooks the run depends on into the project's `.claude/settings.local.json` at run start: the Stop
     gate, SessionStart re-injection and PreToolUse guards. Remove them at hand-over.
   - Reasons: they reach workflow agents and subagents (F09), survive `--resume` and compaction (F22), and go live
     without a restart (F22).
   - Frontmatter hooks alone would vanish on `/clear` or a restart (F07). Their SessionStart and PreCompact never
     fire (F08), and they cannot see agent tool calls (F09).
   - Frontmatter hooks can still carry a cheap "canary" or duplicate of the Stop gate. The canary proves at start
     that the settings hooks are live, as /harden does.
2. **Gate every hook three ways.**
   - A marker file, for example `.execution/active`. This is the /harden house style: skill hooks otherwise persist
     for the whole process (F06).
   - The orchestrator's `session_id`, recorded in the state file at start. Settings hooks fire in every session in
     that repository, including a second terminal or dev B's session.
   - Exit 0 on any mismatch. Keep the command cheap: settings hooks fire for every tool call of every agent (F09).
3. **Stop gate logic.** It must let legitimate waits through (F13).
   - Allow when `background_tasks` has a running `workflow` or `subagent`. The session is then paused for a
     notification, which is what /goal does too (F26).
   - Allow when the state file records an awaited manual task or user decision. This is user decision 2: propose and
     wait.
   - Allow when the completion check exits 0.
   - Otherwise block with JSON `{"decision":"block","reason":"<open items; next wave; or record the wait>"}`, never
     exit 2 (F11).
   - Keep a consecutive-block counter in the state file. After K blocks, record `awaiting: stuck`, allow the stop
     and let Claude push a phone notification. Otherwise the default cap of 8 overrides silently (F12).
   - Stay well under the 600 s timeout (F15). The expensive proofs run in workflow agents, not in the hook.
4. **Compaction and resume.**
   - Use a settings SessionStart hook with matcher `compact|resume|startup|clear`.
   - When the marker is active and the session matches, print at most about 2,000 characters (limit 10,000; F16):
     where the state file is, the current wave, the open items, and which SKILL.md sections or references to Read
     again.
   - If /execution keeps `disable-model-invocation: true`, Claude cannot re-invoke it (F03). Only the first 5,000
     tokens of its body survive compaction (F25). Put the standing loop rules in the first 5,000 tokens and keep the
     procedures in reference files the hook points to.
5. **Waves as Workflow calls.**
   - The SKILL.md text should say explicitly that the skill tells Claude to call the Workflow tool (F18).
   - One Workflow call per wave: workflows take no mid-run input (F19).
   - The orchestrator ends its turn after launching. The completion notification starts the next turn, where Claude
     verifies proofs, updates Notion and state, and launches the next wave.
   - Stages that need the developer become separate workflows.
   - Set `model`/`effort` per `agent()` call, not in frontmatter (F04, F19).
   - Keep the 16-agent default concurrency; the machine has 16 logical CPUs.
6. **Proof checked by another agent.** Do it inside the workflow script, with a writer agent and then a verifier
   agent (with `schema`). Or capture each agent's final report with a settings SubagentStop hook, which reaches
   workflow agents; the skill-level one does not (F09).
7. **The mainnet gate.**
   - Before the owner funds and configures the wallet, enforce "no mainnet transactions" with a settings PreToolUse
     hook or `permissions.deny` rules. Both bind in bypass mode and inside workflow agents (F09, F23).
   - Open the gate on an owner-created flag file.
   - Command-text matching is best-effort, so also keep mainnet keys out of the environment until the owner sets
     them up.
8. **Manual tasks.**
   - Only the main thread can call `AskUserQuestion` and `PushNotification` (F21).
   - For a manual task: record `awaiting`, send a push (Remote Control connected), end the turn, and keep unrelated
     waves running in the background. The Stop gate allows the stop.
   - AskUserQuestion also works through Remote Control and stays open (F27). Leave `askUserQuestionTimeout` unset so
     the tool waits.
9. **Other skills.**
   - /execution can call /hackathon and /prose through the Skill tool (F20), for example the sprint-time
     /hackathon activities of user decision 1.
   - /harden must stay user-invoked.
   - Give a future /frontend `disable-model-invocation: false` if /execution should call it. `context: fork` makes
     it a self-contained subagent pass (F20).
10. **Paths and permissions in the skill.**
    - In SKILL.md use `${CLAUDE_SKILL_DIR}`.
    - In hook commands use `$HOME/.claude/skills/execution/...` or absolute paths. `${CLAUDE_SKILL_DIR}` is empty
      there (F05).
    - Do not rely on `allowed-tools` for multi-turn runs (F04). The owner's bypass session covers it; dev B needs the
      same mode or trusted project allow rules (F24).
11. **Hygiene.**
    - Make sure `.claude/settings.local.json` and `.execution/` runtime files are git-ignored before the first
      commit. The standing push authorisation would otherwise publish machine-specific hook paths.
    - A tracked `settings.local.json` is also treated as repository-supplied and held until trust (F24).
    - Writing `.claude/` is a protected path, auto-approved only in bypass (F23).
12. **Rehearsal.**
    - Pin Claude Code (`DISABLE_AUTOUPDATER=1`) before 4 Oct.
    - Re-run R1, R3, R4, R7b and R9 on the pinned version, interactively once as well: every probe here ran in `-p`
      (F29).

## Risks and failure modes

- **Silent loss of a skill-hook gate.** A crash, a restart and `--resume`, or a `/clear` removes frontmatter hooks
  with no notice (F07). The orchestrator could then end "done" with nobody enforcing the plan. Mitigations:
  settings-file hooks, and a canary at each wave start.
- **A Stop gate that blocks the wrong thing.**
  - Blocking while a workflow runs forces Claude to poll or improvise.
  - Blocking while a manual task is awaited violates "stop only for manual tasks".
  - Blocking other sessions in the repository, if the gate is keyed only on a marker file.
  - Blocking dev B's session, if the hooks are committed.
- **Cap override:** the eighth consecutive block is overridden. In `-p` the final result is then empty (F12), which
  can read as success to a wrapper script.
- **Exit-2 leakage:** exit-2 Stop blocks show Claude the hook command line and are labelled as errors (F11).
- **Compaction state:** PreCompact can fire for a compaction that then fails (`too_few_groups`, F16). A hook that
  assumes compaction happened and resets state would be wrong. Only SessionStart(compact) and PostCompact confirm
  success.
- **Oversize re-injection:** SessionStart output above 10,000 characters is replaced by a file path and preview, and
  Claude is not told to read the file (F16).
- **Model-dependent opt-in:** skill-driven Workflow calls depend on the model honouring the instruction. They were
  tested with Sonnet 5.5 in `-p` only, not with Opus 5.5 interactive (F18).
- **Workflow resumability:** `resumeFromRunId` works within the same session only. A fresh session restarts a wave
  from scratch (F19).
- **Version drift:** Claude Code updated itself during this research (F29). Hook semantics documented as changing
  across versions, for example trust rules before v2.1.218, could shift between rehearsal and the event.
- **Disk:** the C: drive had 3.8 GB free at 19:05Z today, down from the 6.9 GB the brief reported earlier. Workflow
  transcripts, worktree isolation (`isolation: 'worktree'`) and parallel installs can fill it mid-hackathon.
- **Unverified doc summaries:** WebFetch summaries of the docs invented details. One was a `stop_reason` Stop input
  field that does not exist (F14). Designers should quote the raw `.md` pages or the binary, as this dossier does.

## Open questions

1. Do skill-frontmatter SessionStart, PreCompact and PostCompact hooks also stay silent in an interactive session?
   Do skill hooks still miss subagent tool calls there? All probes here ran in `-p` (F08, F09).
2. Does switching conversations with `/resume` inside a running interactive process drop skill hooks, as `/clear`
   does? Only the new-process case is measured (F07).
3. Does UserPromptSubmit fire for turns started by a task notification (a workflow completing)? R4 did not measure
   it.
4. Does the 8-block cap counter reset when a notification-driven turn starts? The cap was measured within one turn
   only (F12).
5. Can a `/execution` typed from the Claude mobile app over Remote Control expand a user skill exactly like the
   terminal? The docs imply skills are advertised to Remote Control clients (F27); this was not tested.
6. Does a settings SubagentStop `decision: "block"` keep a workflow agent running, as documented for Agent-tool
   subagents? Not tested.
7. Is `/goal` reachable by Claude through the Skill tool, so /execution could set one? The docs name only `/init`
   and `/security-review` among built-ins available to the Skill tool.
8. Could an `asyncRewake` hook (for example a watcher that exits 2 when the developer drops a manual-task report
   file) wake the orchestrator reliably while idle (F15)? Not tested.
9. Will Opus 5.5 in an interactive bypass session call Workflow from skill instructions as reliably as Sonnet 5.5
   did in `-p`?

## Sources

Official documentation (raw Markdown, fetched 2026-09-30T18:59Z):

- https://code.claude.com/docs/en/skills.md — `slash-commands.md` is identical.
- https://code.claude.com/docs/en/hooks.md
- https://code.claude.com/docs/en/hooks-guide.md
- https://code.claude.com/docs/en/sub-agents.md
- https://code.claude.com/docs/en/settings.md
- https://code.claude.com/docs/en/settings-reference.md
- https://code.claude.com/docs/en/permissions.md
- https://code.claude.com/docs/en/permission-modes.md
- https://code.claude.com/docs/en/workflows.md
- https://code.claude.com/docs/en/headless.md
- https://code.claude.com/docs/en/cli-reference.md
- https://code.claude.com/docs/en/env-vars.md
- https://code.claude.com/docs/en/tools-reference.md
- https://code.claude.com/docs/en/goal.md
- https://code.claude.com/docs/en/remote-control.md
- https://code.claude.com/docs/en/model-config.md
- https://code.claude.com/docs/en/commands.md
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode.md

Installed product:

- `C:\Users\Utilisateur\.local\bin\claude.exe` — 2.1.285, auto-updated to 2.1.286 during the session.
  - Grep offsets: Workflow tool description near byte 229670577 (2.1.285); frontmatter schema near byte 207969973
    (2.1.285).
  - The key strings were re-confirmed with `grep -a -c -F` on 2.1.286.
- `claude --help` (2.1.285) — flags `--setting-sources`, `--strict-mcp-config`, `--include-hook-events`,
  `--input-format stream-json`, `--permission-prompts`, `--autocompact`.

Owner's prior art (read only):

- `C:/Users/Utilisateur/.claude/skills/harden/SKILL.md` — hooks in frontmatter, marker gating, `CLAUDE_SKILL_DIR`
  fallback.
- `C:/Users/Utilisateur/.claude/skills/harden/research/pilot-auto-calibration.md:371-445` — findings A01-F42 and
  A01-F45, measured on 2.1.282.
- `C:/Users/Utilisateur/.claude/skills/harden/research/skill-design.md:153-171` — marker gating and the 8-block cap.
- `C:/Users/Utilisateur/.claude/skills/hackathon/SKILL.md` and `C:/Users/Utilisateur/.claude/skills/prose/SKILL.md`
  — frontmatter only.

Experiments:

- Folder: `C:/Users/Utilisateur/AppData/Local/Temp/claude/C--Users-Utilisateur-Documents/1b81010d-85f5-4bc4-9aad-c09f0606fc88/scratchpad/cc-experiments/`
  - It holds `hooklog.js`, `run.sh`, `x1` to `x10`, and the raw doc snapshots in `docs/`.
  - Each run's stream is in `x*/r*.stream.jsonl`; each hook log is `x*/hooklog.jsonl`.

## Appendix A — Experiment record (commands and outputs)

### Environment and harness

The launcher `cc-experiments/run.sh` implements the recipe from the brief:

```bash
unset CLAUDECODE CLAUDE_EFFORT CLAUDE_PID
for v in $(env | cut -d= -f1 | grep '^CLAUDE_CODE_'); do unset "$v"; done
export MSYS_NO_PATHCONV=1 CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
if [ -n "${XENV:-}" ]; then export $XENV; fi     # one-off extra variable for R6/R7
cd "$1"; …; timeout 540 /c/Users/Utilisateur/.local/bin/claude.exe -p "$@" > "$out.stream.jsonl" 2> "$out.stderr.txt"
```

- The prompt was sent on stdin in every run.
- Every run used `--setting-sources project,local`, so the owner's user-level hooks (sound and toast) never ran.
- Every run used `--strict-mcp-config`, so no Notion, Gmail or other connector was loaded.
- The tool allowlists were minimal (`--allowedTools …`).
- The experiment folder is not a git repository.

`cc-experiments/hooklog.js` (Node) appends one JSON line per hook call with the event, tag, agent id and type, tool,
`stop_hook_active`, `background_tasks`, `source`, `trigger`, the `CLAUDE_SKILL_DIR`/`CLAUDE_PROJECT_DIR` environment
and the input keys. Its modes:

- `log`: record only.
- `stopgate`: first call blocks by JSON (reply BRAVO), second by exit 2 (reply CHARLIE), then allow.
- `alwaysblock`: block every call.
- `ups`: return `additionalContext` `UPS-MARKER-<tag>-4417`.
- `compactctx`: on `source=="compact"`, return `additionalContext` `COMPACT-MARKER-<tag>-9921`.

Self-test output:

```
{"tag":"selftest","event":"Stop","gate_count_before":0,"action":"block-json"}
{"tag":"selftest","event":"Stop","gate_count_before":1,"action":"block-exit2"}   (rc=2)
{"tag":"selftest","event":"Stop","gate_count_before":2,"action":"allow"}
```

### R1 — skill hooks vs settings hooks, foreground subagent, Stop gate, UserPromptSubmit (2.1.285, Sonnet 5.5)

**Setup:**

- `x1/.claude/settings.json`, tag `settings`: SessionStart, UserPromptSubmit(ups), PreToolUse(Bash), PostToolUse,
  SubagentStart, SubagentStop and Stop, all logging.
- `x1/.claude/skills/probe/SKILL.md` (`disable-model-invocation: true`), tag `skill`: UserPromptSubmit(ups),
  PreToolUse(Bash), PostToolUse, a second PostToolUse using `${CLAUDE_SKILL_DIR}`, SubagentStart, SubagentStop and
  Stop(stopgate).
- The skill body runs `echo main-thread-bash`, spawns a foreground general-purpose subagent that runs
  `echo subagent-bash`, quotes the UPS markers and ends with ALPHA.

**Command:**

```
echo "/probe" | run.sh x1 r1 --session-id 4b424156-0d9e-4088-aae7-75f3823bc37d --model sonnet --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose --include-hook-events --allowedTools "Bash(echo *)" Agent
```

**Output:**

```
start=2026-09-30T19:09:20Z end=2026-09-30T19:09:52Z exit=0
settings SessionStart src=startup | settings UPS (additionalContext) | skill UPS (additionalContext)
settings+skill PreToolUse Bash "echo main-thread-bash" | skill+settings PostToolUse Bash
settings+skill SubagentStart agent_id=af037ed986d4 agent_type=general-purpose
settings PreToolUse  Bash agent_id=af037ed986d4 "echo subagent-bash"   (no skill entry)
settings PostToolUse Bash agent_id=af037ed986d4                          (no skill entry)
settings SubagentStop agent_id=af037ed986d4 sha=false last="DONE"        (no skill entry)
settings+skill PostToolUse Agent
settings Stop sha=false | skill Stop sha=false action=block-json
skill Stop sha=true action=block-exit2 last="BRAVO" | settings Stop sha=true
skill Stop sha=true action=allow last="CHARLIE" | settings Stop sha=true
hook_response PostToolUse (skilldirvar): exit_code 1, stderr "Error: Cannot find module 'C:\hooklog.js'"
assistant: "Markers found in my context: - `UPS-MARKER-settings-4417 …` - `UPS-MARKER-skill-4417 …` The subagent returned DONE. ALPHA" / "BRAVO" / "CHARLIE"
user (hook feedback): "Stop hook feedback:\nSTOP-GATE-1 (json decision): reply with exactly the word BRAVO and nothing else."
user (hook feedback): "Stop hook feedback:\n[node \"…/hooklog.js\" \"…/x1/hooklog.jsonl\" skill stopgate]: STOP-GATE-2 (exit code 2): reply with exactly the word CHARLIE and nothing else."
result: {"subtype":"success","num_turns":5,"duration_ms":28102,"total_cost_usd":0.18,"result":"CHARLIE","permission_denials":[]}
env in every hook: env_CLAUDE_SKILL_DIR=null, env_CLAUDE_PROJECT_DIR="C:/Users/Utilisateur/AppData/Local/Temp/claude/…/cc-experiments/x1"
```

### R2 — resume the R1 session in a new process (2.1.286, Sonnet 5.5)

**Command:**

```
echo "Run this exact Bash command: echo after-resume . Then reply with the single word DELTA." | run.sh x1 r2 --resume 4b424156-0d9e-4088-aae7-75f3823bc37d --model sonnet --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose --include-hook-events --allowedTools "Bash(echo *)" Agent
```

**Output:** only `settings` entries appeared.

```
start=2026-09-30T19:10:43Z end=2026-09-30T19:11:00Z exit=0
settings SessionStart src=resume | settings UserPromptSubmit | settings PreToolUse Bash "echo after-resume" | settings PostToolUse | settings Stop sha=false
result: {"subtype":"success","num_turns":2,"result":"DELTA","session_id":"4b424156-0d9e-4088-aae7-75f3823bc37d"}
```

### R3 — three turns in one process with a manual `/compact` (2.1.286, Sonnet 5.5)

**Setup:**

- `x3/.claude/settings.json`: SessionStart(compactctx), PreCompact, PostCompact, UserPromptSubmit and Stop.
- Skill `probe3`: the same events, with UPS(ups) and SessionStart(compactctx).

**Input** (`r3.input.jsonl`), three messages: `/probe3`, `/compact`, and "List every string in your context that
begins with COMPACT-MARKER or UPS-MARKER … can you still see the instruction text of the probe3 skill?"

**Command:**

```
cat r3.input.jsonl | run.sh x3 r3 --model sonnet --setting-sources project,local --strict-mcp-config --input-format stream-json --output-format stream-json --verbose --include-hook-events
```

**Output:**

```
start=2026-09-30T19:11:50Z end=2026-09-30T19:12:09Z exit=0
19:11:52 settings SessionStart startup | settings UPS "/probe3" | skill UPS "/probe3" (additionalContext)
19:11:54 settings Stop | skill Stop
19:11:54 settings PreCompact trig=manual
19:12:02 settings SessionStart src=compact action=additionalContext
19:12:03 settings PostCompact trig=manual
19:12:04 settings UPS | skill UPS (additionalContext)          <- skill hooks survived the compaction
19:12:08 skill Stop | settings Stop
(no skill SessionStart / PreCompact / PostCompact entry; stream shows one hook_started "SessionStart:compact")
assistant: "READY" / "…1. `COMPACT-MARKER-settings-9921: the orchestrator state file is .execution/state.json.` 2. `UPS-MARKER-skill-4417 is the probe value for this prompt.` … **YES.** I can still see the probe3 skill's instruction text"
results: READY (num_turns 1) / "" (num_turns 0, the /compact turn) / markers answer (num_turns 1)
```

### R4 — a skill instructs Claude to call Workflow; hooks and background_tasks (2.1.286, Sonnet 5.5)

**Setup:**

- `x4/.claude/settings.json`: PreToolUse, PostToolUse, SubagentStart, SubagentStop and Stop, all logging.
- Skill `wfprobe`: the same events.
- The skill body gives an inline script: `export const meta = { name: 'hookprobe', … }` then one `agent('Run this
  exact Bash command: echo from-workflow-agent . Then reply with the single word WFDONE.', …)`. It tells Claude to
  end the turn with LAUNCHED and to reply FINISHED on the notification.

**Command:**

```
echo "/wfprobe" | run.sh x4 r4 --model sonnet --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose --include-hook-events --allowedTools "Bash(echo *)" Workflow
```

**Output:**

```
start=2026-09-30T19:13:12Z end=2026-09-30T19:13:40Z exit=0
19:13:18 settings+skill PreToolUse Workflow | settings+skill PostToolUse Workflow
19:13:18 settings+skill SubagentStart agent_id=a306b2eb49 agent_type=workflow-subagent
19:13:20 settings+skill Stop sha=false bg=[{"type":"workflow","status":"running","name":"hookprobe",…}] last="LAUNCHED"
19:13:21 settings PreToolUse agent_type=workflow-subagent Bash "echo from-workflow-agent"   (no skill entry)
19:13:36 settings PostToolUse agent_type=workflow-subagent Bash                           (no skill entry)
19:13:38 settings SubagentStop agent_type=workflow-subagent last="WFDONE" bg=[workflow running]   (no skill entry)
19:13:40 settings+skill Stop sha=false bg=[] last="FINISHED"
assistant: {"tool_use":"Workflow"} / "LAUNCHED" / "FINISHED"
results: {"num_turns":2,"result":"LAUNCHED","permission_denials":[]} / {"num_turns":1,"result":"FINISHED"}
workflow-agent hook inputs: permission_mode "default" (the session's mode)
```

### R5 — skill-to-skill invocation through the Skill tool (2.1.286, Sonnet 5.5)

**Setup, skills in `x5`:**

- `caller` (`disable-model-invocation: true`) tells Claude to call Skill with `manualonly`, then `helper`, then
  `forker`.
- `manualonly` (`disable-model-invocation: true`).
- `helper` (plain).
- `forker` (`context: fork`, runs `echo from-forked-skill`).

**Command:**

```
echo "/caller" | run.sh x5 r5 --model sonnet --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose --allowedTools "Bash(echo *)" Skill
```

**Output:**

```
start=2026-09-30T19:14:05Z end=2026-09-30T19:14:22Z exit=0
tool_use Skill {"skill":"manualonly"} -> is_error true: "<tool_use_error>Skill manualonly cannot be used with Skill tool due to disable-model-invocation. Ask the user to run /manualonly themselves — it cannot be invoked via the Skill tool. Do not replicate this skill's workflow by other means — it is reserved for explicit user invocation.</tool_use_error>"
tool_use Skill {"skill":"helper"} -> "Launching skill: helper" + "Base directory for this skill: C:\\Users\\…\\x5\\.claude\\skills\\helper\n\nReply with the single word HELPER-LOADED.\n"
tool_use Skill {"skill":"forker"} -> (forked subagent ran Bash "echo from-forked-skill") -> "Skill \"forker\" completed (forked execution).\n\nResult:\nFORKDONE"
result: {"subtype":"success","num_turns":5,"total_cost_usd":0.131,"permission_denials":[]}
```

### R6 — Stop block cap set to 2 (2.1.286, Haiku 4.5)

**Setup:** `x6/.claude/settings.json` has a Stop hook in `alwaysblock` mode.

**Command:**

```
echo "Reply with the single word START." | XENV="CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=2" run.sh x6 r6 --model haiku --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose --include-hook-events
```

**Output:**

```
start=2026-09-30T19:15:24Z end=2026-09-30T19:15:32Z exit=0
Stop sha=false n=0 last=START | Stop sha=true n=1 last=AGAIN1 | Stop sha=true n=2 last=AGAIN2
assistant: "START" / "AGAIN1" / "AGAIN2"
system informational: "A hook blocked the turn from ending 3 consecutive times — overriding and ending turn. For Stop/SubagentStop hooks, check stop_hook_active in the input and return success while it's true. Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit."
result: {"subtype":"success","result":"","num_turns":4,"stop_reason":"end_turn"}
```

### R7 and R7b — automatic compaction with SessionStart(compact) (2.1.286, Haiku 4.5)

**Setup:**

- `x7/.claude/settings.json`: SessionStart(compactctx), PreCompact, PostCompact and Stop.
- `x7/big.md` is a copy of `hooks.md` (3,848 lines).

**R7 command** (one prompt: three Reads, then list markers):

```
echo "Use the Read tool to read big.md at offset 1 with limit 1300, then at offset 1301 …, then at offset 2601 …. After the three reads, list every string … that begins with COMPACT-MARKER … or reply NONE." | XENV="CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=35" run.sh x7 r7 --model haiku --autocompact 100k --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose --include-hook-events --allowedTools Read
```

**R7 output:**

```
start=2026-09-30T19:16:12Z end=2026-09-30T19:16:27Z exit=0
SessionStart startup | PreCompact trig=auto | Stop
status: {"status":"compacting"} then {"status":null,"compact_result":"failed","compact_error":"too_few_groups"}
assistant: "… I found **NONE** strings that begin with COMPACT-MARKER."
```

**R7b command:** four stream-json turns (three Reads, one per turn, then "List every string … COMPACT-MARKER …").

```
cat r7b.input.jsonl | XENV="CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=35" run.sh x7 r7b --model haiku --autocompact 100k --setting-sources project,local --strict-mcp-config --input-format stream-json --output-format stream-json --verbose --include-hook-events --allowedTools Read
```

**R7b output:**

```
start=2026-09-30T19:16:45Z end=2026-09-30T19:17:26Z exit=0
19:16:46 SessionStart startup
19:16:51 PreCompact auto          (status: compact_result "failed", "too_few_groups")
19:16:58 PreCompact auto          (status: compact_result "success")
19:17:15 SessionStart src=compact action=additionalContext
19:17:15 PostCompact auto
compact_boundary: {"trigger":"auto","pre_tokens":75449,"post_tokens":42369,"cumulative_dropped_tokens":33080,"duration_ms":16983,…}
final answer: "Searching my context for strings beginning with `COMPACT-MARKER`: `COMPACT-MARKER-settings-9921`"
```

### R8 — duplicate invocation and `/clear` (2.1.286, Haiku 4.5)

**Setup:** skill `dup` in `x8`, with UserPromptSubmit and Stop logging.

**Input**, five stream-json messages: `/dup`, `/dup`, "Reply with the single word PLAIN.", `/clear`, "Reply with the
single word AFTERCLEAR."

**Command:**

```
cat r8.input.jsonl | run.sh x8 r8 --model haiku --setting-sources project,local --strict-mcp-config --input-format stream-json --output-format stream-json --verbose --include-hook-events
```

**Output:**

```
start=2026-09-30T19:17:50Z end=2026-09-30T19:18:02Z exit=0
skill UPS "/dup" | skill Stop "DUP" | skill UPS "/dup" | skill Stop "DUP" | skill UPS "Reply … PLAIN." | skill Stop "PLAIN"   (all sid beeb617d)
(no skill entries for "AFTERCLEAR")
results: DUP (beeb617d) / DUP / PLAIN / "" num_turns 0 (5b19779c, the /clear) / AFTERCLEAR (5b19779c)
```

### R9 — hooks installed in `.claude/settings.local.json` between two turns (2.1.286, Haiku 4.5)

**Setup:** `x9/driver.js` spawns `claude.exe -p --model haiku --setting-sources project,local --strict-mcp-config
--input-format stream-json --output-format stream-json --verbose --allowedTools "Bash(echo *)"`. Then it:

1. sends turn 1 (`echo before-install`, reply ONE);
2. on the first `result`, writes `x9/.claude/settings.local.json` with PreToolUse(Bash) and Stop logging hooks;
3. after 4 s, sends turn 2 (`echo after-install`, reply TWO).

The environment was scrubbed as in `run.sh`.

**Output:**

```
result #1: "ONE"
installed hooks at 2026-09-30T19:20:20.291Z
result #2: "TWO"
claude exited 0
hook log: {"tag":"localsettings","event":"PreToolUse","cmd":"echo after-install ."} / {"tag":"localsettings","event":"Stop","last":"TWO"}
```

### R10 — the resume test repeated on a single version (2.1.286, Haiku 4.5)

**Commands** (same `dup` skill, in `x10`):

```
echo "/dup" | run.sh x10 r10a --session-id 4ff1bcc9-5544-494c-8866-54c5b4831415 --model haiku --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose
echo "Reply with the single word RESUMED." | run.sh x10 r10b --resume 4ff1bcc9-5544-494c-8866-54c5b4831415 --model haiku --setting-sources project,local --strict-mcp-config --output-format stream-json --verbose
```

**Output:**

```
r10a version=2.1.286 {"result":"DUP","sid":"4ff1bcc9"}
r10b version=2.1.286 {"result":"RESUMED","sid":"4ff1bcc9"}
hook log: skill UserPromptSubmit "/dup" | skill Stop "DUP"      (nothing from r10b)
```

### Cost

Figures are `total_cost_usd` as reported by each run, list-price equivalent.

| Run | Model | USD |
| :- | :- | -: |
| r1 | Sonnet 5.5 | 0.180 |
| r2 | Sonnet 5.5 | 0.198 |
| r3 | Sonnet 5.5 | 0.185 |
| r4 | Sonnet 5.5 | 0.159 |
| r5 | Sonnet 5.5 | 0.131 |
| r6 | Haiku 4.5 | 0.041 |
| r7 | Haiku 4.5 | 0.133 |
| r7b | Haiku 4.5 | 0.176 |
| r8 | Haiku 4.5 | 0.035 |
| r9 | Haiku 4.5 | 0.041 |
| r10a | Haiku 4.5 | 0.025 |
| r10b | Haiku 4.5 | 0.029 |
| **Total** | | **1.332** |

The experiment folder takes 3.2 MB.

## Verification

Adversarial verification of the load-bearing claims, 2026-09-30, 19:30-20:00Z, by a separate verifier subagent. This
section overrides the body where they differ.

- **Method.**
  - I re-read every cited raw log and stream under `cc-experiments/x*`.
  - I re-fetched the doc pages from `https://code.claude.com/docs/en/<page>.md` at about 19:33Z. All were
    byte-identical to the 18:59Z snapshots except `skills.md`, which had changed (see F25).
  - Line numbers below refer to these live pages. They match the snapshot numbering everywhere except `skills.md`
    after line 1132.
  - I grepped the installed 2.1.286 binary and searched the vendor's GitHub issues
    (`gh search issues --repo anthropics/claude-code`).
- **New experiments.** Seven headless runs (V1, V2, V3once, V3always, V4, V4b, V5), all on 2.1.286. They ran with
  `--setting-sources project,local`, `--strict-mcp-config` and the same environment scrub. They cost about USD 0.63 in
  total and live in `cc-experiments/verify/` (`v1` … `v5`, `envlog.js`, `stopctx.js`, `run.sh`). The record is at the
  end of this section.
- **Verdict counts.**

  | Verdict | Claims |
  | :- | :- |
  | Confirmed (17) | F03, F04, F05, F06, F07, F08, F09, F11, F12, F13, F16, F18, F20, F22, F24, F25, F29 |
  | Partly-true (4) | F19, F21, F23, F27 |

  - Nothing was refuted outright, but the workflow-agent and push parts of F21 are wrong.
  - Several confirmed claims carry corrections to their implications: F05, F11, F12, F22, F25, and F29, whose time is
    corrected.

### Verdicts

- **F03: confirmed, with CLI-only caveats.**
  - **Evidence.** skills.md:376, :536 and :543 are unchanged on the live page. The R5 raw stream carries the fixed
    refusal text, and the 2.1.286 binary holds the same template. In V1, V2, V4b and V5 (Haiku 4.5), the
    `disable-model-invocation: true` skills `/rootprobe`, `/wflist`, `/granttest2` and `/cprobe` ran when typed as
    the `-p` prompt.
  - **Caveats.** Three open vendor issues report exceptions:
    - #95469: in a stacked command (`/a /b …`), a flagged skill in position 2 or later is refused as if Claude had
      called it.
    - #82237: coordinator mode (`CLAUDE_CODE_COORDINATOR_MODE=1`, desktop app) hides flagged skills entirely. The
      2.1.286 binary still contains "cannot run in coordinator mode".
    - #78523 concerns claude.ai chat, where the model rather than the CLI resolves `/name`.
  - **Design consequence.** Type `/execution` alone and first in the message. Typing it from the Remote Control
    mobile client remains untested.
- **F04: confirmed by execution, and it covers notification-driven turns too.**
  - **Evidence.** skills.md:378-380.
  - **V4.** A skill with `model: sonnet` ran its invoking turn on `claude-sonnet-5-5`. The turn driven by the
    workflow-completion notification ran on `claude-haiku-4-5`, the session model.
  - **V4b.** A skill with `allowed-tools: Bash(touch *)` ran `touch grant-turn-one.txt` in the invoking turn. In the
    notification-driven turn, `touch grant-turn-two.txt` was refused ("needs approval … Claude Code asks before a
    shell command creates, changes or removes files there"). So was a control `mkdir`, and `permission_denials`
    listed both.
  - **Conclusion.** The grant and the model override end with the invoking turn. They do not last until the user's
    next message across autonomous turns.
  - **Probe hygiene.** My first try, V4, used `echo`, which is invalid: `echo` is a built-in read-only command that
    runs without a prompt in every mode (permissions.md:255).
- **F05: confirmed as stated, but the implication is incomplete.**
  - **Evidence (V1).**
    - A skill hook in exec form, `args: ["${CLAUDE_SKILL_DIR}/envlog.js", …]`, failed with "Cannot find module
      '…/v1/${CLAUDE_SKILL_DIR}/envlog.js'" (Windows separators shown as `/`). The placeholder passed through
      literally.
    - `CLAUDE_SKILL_DIR` was null in every hook, and `CLAUDE_PROJECT_DIR` was set in both skill and settings hooks.
  - **Evidence (2.1.286 binary).**
    - The hook runner sets `CLAUDE_PROJECT_DIR` for every hook and runs `if(he)Zn.CLAUDE_PLUGIN_ROOT=Rt(he)`, where
      `he` is the hook's `skillRoot`.
    - It also contains the error text "only ${CLAUDE_PLUGIN_ROOT} is available for skill hooks".
  - **Correction.** Skill hooks get `CLAUDE_PLUGIN_ROOT` set to the skill's own directory.
    - In V1 the shell form `node "${CLAUDE_PLUGIN_ROOT}/envlog.js"` ran the copy in `.claude/skills/rootprobe/`.
    - The exec-form `args` placeholder was substituted too.
    - Settings hooks get no `CLAUDE_PLUGIN_ROOT`.
    - This is undocumented for skills: skills.md:447 documents it only for plugin skill content. Use
      `"${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/execution}"` and keep the fallback.
- **F06: confirmed.**
  - **Evidence.** hooks.md:671. In V5 (Haiku 4.5), the skill's UserPromptSubmit fired for `/cprobe` and again after
    `/compact`.
  - **Vendor issue #89669.** It quotes the maintainer closing #82801 as working as documented: "skill-frontmatter
    hooks intentionally persist for the rest of the session once registered".
  - **Binary.** The session-hook store (`class BI{sessions=new Map; …}`) deduplicates on matcher and `skillRoot`. That
    fits R8's single registration.
  - **Caveat.** Vendor issue #95280 (open, 2.1.273) reports that `once: true` in skill frontmatter is ignored, so do
    not rely on `once`.
- **F07: confirmed.**
  - **Evidence.** The raw logs match the dossier:
    - `x8/hooklog.jsonl` has no skill entry after `/clear` (session `beeb617d` became `5b19779c`).
    - `x10` has no skill entry for the resumed run (same session `4ff1bcc9`).
  - **Mechanism (binary).** The session-hook store is an in-memory `Map` keyed by session id (`this.sessions.get(e)`).
    A new process or a new session id therefore starts empty.
  - **Addition.** `/clear` also works from the phone (remote-control.md:346 lists it among the commands that work
    from mobile and web). A `/clear` sent from the phone therefore silently removes the frontmatter hooks.
- **F08: confirmed, now n = 2.**
  - **V5 setup (Haiku 4.5, `-p` stream-json).** The skill declared `SessionStart` (matcher `compact`), `PreCompact`,
    `PostCompact` and `UserPromptSubmit`.
  - **V5 result.** After `/compact`, only the settings copies of PreCompact (manual), SessionStart (source `compact`)
    and PostCompact fired. The skill's UserPromptSubmit fired before and after the compaction.
  - **Binary (inferred).** The resolver `J0(e,n,r,…)` returns only settings and plugin hooks when no session-hook
    registry is passed (`if(e===void 0||S_e())return g`). That fits these events being run without the registry.
  - **Scope.** Still measured in `-p` only.
- **F09: confirmed, with the mechanism now sourced.**
  - **Evidence.** The raw `x1` and `x4` logs match the dossier.
  - **Binary 2.1.286.** `$ee(e,n,r)` looks up session hooks with `[agentId]` for a subagent.
    - It adds the parent's id only for the built-in `web-fetch` subagent: `AP(e)` tests `subagentName===qE`, with
      `qE="web-fetch"`.
    - Even then, only for PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied and
      PostToolBatch.
  - **V2.** Settings SubagentStart and SubagentStop fired for the workflow agent, with `agent_type:
    workflow-subagent`.
- **F11: confirmed, but the implication should change.**
  - **Evidence.**
    - The R1 raw stream matches the dossier: a JSON block produces `Stop hook feedback:`, a newline and the reason
      (hook outcome `success`); exit 2 produces `Stop hook feedback:`, a newline and
      `[node "…/hooklog.js" … skill stopgate]: STOP-GATE-2 …` (hook outcome `error`).
    - hooks.md:2609-2622.
    - In R6 a plain JSON `decision:"block"` also raised the notification `stop-hook-error`, "Stop hook error occurred
      · ctrl+o to see".
    - The docs call `decision: "block"` "a hook error" in the transcript and `hookSpecificOutput.additionalContext`
      "Non-error feedback".
  - **V3once.** The Stop hook returned only
    `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"CTX-GATE-1: … CTX1 …"}}`.
    - The turn continued: Claude replied `CTX1`, and the next Stop had `stop_hook_active: true`.
    - No stop-hook-error notification appeared.
  - **Correction.** Make /execution's gate emit `additionalContext` rather than `decision:"block"`. A JSON block
    still beats exit 2.
- **F12: confirmed, with one correction.**
  - **Evidence.** hooks.md:2543 and env-vars.md:377. The R6 raw stream shows START, AGAIN1 and AGAIN2, then the
    informational message "A hook blocked the turn from ending 3 consecutive times — overriding and ending turn …".
    Its result was `""` with `num_turns: 4`.
  - **V3always (cap = 2, additionalContext every time).** Claude replied `CTX1` and `CTX2`, then the same override
    message appeared. The cap therefore also counts `additionalContext` continuations.
  - **Correction.** The empty `-p` result belongs to the `decision:"block"` path only. With `additionalContext` the
    result kept the last text (`"CTX2"`, `num_turns: 1`). Detect the override from the `stop-hook-block-cap`
    notification or the informational message, not from the result text.
- **F13: confirmed, with the `/clear` part now measured cleanly.**
  - **R8 was confounded.** It had only skill hooks, and `/clear` removes those.
  - **V2 (settings hooks).**
    - Stop fired at the end of the launch turn: `last` = `LAUNCHED`, `bg` =
      `[{"type":"workflow","status":"running","name":"toolprobe"}]`.
    - It fired again at the end of the notification-driven turn, with `bg` = `[]`.
    - `/clear` fired SessionEnd for the old session (`0a65263b`), then SessionStart with source `clear` for the new
      one (`7cdf8451`). It fired no UserPromptSubmit and no Stop.
  - **Addition: notification turns.** UserPromptSubmit also fires for the notification-driven turn. Its `prompt`
    starts with `<task-notification>`, then a newline and `<task-id>…` (V2). This answers open question 3.
  - **Addition: API errors.** A turn that ends on an API error fires StopFailure instead of Stop, and StopFailure has
    no decision control (hooks.md:2635, hooks-guide.md:962). The gate never sees rate-limit, overload or auth
    endings.
- **F16: confirmed.**
  - **Evidence.** In the raw `x7` logs, R7 shows PreCompact (auto) followed by `compact_result:"failed",
    "too_few_groups"`. R7b shows PreCompact (auto) twice, then SessionStart (source `compact`), then PostCompact.
    hooks.md:919, :1106 and :1115.
  - **V5.** A settings SessionStart with an explicit `"matcher": "compact"` fired after `/compact`. R3 and R7b had
    used an unmatched hook that filtered on `source` inside the script.
  - **Correction to Appendix A.** R7b's four stream-json messages were merged into one turn: one result,
    `num_turns: 6`, one Stop. They were not four turns.
- **F18: confirmed.**
  - **Evidence.** The 2.1.286 binary's Workflow description contains, verbatim, "- The user invoked a skill or slash
    command whose instructions tell you to call Workflow.". Also workflows.md:133-137.
  - **Other models.** Haiku 4.5 did the same from user-typed skills in V2, V4 and V4b (`-p`, `--allowedTools
    Workflow`). Sonnet 5.5 did it in R4 and in V4's first turn.
  - **Still open.** Opus 5.5 in an interactive session.
- **F19: partly-true.**
  - **Evidence.** workflows.md:183, :188, :362 and :365.
  - **Binary input schema.**
    - Inputs: `script`, `name`, `description` (ignored), `title` (ignored), `args`, `scriptPath`, and
      `resumeFromRunId` (`^wf_…`, "Same-session only. Stop the prior run first").
    - The schema requires "script, name, scriptPath, or runId".
  - **`agent()` options (binary).** `label`, `phase`, `schema`, `model`, `effort`, `isolation` and `agentType`.
    `model` is dropped from the reference when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set.
  - **Correction: the default is not 16 agents on this machine.**
    - The 2.1.286 binary sets `ns=ts(Zr())`, where `Zr` is `os.availableParallelism` and
      `function ts(e){return Math.min(16,Math.max(2,e-2))}`.
    - `node` reports `availableParallelism` = 16 here, so the default is 14.
    - Set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=16` (range 1-256, env-vars.md:404) to get 16. I derived this
      from the source and did not run it.
- **F20: confirmed.**
  - **Evidence.** The R5 raw stream matches the dossier. `harden/SKILL.md:5` sets `disable-model-invocation: true`;
    hackathon and prose do not. `~/.claude/skills/frontend/` holds only `research/`, with no SKILL.md.
  - **Addition.** In an interactive session a `context: fork` skill runs in the background by default, with the
    narrower background tool set (skills.md:727-736). Set `background: false` to get the result in the same turn.
- **F21: partly-true; the workflow-agent and push parts are refuted.**
  - **Regular subagents.** sub-agents.md:424-435 holds as quoted.
  - **Workflow agents (V2 transcript).**
    - `…/subagents/workflows/wf_0b06c82a-ba7/agent-a4189f3923c169158.jsonl` got a `deferred_tools_delta` with
      `addedNames` CronCreate, CronDelete, CronList, DesignSync, EnterWorktree, ExitWorktree, Monitor, NotebookEdit,
      **PushNotification**, RemoteTrigger, SendMessage, TaskCreate, TaskGet, TaskList, TaskStop, TaskUpdate, WebFetch
      and WebSearch.
    - That list is identical to the main session's.
    - Its `.meta.json` reads `{"agentType":"workflow-subagent",…,"requestShape":"foreground"}`.
  - **Binary.**
    - The workflow runtime spawns agents with `isAsync:!1`, so `requestShape` is `"foreground"` and the background
      filter never applies.
    - The built-in definition is `{agentType:"workflow-subagent",tools:["*"],disallowedTools:[kp,_t,Jd]}`, with
      `kp="SendUserMessage"`, `_t="Agent"` and `Jd="Workflow"`.
  - **Correction: workflow agents.**
    - They keep PushNotification, the Cron tools, RemoteTrigger, Monitor and the task tools.
    - They cannot call Agent (no nested subagents), Workflow or SendUserMessage.
    - They lose AskUserQuestion through the first filter.
  - **Correction: forks.** Forks (the `fork` type, on by default in interactive sessions) skip both filters and get
    the main conversation's exact tool pool (sub-agents.md:424 and :1183).
  - **Correction: pushes.**
    - PushNotification has no subagent guard in the binary. It checks only transport, `agentPushNotifEnabled` and
      user presence.
    - So "only the main thread can push" is not a platform rule. I did not test delivery from an agent, to avoid a
      real push.
    - Keep pushes in the orchestrator by instruction, and forbid PushNotification, Cron* and RemoteTrigger in wave
      prompts.
- **F22: confirmed, `-p` only.**
  - **Evidence.**
    - The raw `x9` log and driver match the dossier.
    - settings.md:584: "Claude Code watches your settings files … including edits to `permissions`, `hooks` … For the
      project's `.claude/` folder, it loads the file even when you create the folder in the same session".
    - hooks-guide.md:999: "the file watcher may have missed the change: restart your session".
    - Settings hooks survived compaction in V5 and `/clear` in V2.
  - **Correction: where the file is read on Windows.**
    - `.claude/settings.local.json` is read from the session's primary working directory, not the git root
      (settings.md:481: "When the file stays with `.claude/settings.json` instead: … on Windows").
    - `.claude/settings.json` hooks load only from the working directory's `.claude/`, with no parent fallback
      (permissions.md:609).
    - Write the hooks to `$CLAUDE_PROJECT_DIR/.claude/settings.local.json` and start the session at the repository
      root.
  - **Git hygiene.** A file created by hand is not auto-added to git excludes (settings.md:466).
- **F23: partly-true.**
  - **Evidence.** permission-modes.md:28-44 and :716-734, hooks-guide.md:967, sub-agents.md:570, workflows.md:196 and
    tools-reference.md:133 are all as quoted.
  - **Correction.** The list is right for permission prompts. It is not the full list of things that stop or break
    an unattended bypass run:
    - **Usage limits.** A workflow run pauses at a usage limit only when every one of these holds; otherwise the
      affected agents fail (workflows.md:397-409):
      - the session is an interactive claude.ai session, and not a Remote Control, background or teammate session;
      - `autoContinueAtUsageLimit` is on;
      - the limit resets within 24 h;
      - the run has waited fewer than two times.
    - **API errors.** The turn ends with StopFailure and no Stop gate runs.
    - **The Fable usage-credits consent prompt.** It is not forwarded to Remote Control, and the turn ends if nobody
      answers it (remote-control.md:344).
    - **Other forwarded dialogs.** They expire after 5 minutes with the no-action default (remote-control.md:343).
    - **Critical-path `rm`.** After three unanswered countdowns, further critical-path removals are denied
      immediately (permission-modes.md:724).
- **F24: confirmed.**
  - **Evidence.** permissions.md:52, :660 and the table at :694. The R4, R8 and R10 `init` skill lists contain no
    hackathon, harden or prose under `--setting-sources project,local`. skills.md:224 adds that synced skills are
    also skipped when the list leaves out `user`.
- **F25: confirmed.**
  - **Evidence.** skills.md:552-556.
  - **The live page changed after the snapshot** (100,566 bytes against 99,613). Its new section "Claude stops
    following a skill" (skills.md:1134) says: "The conversation was compacted: invoke the skill again to restore its
    full content. After compaction, Claude Code can keep only the start of an invoked skill, so put the most
    important instructions near the top of `SKILL.md`."
  - **Addition.** The 25,000-token budget is filled "starting from the most recently invoked skill, so older skills
    can be dropped entirely" (skills.md:556). If the orchestrator loads five or more other skills inline after
    /execution, /execution itself can disappear at compaction. Load other skills inside workflow agents instead.
- **F27: partly-true.**
  - **Evidence.** remote-control.md:18, :199-209 and :336-345.
  - **Correction: `/resume`.** It is local-only (remote-control.md:345: "commands that only run in the terminal
    interface, such as `/plugin` or `/resume`, work only from the local CLI"). A stopped `claude --remote-control`
    process can be brought back only at the machine.
  - **Correction: server mode (`claude remote-control`).**
    - remote-control.md:337: "if a session served by `claude remote-control` crashes, send it a message from a
      connected device. Claude Code serves it again" (v2.1.238 or later).
    - `claude remote-control --continue` or `--session-id` brings a session back within about 4 hours.
    - All of these routes lose skill hooks; for the re-serve route that is inferred.
  - **Correction: pushes in server mode.**
    - Vendor issue #92661 (open, 2.1.250-2.1.263) reports that `PushNotification` always answers "Mobile push not
      sent (Remote Control inactive)".
    - That fits the 2.1.286 code, which grants a push transport only when `CLAUDE_CODE_REMOTE` is set or the
      interactive bridge is active.
    - **Trade-off.** Server mode gives crash recovery from the phone without pushes. `--remote-control` gives pushes
      without recovery from the phone.
  - **Push prerequisites.** Pushes need the `/config` toggle "Push when Claude decides". It is on here:
    `agentPushNotifEnabled: true` in `~/.claude/settings.json`. Permission prompts and questions need "Push when
    actions required", and `inputNeededNotifEnabled` is not set here. Claude Code also skips pushes while the terminal
    is focused.
- **F29: confirmed, with a corrected time.**
  - **Evidence.** `ls --time-style=full-iso ~/.local/bin` and the `// Version:` string inside each binary:

    | File | Version | Time |
    | :- | :- | :- |
    | `claude.exe` | 2.1.286 | written 19:09:21Z |
    | `claude.exe.old.1790795388616.13108` | 2.1.285 | set aside at 19:09:48.616Z; the directory mtime is 19:09:48.618Z |
    | `claude.exe.old.1790760164539.22972` | 2.1.282 | set aside at 09:22:44Z |

    The run streams report 2.1.285 for r1 and 2.1.286 for r2 to r10. env-vars.md:420 and :440.
  - **Correction: two updates today.** The swap happened at 19:09:48Z, not 19:09:21Z. A second auto-update ran the
    same day at 09:22:44Z (2.1.282 to 2.1.285).
  - **Correction: the existing setting does not pin.** `~/.claude.json` already has `"autoUpdates": false`, and it
    stopped neither update.
    - The 2.1.286 binary ignores that flag for native installs:
      `if(n.autoUpdates===!1&&(n.installMethod!=="native"||n.autoUpdatesProtectedForNative!==!0))`. Here
      `installMethod` is `"native"` and `autoUpdatesProtectedForNative` is `true`.
    - Only `DISABLE_UPDATES` or `DISABLE_AUTOUPDATER` in the process environment counts.
    - Every `claude` process updates the same shared binary, so set the variable as a Windows user environment
      variable.
    - Pin with `claude install <version>` (cli-reference.md:24).

### Missed

Facts the design needs that the body does not report:

1. **Skill hook paths.** Skill hooks get `CLAUDE_PLUGIN_ROOT` set to the skill's own directory, usable in shell and
   exec form (V1 and binary). It is undocumented for skills, so keep an absolute fallback (F05).
2. **Workflow concurrency.** The default is 14 concurrent agents on this 16-CPU machine, from `min(16, max(2, CPUs −
   2))`. Set `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` if 16 is wanted (F19).
3. **Workflow agents' tools.**
   - Workflow agents cannot use the Agent tool. A wave agent cannot spawn its own verifier, so the independent proof
     check must be a separate `agent()` call in the script (binary: `disallowedTools` Agent, Workflow,
     SendUserMessage).
   - They do have PushNotification, the Cron tools and RemoteTrigger (V2 transcript, F21).
   - Vendor issue #80544 (open) reports that `agent({agentType})` resolves custom agents from the session working
     directory's registry, not the script's repository.
4. **UserPromptSubmit on notification turns.** It fires for every task-notification turn, with a prompt starting
   `<task-notification>` (V2).
   - A UserPromptSubmit hook can re-inject the state pointer at each wave completion.
   - Any "the developer answered" logic must ignore these prompts.
5. **`/clear` changes the session id.** It fires SessionEnd, then SessionStart with source `clear` and a new
   `session_id` (V2). Resume and compaction keep the id (R2, R10, V5).
   - A gate keyed on the orchestrator's `session_id` must re-key on SessionStart(`clear`) while the marker exists.
   - Remember that `/clear` can be sent from the phone.
6. **StopFailure.** API-error endings (`rate_limit`, `overloaded`, `authentication_failed`, `billing_error`,
   `max_output_tokens` and others) fire StopFailure, not Stop, and it has no decision control (hooks.md:2635). Add a
   StopFailure hook that records `awaiting: stuck` and alerts. Open vendor issues:
   - #91419: it also fires for helper and subagent failures on the parent session.
   - #98012: `rate_limit` covers both a resumable usage-limit freeze and a non-resumable credits condition.
   - #93728: the Workflow tool keeps dispatching queued agents after a rate-limit stop; each fails and is recorded as
     `error`.
7. **Usage limits under Remote Control.** In a Remote Control session, workflow agents that hit a usage limit fail
   instead of pausing (workflows.md:397-409).
   - The plan's phone-monitored sessions therefore need retry logic.
   - `resumeFromRunId` works in the same session only.
   - Keep waves small enough that a limit hit does not burn the queue.
8. **Push is best effort.**
   - Pushes need the Claude app signed in, operating-system permission and the `/config` toggles. They are skipped
     while the terminal is focused (remote-control.md:299-331).
   - Open vendor issues report pushes not arriving: #96568, #83523, and #98500 filed 2026-09-30.
   - Server mode cannot push at all (#92661).
   - The Notion report after each wave (user decision 7) is the dependable channel.
9. **Choose the Remote Control mode deliberately.**
   - `claude --remote-control` gives pushes, but a dead process can come back only at the laptop.
   - `claude remote-control` (server mode) re-serves a crashed session when the phone sends a message, but cannot
     push.
   - Neither route keeps skill hooks, so durable hooks belong in settings either way (F27).
10. **Where settings files live on Windows.** `.claude/settings.local.json` and `.claude/settings.json` are read from
    the session's starting directory, not the git root. A hand-written `settings.local.json` is not auto-excluded from
    git (F22).
11. **The Stop gate channel.** `hookSpecificOutput.additionalContext` is the cleaner gate channel. It continues the
    turn under the same `stop_hook_active` protection and the same cap, and raises no "Stop hook error" notification
    (V3). JSON `decision:"block"` raised one (R6) and blanks the `-p` result when the cap overrides (F11, F12).
12. **Re-attachment budget.** After compaction the budget favours the most recently invoked skills, so
    /hackathon, /prose or others invoked inline after /execution can push /execution out entirely. Also, the skills
    docs changed today and the 18:59Z snapshot is stale for skills.md (F25).
13. **Auto-update pinning.** `autoUpdates: false` in `~/.claude.json` is ignored for native installs. Only the
    `DISABLE_AUTOUPDATER` or `DISABLE_UPDATES` environment variables pin the binary, and two updates landed today
    (F29).
14. **Rehearsal probes of permissions need a command that is not read-only.** `echo`, `ls`, `cat` and the like are
    auto-approved in every mode (permissions.md:255). A probe using them shows nothing.
15. **Wave agents inherit the global CLAUDE.md.** The V2 workflow agent's transcript carries an `instructions`
    attachment with `C:/Users/Utilisateur/.claude/CLAUDE.md`. Its "propose a plan and ask before major decisions",
    "remind the user to commit" and "offer an X post" rules will reach wave agents. The wave prompts must override
    them explicitly: act, do not ask, and leave commits and reports to the orchestrator.
16. **Invocation hygiene.** Type `/execution` on its own: a flagged skill in position 2 or later of a stacked
    command is refused (#95469). Do not rely on `once: true` in skill hooks (#95280).

### Verifier experiment record (2.1.286)

| Run | Model | What it tested | Key output | USD |
| :- | :- | :- | :- | -: |
| V1 `v1/` | Haiku 4.5 | Skill-hook path variables | `ups-shell-pluginroot` and `ups-exec-pluginroot` ran the copy in `.claude/skills/rootprobe/` with `CLAUDE_PLUGIN_ROOT` = the skill directory; `ups-exec-skilldir` failed: "Cannot find module '…/v1/${CLAUDE_SKILL_DIR}/envlog.js'"; settings hook `CLAUDE_PLUGIN_ROOT` null | 0.025 |
| V2 `v2/driver.js` | Haiku 4.5 | `/wflist` (workflow agent lists its tools), then `/clear`, then a plain prompt, all with settings hooks | Hook order: SessionStart startup, UPS `/wflist`, SubagentStart workflow-subagent, Stop (`LAUNCHED`, bg workflow running), SubagentStop, UPS `<task-notification>…`, Stop (bg `[]`), SessionEnd, SessionStart `clear` (new sid), UPS `AFTER`, Stop, SessionEnd. Agent meta `requestShape: "foreground"`; deferred tools include PushNotification | 0.094 |
| V3once `v3once/` | Haiku 4.5 | Stop `additionalContext` once | START, then CTX1; second Stop `sha: true`; no stop-hook-error notification | 0.030 |
| V3always `v3always/` | Haiku 4.5 | `additionalContext` every time, cap = 2 | START, CTX1, CTX2, then cap override message; result `"CTX2"` | 0.034 |
| V4 `v4/` | Sonnet 5.5 skill turn, Haiku 4.5 session | Skill `model: sonnet` across a notification turn | Invoking turn on Sonnet 5.5, notification turn on Haiku 4.5. Its `echo` grant test is void | 0.314 |
| V4b `v4b/` | Haiku 4.5 | `allowed-tools: Bash(touch *)` across a notification turn | Turn 1 touch ran; notification-turn touch and control mkdir denied; `permission_denials` lists both | 0.073 |
| V5 `v5/` | Haiku 4.5 | Skill vs settings SessionStart(compact), PreCompact and PostCompact | Only settings copies fired; skill UPS fired before and after `/compact` | 0.063 |
