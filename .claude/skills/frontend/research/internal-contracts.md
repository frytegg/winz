# How /frontend plugs into /hackathon, /execution, /harden and /prose

> Code FD13 · slug internal-contracts · researched 2026-09-30 · verified 2026-09-30 · counts: verified 14 / corrected 17 / downgraded 0 / dropped 0 / added 2

## Summary

- **Who calls it is not settled.** The owner's own request says only that /frontend "sera appelé par execution"; the words "during the build" come from the workflow script's rendering of it. The /execution design session recorded the reading "simple UI, then /frontend as its own pass", marked it "confirm", and asked the owner at 18:57Z; no answer is in the transcript, which still holds only two owner-typed messages at 20:06Z (F01). Design both entry points on one contract. (corrected: attribution of "during the build"; transcript re-read to 20:06Z)
- **Invocation mechanics.** /frontend must not set `disable-model-invocation`, or /execution cannot call it; only /harden stays owner-typed (F02). Run inside a workflow agent or as a `context: fork` skill, it has no Workflow and no AskUserQuestion; a workflow agent also has no `Agent` tool, so it cannot fan out at all (F03). Every question must then become a file-based manual task. After compaction only the first 5,000 tokens of each skill survive, inside 25,000 tokens shared by all skills (F04). (corrected: workflow agents cannot call `Agent`)
- **Inputs.** Phase A outputs exist in all five workspaces surveyed, under different names; F05 gives a discovery glob and a fallback for each. **No customer table in the four events records a website** (F06). Every reference URL must be resolved, sourced and confirmed; DefiLlama sometimes returns an app route instead of a homepage. The two sentences, use cases, judge's path, fold and shot list already exist upstream (F07, F14). The feature catalogue is written from the code after the build (F08).
- **Never-show inputs.** Four kinds exist: do-not-carry, undisclosed security, never-public and date-bound embargo. Only never-public is checked by a script, and only in files (F11). The live BNB board already renders findings that the BNB memory says to hold until 11 Oct 12:00 UTC (F12).
- **Proof /execution can consume.** One offline command that exits 0 or 1, with a JSON gate list shaped like the owner's completion-check (F16). That script's `--json` mode reports a skipped gate as `ok: true`, so /frontend's version needs a separate skipped state that never counts as passing. (corrected: skipped-gate caveat added) The gates the evidence supports:
  - every catalogue feature rendered in the DOM, since BNB's missing panel is the failure that created the rule (F09);
  - no number without a verified ledger row (F10);
  - the deny-list clean on rendered text (F11, F12);
  - the hero identical to the two sentences (F07);
  - an axe floor (F22);
  - brand files plus a drift test (F15);
  - a drop order and a never-drop list (F17).
- **Place in /execution's DAG.** /frontend starts after the data contract freeze (F20), runs in parallel with file-disjoint backend work, and finishes before build-complete (F21) and before the T-6h demo audit (F24). README screenshots stay last (F19).
- **Conflicts with /harden.** Untracked outputs make /harden report-only. Committed snapshots and configs become read-only during its run. When the run profile sets no `deadline_utc` or `max_minutes`, harden's default deadline adds 20 min per 1,000 in-scope lines, inside a 120-600 min clamp, so frontend code adds nothing while the project stays under about 3,000 in-scope lines in total (F21). Harden's frontend lens never loads for BNB's template-string server or for a no-framework page (F22). (corrected: the formula is a default that a profile overrides)
- **Conflicts with /prose.** It checks Markdown only and never mentions UI copy (F23).
- **Clock.** 86.4 h remain until the flight, and the /execution rehearsal is proposed for Fri 2 Oct (F29).
  - Origins: 35.98 h window, 1-2 h of frontend budget in the 21 Sept plan, no pre-event code, no name yet (F26). The Cardano track, the primary's track, has weighted User Experience & Design at 20 % since at least 24 Sept, after that plan was written (F32).
  - Ledger: remote build 6-13 Oct; Eli (dev B) carries the build 6-11 Oct while the owner is effectively unavailable until the end of 8 Oct; live 5-minute final on 16 Oct (F27). (corrected: "alone" overstated the source)
  - BNB: freeze 3 Oct, no deploys 4-8 Oct, submission 11 Oct 12:00 UTC; the visual pass is waiting for /frontend (F28).

## Findings

### FD13-F01 — The owner's words and the /execution design disagree on when /frontend runs; the workflow script's rendering of the latest request says /execution calls it during the build

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** In the /execution design session, the owner first wrote that /execution "will surely involve" /frontend, but not /harden or /prose (JSONL line 11, 18:28:24Z). His answer to question 6 (line 161, 18:47:27Z) is ambiguous. The session recorded its own reading, "until then /execution builds a simple UI and /frontend runs as its own pass afterwards", flagged it "confirm", and asked the owner (line 191, 18:57:48Z). The transcript's last record was at 19:18:56Z when this dossier was written; re-read at 20:06Z it had grown to 300 lines and 49 user-type records, but still only two owner-typed messages (lines 11 and 161), so no answer to that question is in it. The same reading is written into the research brief given to all nine /execution research agents (workflow script, line 19). The owner's own /frontend request says "Ce skill sera appeleé par execution, et alimenter par hackathon et execution" (called by /execution, fed by /hackathon and /execution); the words "during the build" appear only in the workflow script's rendering of that request, so the owner's words fit both readings. (corrected: "during the build" is the workflow script's wording, not the owner's; transcript re-checked to 20:06Z)
- **Implication for /frontend:** Design two entry points on one contract:
  - **mode A**, a task node inside /execution's build, as the workflow brief reads the owner's request;
  - **mode B**, a standalone pass over a UI that already exists, as the design session reads it and as BNB actually needs (F28).
  Ask the owner to settle this before /execution's architecture is written. Until then, the memory line "[/frontend pass]" is what other agents will read and act on.
- **Evidence:**
  - [/execution design transcript (JSONL)](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur-Documents/1b81010d-85f5-4bc4-9aad-c09f0606fc88.jsonl) — the owner and Claude, 2026-09-30, accessed 2026-09-30 — primary session log, parsed with Python (utf-8).
    - line 11, user, 18:28:24Z: "ce skill fera surmeent intervenir le skill frontend qui est en cours de construction, mais pas harden ni prose. Ces 2 skills seront passé en fin de projet une fois l'implementation jugé 100% fini."
    - line 161, user, 18:47:27Z: "6. le skill est pas commencé encore. je vais le faire, sinon faire juste une UI simple et je passe frontend avant."
    - line 191, assistant, 18:57:48Z: "Ta réponse 6 : je comprends que tant que `/frontend` n'existe pas, `execution` fait une UI simple, et que tu lances `/frontend` après `execution`, avant `/harden`. C'est bien ça ?"
  - [project_execution_skill.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur/memory/project_execution_skill.md) — owner memory, modified 2026-09-30T18:54Z, accessed 2026-09-30 — lines 15 and 26-27.
    - "Pipeline: /hackathon (Phase A) -> /execution -> [/frontend pass] -> /harden -> /prose -> deliverables."
    - "6. /frontend is not started; the user will build it. Until then /execution builds a simple UI and /frontend runs as its own pass afterwards (my reading of "je passe frontend avant" — confirm)."
  - Workflow script extracted from JSONL line 182 (the brief of the nine /execution research dossiers), line 19: "An optional /frontend skill does not exist yet; until it does, /execution builds a simple UI and /frontend runs later as its own pass."
  - Verification, 2026-09-30, after 20:06Z: the same JSONL parsed again with Python (utf-8). Owner-typed records: line 11 and line 161 only; every later user-type record is a tool result or a task notification. The workflow script (222 lines, `meta.phases[0]`: "9 dimensions") spawned nine research agents plus three verifiers, which is the "12/12 agents" of line 216.
- **Limits / false positives:** The owner may have answered elsewhere: another session, or out loud. "je passe frontend avant" can also mean "I will build the frontend skill first".

### FD13-F02 — /frontend must leave `disable-model-invocation` unset or /execution cannot call it; /harden sets it, so only the owner starts /harden

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (skills.md re-fetched 2026-09-30, 100,566 bytes: lines 376, 515 and 543 verbatim; `when_to_use` is a documented field, line 373; harden SKILL.md line 5 sets the flag, hackathon and prose frontmatter do not; the R5 refusal text is verbatim in cc-skills-hooks.md Appendix A line 1014, and that dossier's own verifier confirmed it against the 2.1.286 binary)
- **Claim:** The official skills page makes a skill with `disable-model-invocation: true` user-only, and Claude's Skill-tool call to it is refused. /harden sets the flag. /hackathon and /prose do not. The /execution research agent reproduced the refusal in a headless run on Claude Code 2.1.286.
- **Implication for /frontend:** Do not put `disable-model-invocation: true` in /frontend's frontmatter. To stop it firing in unrelated sessions, use a narrow `description` and `when_to_use` instead. The hand-over from /frontend or /execution to /harden stays a manual task: the owner types `/harden`.
- **Evidence:**
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills.md) — Anthropic, raw Markdown fetched 2026-09-30T19:35Z, accessed 2026-09-30 — official docs.
    - line 376: "Set to `true` to prevent Claude from automatically loading this skill. Use for workflows you want to trigger manually with `/name`."
    - line 515: "**`disable-model-invocation: true`**: Only you can invoke the skill."
    - line 543: "| `disable-model-invocation: true` | Yes | No | Description not in context, full skill loads when you invoke |"
  - [harden SKILL.md](C:/Users/Utilisateur/.claude/skills/harden/SKILL.md) — owner, 2026-09-30, accessed 2026-09-30 — line 5: "disable-model-invocation: true".
  - [cc-skills-hooks.md](C:/Users/Utilisateur/.claude/skills/execution/research/cc-skills-hooks.md) — /execution research agent, 2026-09-30, accessed 2026-09-30 — Appendix R5, an executed headless run: "Skill manualonly cannot be used with Skill tool due to disable-model-invocation. Ask the user to run /manualonly themselves — it cannot be invoked via the Skill tool."
- **Limits / false positives:** Another agent executed the refusal; I re-read the docs but did not rerun it. Claude Code auto-updated during that research, per that dossier's own F29.

### FD13-F03 — Inside a workflow agent or as a `context: fork` skill, /frontend has no Workflow and no AskUserQuestion, and a workflow agent has no `Agent` either; it keeps Skill, Bash, Edit, Write, Artifact and MCP tools

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Every subagent except a fork of the current conversation loses `AskUserQuestion` and `Workflow`, even when they are listed in its tools; forks "skip both filters". A `context: fork` skill is not such a fork: it runs as a regular subagent, in the background by default, with the narrower background tool set, and without the conversation history. `background: false` restores the full tool set but not `AskUserQuestion` or `Workflow`. A regular background subagent keeps every MCP tool, plus a fixed list of built-ins that includes `Skill`, `Bash`, `Edit`, `Write` and `Artifact`, and keeps `Agent` until the nesting depth limit, three layers below the main conversation. A workflow agent is different: the 2.1.286 binary defines it as `workflow-subagent` with `tools:["*"]` and `disallowedTools` Agent, Workflow and SendUserMessage, spawned in the foreground, so it keeps the full built-in set (including `Skill`, `Artifact` and `PushNotification`) but can never spawn a subagent. The workflows page states the user-facing consequence: "No mid-run user input". (corrected: forks exempted; workflow agents are foreground and have no `Agent`, so "fan out through nested `Agent` calls" was wrong; `background: false` noted)
- **Implication for /frontend:**
  - Invoked by the /execution orchestrator in the main thread, between waves, /frontend keeps its full powers. It can launch its own Workflow, for example one agent per customer reference site and one per screen. It can also ask the owner which reference sites to follow, or whether the logo is approved.
  - Invoked inside a wave's `agent()` call, it has neither, and it cannot fan out at all. It must then run in a non-interactive mode: write each question to a manual-task file and stop with an "awaiting input" status (this is /execution's decision 2, propose and wait). Any per-site or per-screen fan-out, and any independent checker, must be separate `agent()` calls in /execution's script, not nested calls inside /frontend. (corrected: no nested `Agent` inside a workflow agent)
  - Avoid `context: fork` for a task that has questions to ask.
- **Evidence:**
  - [Create custom subagents](https://code.claude.com/docs/en/sub-agents.md) — Anthropic, raw Markdown fetched 2026-09-30T19:35Z, accessed 2026-09-30 — official docs.
    - lines 424-433: "The first filter removes these tools, even when listed in the `tools` field:" followed by a list that includes "`AskUserQuestion`" and "`Workflow`".
    - line 435: "a background subagent keeps every MCP tool but only these built-in tools: `Read`, `Grep`, `Glob`, `LSP`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage`, and `Artifact`"
    - line 1011: "By default, a subagent can spawn subagents of its own, up to three layers below the main conversation."
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills.md) — Anthropic, fetched 2026-09-30T19:35Z, accessed 2026-09-30 — lines 721 and 736.
    - "Claude Code starts a new subagent of the type set in the `agent` field and gives it the skill content as its prompt. The subagent doesn't see your conversation history, so the skill's instructions have to stand on their own."
    - "A backgrounded fork also runs with the narrower tool set that applies to background subagents" (link markup removed).
  - [Orchestrate subagents at scale with dynamic workflows](https://code.claude.com/docs/en/workflows.md) — Anthropic, fetched 2026-09-30T19:36Z, accessed 2026-09-30 — line 13: "A dynamic workflow is a JavaScript script that orchestrates many [subagents](/docs/en/sub-agents) at once."
  - Added at verification, all accessed 2026-09-30:
    - [Create custom subagents](https://code.claude.com/docs/en/sub-agents.md), re-fetched about 20:10Z — line 424: "[Forks](#fork-the-current-conversation) skip both filters and receive the main conversation's exact tool pool."
    - [Extend Claude with skills](https://code.claude.com/docs/en/skills.md), re-fetched about 20:10Z — line 736: "If your skill's steps depend on a tool outside that set, set `background: false` to keep the full tool set."
    - [Orchestrate subagents at scale with dynamic workflows](https://code.claude.com/docs/en/workflows.md), re-fetched about 20:10Z — line 362: "| No mid-run user input | A run pauses on its own only for agent permission prompts and a [usage-limit wait](#when-a-run-hits-your-usage-limit). For sign-off between stages, run each stage as its own workflow |".
    - Claude Code 2.1.286 binary (`~/.local/bin/claude`, 245,092,000 bytes), `grep -a` — OBSERVED: `{agentType:"workflow-subagent",whenToUse:"Internal subagent for workflow script orchestration.",tools:["*"],disallowedTools:[kp,_t,Jd],…}`, with `_t="Agent"` and `Jd="Workflow"` each defined once; `kp` is defined twice in the bundle (`"SendUserMessage"` and `"mariadb"`), so its value here is the other verifier's reading.
    - This verification ran as a workflow agent. Its tool list has `Skill`, `Bash`, `Edit`, `Write`, `Artifact` and deferred MCP tools, and `ToolSearch` with `select:Agent,AskUserQuestion,Workflow,Task` returned "No matching deferred tools found" — OBSERVED.
    - [cc-skills-hooks.md](C:/Users/Utilisateur/.claude/skills/execution/research/cc-skills-hooks.md), its Verification section appended at 22:03 Paris, after this dossier was written — F21 verdict: "partly-true; the workflow-agent and push parts are refuted", and "Missed" item 3: "Workflow agents cannot use the Agent tool. A wave agent cannot spawn its own verifier, so the independent proof check must be a separate `agent()` call in the script".
    - Executed probe, 2026-09-30, from this workflow agent: `Skill("json-canvas")` returned "Launching skill: json-canvas" followed by the skill's content, so a workflow agent can load a model-invocable skill — OBSERVED.
- **Limits / false positives:** The workflows page still does not list a workflow agent's tools; the tool set above comes from the binary and from this session's own tool list, on 2.1.286 only. The binary auto-updates. The Skill probe loaded a plain skill; a `context: fork` skill called from a workflow agent was not tested.

### FD13-F04 — After compaction only the first 5,000 tokens of each invoked skill return, inside 25,000 tokens for all skills together

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (the claim holds; one attribution in the limits is fixed. skills.md line 556 verbatim on the page re-fetched 2026-09-30; the same page's troubleshooting section, line 1140, now states the implication directly: "After [compaction](/docs/en/how-claude-code-works#when-context-fills-up), Claude Code [can keep only the start of an invoked skill](#skill-content-lifecycle), so put the most important instructions near the top of `SKILL.md`." cc-skills-hooks.md's own verifier reports that section appeared after the 18:59Z snapshot)
- **Claim:** Auto-compaction re-attaches the most recent invocation of each skill, but keeps only its first 5,000 tokens. All re-attached skills share a budget of 25,000 tokens, filled from the most recently invoked, so older skills can drop out entirely.
- **Implication for /frontend:** Loaded into /execution's orchestrator, /frontend competes with /execution (and possibly /hackathon) for that budget during a 36-hour event where compaction is certain. Put its standing rules in its first 5,000 tokens:
  - the never-show deny-list rule;
  - never invent copy, numbers or URLs;
  - the proof command;
  - the list of tells.
  Keep procedures in reference files. Invoking /frontend late, after /execution, can push /execution's own re-attached text out (inference from the fill order).
- **Evidence:**
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills.md) — Anthropic, fetched 2026-09-30T19:35Z, accessed 2026-09-30 — line 556: "When the conversation is summarized to free context, Claude Code re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each. Re-attached skills share a combined budget of 25,000 tokens. Claude Code fills this budget starting from the most recently invoked skill, so older skills can be dropped entirely after compaction if you have invoked many in one session."
- **Limits / false positives:** Real SKILL.md token counts were not measured. /execution may re-read its state from disk through a SessionStart hook, which the /execution research recommends (cc-skills-hooks F16 and its implications: "Use a settings SessionStart hook with matcher `compact|resume|startup|clear`"), making the skill text less critical; no /execution design decision records it yet. (corrected: a research recommendation, not a plan of the design session)

### FD13-F05 — Phase A outputs exist in every workspace, but under different names; /frontend needs discovery globs and a fallback for each input

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Five workspaces were listed: BNB (`Documents/Coding/BNB`), TOKEN2049 (`Documents/Documents Perso/token2049`), Hedera (`Documents/Coding/Hedera`), Ledger (`Documents/Coding/Ledger Op3n`) and XRPL (`Documents/Coding/XRPL_Hackathon_2026`). They keep Phase A material in a `research/` tree, or for XRPL in a gitignored `docs/` tree. The only fixed names are /hackathon's templates in `assets/` (`claims.md`, `dx-journal.md`, `known-behaviour.md`, `expectations.md`, `findings-log.md`, `runsheet.md`, plus `preflight.sh` and `deck/`); wave numbering, lane names and design panels vary per event. The workspace root is not the product repository: BNB's code is in `holdover/` next to `research/`. (corrected: `dx-journal.md` was missing from the template list; two globs and one section reference in the table below were wrong)
- **Implication for /frontend:** Resolve inputs by glob from the workspace root, record the path found, and fall back as below. Never invent a missing input: this is /prose invariant 3, and /execution decision 2 says to propose, then wait.

  | Input | Observed paths | Glob (from the workspace root) | Fallback when absent |
  |---|---|---|---|
  | Rubric, format, deliverables | BNB, TOKEN2049, Ledger: `research/findings/rubric.md`; Hedera: `research/findings/wave1/01-rules-rubric.md`; XRPL: `docs/03-RULEBOOK.md` | `research/findings/**/*{rubric,rules}*.md`, `docs/*RULEBOOK*.md` | Ask for the rulebook, and whether a live URL, a video (with its length cap) or slides (with their format) are required. Do not assume a live stage |
  | Sponsor map, customers | BNB `research/findings/wave1/l5-customers.md`; TOKEN2049 `research/findings/wave1/cardano-1-sponsor.md` (one `*-1-sponsor.md` per sponsor); Hedera `research/findings/wave1/08-sponsor-strategy-judges.md`; Ledger `research/findings/wave0/strategy-customers.md` | `research/findings/**/*{customer,sponsor,strategy}*.md` | Propose 3-5 customers from the sponsor's own case-study or ecosystem pages, with sources, and ask |
  | Customer URLs | none recorded (F06) | none | Resolve, source and confirm each URL (F06) |
  | Use cases | BNB l5 §6.0 "Three business use cases"; Ledger `strategy-customers.md` §6 | inside the customer file | Ask in /hackathon step 4 form: a named institution, a thing, an amount |
  | Gap, exit test, two sentences | TOKEN2049 `research/findings/wave3/_recommendation.md` §2.1.1-2.1.4; BNB `research/design/SPEC.md` §1; Hedera `research/findings/PHASE-A-DECISION.md`; XRPL `docs/00-DECISIONS.md`, `docs/40-PITCH.md` | `research/**/{_recommendation,SPEC,PHASE-A-DECISION}.md`, `research/findings/**/_summary.md`, `docs/*{DECISIONS,PITCH}*.md` | Required. Without it, write no hero copy and ask |
  | Spec or PRD | same as the row above | same | /execution should not have started |
  | Feature catalogue | BNB `research/FEATURE-CATALOGUE.md`; XRPL `docs/20-SPEC-FRONTEND.md` §3 ("The screens": a pre-build screen spec, not a catalogue enumerated from code) | `research/FEATURE-CATALOGUE.md`, `docs/*SPEC*FRONTEND*.md` | Enumerate from the code and the spec into the same shape (F08), then ask which rows must be judge-visible |
  | Claims ledger | Hedera `research/findings/claims-ledger.md` | `research/**/claims*.md` | Render no number not traceable to an artifact file; open one from `assets/claims.md` |
  | Never-show lists | TOKEN2049 `wave2/_summary.md` §5 and `_recommendation.md` §3; BNB `wave1/_summary.md` §2 and §4, `design/SPEC.md` §8, `holdover/scripts/redact-check.mjs` | `research/findings/**/_summary.md` sections headed "do not carry", "do-not-carry" or "Private"; `**/redact-check.*` | Ask "what must the page never say, or not before a date?". Until answered, render nothing marked private or undisclosed |
  | Judges, judge's path | Hedera `08-sponsor-strategy-judges.md`; BNB `research/design/p1-judge-first.md` §1; Ledger `rubric.md` §3 | `research/**/*{judge,judges}*.md`; Ledger's §3 is reached only through the rubric glob | Ask; use /hackathon `00-rubric.md` questions |
  | Storyboard, video script | TOKEN2049 `_recommendation.md` §2.1.5; BNB `p1-judge-first.md` §3; Hedera `research/findings/VIDEO-SCRIPT.md`; XRPL `docs/45-RUNSHEET.md` | `research/**/*{VIDEO,SCRIPT,runsheet,RUNSHEET}*.md`, `docs/*{RUNSHEET,runsheet,SCRIPT}*.md` (corrected: the `research/` glob alone returned nothing in the XRPL workspace, tested with bash `globstar`) | /frontend defines the screens; the script is written later, after /harden |
  | Name and naming study | BNB `research/design/naming/_verdict.md`; TOKEN2049: none ("rename required") | `research/design/naming/_verdict.md` | The logo task is blocked, as a manual task |
  | Data contract, fixtures | XRPL `docs/01-API-CONTRACT.md` + `fixtures/`; BNB `holdover/data/` | `docs/*API-CONTRACT*.md`, `**/fixtures/**`, `**/data/**` (corrected: `data/**` from the workspace root matched 0 files in BNB, whose data sits in `holdover/data/`) | Required before building screens (F20) |
  | Team, presence | memory files; Ledger `rubric.md` §4 (lines 174-176: "Eli carries the build 6-11 Oct"); TOKEN2049 `_recommendation.md` P5 | memory | Ask whether dev B builds UI; default solo |

- **Evidence:**
  - Directory listings run 2026-09-30 (`ls`, `find -maxdepth 2`) of the five workspaces, the paths as quoted in the table — OBSERVED.
  - [00-rubric.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/00-rubric.md) — owner's /hackathon skill, accessed 2026-09-30 — line 14: "Extract, into one file:"; lines 16-18 list "The scoring rubric, with weights", "The format" and "The deliverables".
  - Verification, 2026-09-30: the 39 workspace paths tested from this table and from the evidence of F06-F31 all exist (`test -e`). `ls -R ~/.claude/skills/hackathon/assets` lists `claims.md`, `deck/`, `dx-journal.md`, `expectations.md`, `findings-log.md`, `known-behaviour.md`, `preflight.sh`, `runsheet.md`. Ledger `rubric.md` §10 (line 368) is "Organiser answers (Antoine M, Telegram DM …)"; the team sentence is in §4, lines 174-176. Glob tests with `bash -O globstar -O nullglob` from each workspace root: `research/**/*{VIDEO,SCRIPT,runsheet,RUNSHEET}*.md` in XRPL printed nothing although `docs/45-RUNSHEET.md` exists; `data/**` in BNB counted 0 files.
- **Limits / false positives:** Sampled one event per shape; a future event may use new names, which is why these are globs and fallbacks rather than fixed paths. Globs are case-sensitive in bash but not in Windows tools; the skill should state which matcher it uses.

### FD13-F06 — None of the customer tables records a website, and /hackathon's method never asks for one

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (re-checked 2026-09-30: BNB l5 lines 459-460 verbatim, and its 20 URL hosts are docs, press, RPC, API, a research page, blog posts and `dashboards.gauntlet.xyz/`, no customer homepage; `cardano-1-sponsor.md` line 97 verbatim and 0 `http(s)://` URLs, only bare hostnames such as `api.sokosumi.com/v1/agents`; Ledger lines 119, 187, 194 as quoted, and §2 adds only `help.multisig.ledger.com` and `prnewswire.com`; Hedera line 85 and /hackathon lines 111-114 verbatim; `api.llama.fi/protocol/<slug>` re-queried about 20:15Z returned the same four `url` values)
- **Claim:** No customer table in the four events has a website column.
  - BNB's customer table has the columns customer / evidence of size / what they publicly say. Its URLs point to docs, APIs and press.
  - TOKEN2049's Cardano customer table has the columns Name / Segment / What they do / Money scale / Rung, and the whole file contains no http(s) URL.
  - Hedera's "customer" is a developer segment.
  - Ledger's customer section links newsroom, blog and help pages, not homepages.
  - /hackathon step 3 asks for customers but not for their sites.
  DefiLlama's protocol endpoint returns a `url` field for DeFi customers, but it can point at an app route rather than a marketing homepage.
- **Implication for /frontend:** The input contract needs a reference-sites table with these columns: customer | official URL | how verified (sponsor page, DefiLlama `url`, GitHub org) | marketing site or app | confirmed by the owner (yes or no). Owner confirmation is load-bearing: in crypto a search result can be a lookalike domain (inference). Propose that /hackathon's step 3 gain an "official URL (source)" column.
- **Evidence:**
  - [l5-customers.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/findings/wave1/l5-customers.md) — owner's BNB Phase A, 2026-09-22, accessed 2026-09-30 — lines 459-460: "**Customers — current and targeted.**" / "| customer | evidence of size | what they publicly say / complain about |". A domain count of every URL in the file lists docs, press and RPC hosts, and no customer homepage.
  - [cardano-1-sponsor.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave1/cardano-1-sponsor.md) — owner's TOKEN2049 Phase A, 2026-09, accessed 2026-09-30 — line 97: "| Name | Segment | What they do with the technology | Money scale (source) | Rung |". Command: `grep -o -E "https?://..." cardano-1-sponsor.md` returned nothing.
  - [strategy-customers.md](C:/Users/Utilisateur/Documents/Coding/Ledger Op3n/research/findings/wave0/strategy-customers.md) — accessed 2026-09-30 — lines 119, 187 and 194 link `moonpay.com/newsroom/...`, `blog.thirdweb.com/...` and `help.enterprise.ledger.com/...`.
  - [08-sponsor-strategy-judges.md](C:/Users/Utilisateur/Documents/Coding/Hedera/research/findings/wave1/08-sponsor-strategy-judges.md) — accessed 2026-09-30 — line 85: "The real first customer is **the EVM hackathon developer who already knows scaffold-eth-2** and an **agent-driven builder**".
  - [01-find-the-gap.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/01-find-the-gap.md) — owner's /hackathon skill, accessed 2026-09-30 — lines 111-114: "### 3. Find their customers" / "Current and targeted. The credible use case is the one **their clients** already have, not the one you find interesting."
  - [DefiLlama protocol API](https://api.llama.fi/protocol/minswap) — DefiLlama, queried 2026-09-30T19:39Z, accessed 2026-09-30 — primary data. Command output:
    - `minswap url='https://minswap.org/'`
    - `lista-lending url='https://lista.org/lending'`
    - `venus-core-pool url='https://app.venus.io/#/core-pool'`
    - `liqwid url='https://v2.liqwid.finance/'`
- **Limits / false positives:** One customer file per event was sampled. Other files, such as BNB `wave0/landscape.md`, hold docs and API hosts that could be mapped to homepages. DefiLlama covers protocols only, not customers like "retail in Binance Wallet".

### FD13-F07 — The two sentences already exist upstream, and /prose requires them identical in the README, the form and the video; the hero is a fourth copy

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (05-pitch-craft lines 17-18, 04-pitch lines 12-16, `_recommendation.md` lines 149-150 and 153-154, and SPEC.md lines 34-35 re-read 2026-09-30; all quotes verbatim apart from line breaks)
- **Claim:** /hackathon defines the two sentences as "the thing that is broken, and what you did about it". /prose requires them to be identical in substance in the README's opening, the form's description field and the first thing said in the video, and it proposes a drift checker. TOKEN2049 has a fixed one-sentence pitch. BNB's spec fixes both the thesis and the "comprehension device on the fold".
- **Implication for /frontend:**
  - Read the two sentences, and any fold device, from one source file.
  - Never paraphrase them in the hero.
  - Include a hero-equals-source gate in the proof.
  - When /prose rewrites the README opening after /harden, re-render the hero from the same source instead of editing it by hand.
  - Any drift checker /prose builds should include the hero as its fourth location.
- **Evidence:**
  - [05-pitch-craft.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/05-pitch-craft.md) — accessed 2026-09-30 — lines 17-18: "The two sentences are not a tagline. They are: the thing that is broken, and what you did about it."
  - [04-pitch.md](C:/Users/Utilisateur/.claude/skills/prose/references/04-pitch.md) — owner's /prose skill, accessed 2026-09-30 — lines 12-16: "Then keep those two sentences identical in substance everywhere they appear: the README's opening, the submission form's description field, and the first thing said in the video." and "This is cheap to enforce. A checker can compare the three and fail when they drift."
  - [_recommendation.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md) — accessed 2026-09-30 — lines 153-154: "**"A deployed Cardano escrow validator accepts a negotiated exit its authors never built. We derive it from the bytecode, construct it so the second leg cannot be raced, and price the split."**"
  - [SPEC.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/design/SPEC.md) — accessed 2026-09-30 — lines 34-35: "The comprehension device on the fold stays the nine characters that teach the unit: `1 SPYB = 1.00172979 shares`".
- **Limits / false positives:** The two sentences change during the event: TOKEN2049 prices a wording change at 0.40 of weighted score (lines 149-150). The source file must be the single editable copy.

### FD13-F08 — The BNB feature catalogue is the ready-made shape of /frontend's coverage input, and it is written from the code after the build

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (lines 3-7, 11-13 and 138-139 verbatim, re-read 2026-09-30. The file is kept as a live checklist: surfacing items 1 and 2 are now struck through and marked "DONE 2026-09-30" (the guard) and "DONE 2026-09-25" (a proof section), and the BNB memory of 30 Sept says the rest of that list "turned out to be **position and prominence, not absence**", which supports the coverage gate proposed here)
- **Claim:** On 2026-09-25 the owner's BNB project enumerated every feature from the code into `FEATURE-CATALOGUE.md`. Its stated purpose is to decide what the frontend shows. Each row says what the feature is, where it lives, and whether a judge can see it today, marked SHOWN, HIDDEN or CLI. The catalogue's conclusion was that the page showed the measurement and hid the proof. It ended with an ordered list of what to surface, and a list of what not to put on the page.
- **Implication for /frontend:** The coverage input is a catalogue in this shape, built by enumerating code. That makes it an /execution-time artifact, not a /hackathon one, and /frontend's coverage pass depends on the features existing. A proposed coverage gate: no row stays HIDDEN without a written decision, and every row marked for the page has a rendered element.
- **Evidence:**
  - [FEATURE-CATALOGUE.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/FEATURE-CATALOGUE.md) — owner's BNB project, written 2026-09-25, accessed 2026-09-30.
    - lines 3-7: "Written 2026-09-25 by enumerating the code, not from memory." and "Purpose: decide what the frontend should surface. So each entry says **what it is**, **where it lives**, and — the column that actually decides the frontend — **whether a judge can see it today**."
    - lines 11-13: "**[SHOWN]** the web page already renders it" / "**[HIDDEN]** it exists, works, and nothing on the page shows it" / "**[CLI]** it is a command-line or API surface and arguably belongs nowhere else".
    - lines 138-140: "**The page shows the measurement and hides the proof.** Everything in §5 marked HIDDEN is evidence a judge would find persuasive, and none of it is reachable from the URL."
- **Limits / false positives:** One project. A catalogue written by the agent that built the code can miss what it forgot to build. F09 is the check that catches that.

### FD13-F09 — A panel the spec described but the web app lacked is the failure that created the completion rule; the existing gate checks source text, not the rendered page

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (TASKS.md lines 8-9 and 36, completion-check.mjs lines 113-116 (`ok: markers.length > 0`, so any one of the three strings passes) and CLAUDE.md line 91 re-read 2026-09-30. Side note: completion-check.mjs line 8 says "five TODO markers" where TASKS.md line 9 says "ten deferral markers"; the owner's own sources disagree on that count)
- **Claim:** BNB's 24 Sept audit found the spec's A4 panel missing from the web app while 920 tests were green. The gate added for it, G1.A4, passes if the web app's source files contain any of three strings.
- **Implication for /frontend:** Check coverage on the rendered DOM, in frozen-data mode, instead of by grepping source. For example: each catalogue feature id maps to an element carrying `data-feature="<id>"` that is visible after navigation. A source grep passes on a string in a comment, a test fixture or unreachable code (inference).
- **Evidence:**
  - [TASKS.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/TASKS.md) — owner's BNB plan, 2026-09-24, accessed 2026-09-30.
    - lines 8-9: "the A4 panel the spec describes was not in the web app, there was no deploy, and ten deferral markers sat in pages a judge reads."
    - line 36: "| **G1.A4** | the A4 red-board panel is rendered by a surface, not only stored in docs | OPEN — `apps/web` names none of SOXSB / KLACon / scaleui |"
  - [completion-check.mjs](C:/Users/Utilisateur/Documents/Coding/BNB/holdover/scripts/completion-check.mjs) — owner's BNB repo, accessed 2026-09-30 — lines 113-116: "const web = walk('apps/web/src').map((f) => read(f) ?? '').join('\n');" and "const markers = ['SOXSB', 'KLACon', 'scaleui'].filter((m) => web.includes(m));"
  - [CLAUDE.md](C:/Users/Utilisateur/.claude/CLAUDE.md) — owner's global rules, accessed 2026-09-30 — line 91: "**Completeness is proven against the plan, never against the test suite.**"
- **Limits / false positives:** A DOM check also needs the data states that make a panel appear. An empty state may legitimately hide a panel.

### FD13-F10 — Claims ledgers use two status vocabularies; the one real ledger lives in the private research workspace, not in the product

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** /hackathon's ledger uses the statuses verified, unverified and cut. Hedera's ledger uses backed, re-verify and do-not-claim, and its line 8 itself says a re-verify row "is `unverified` in the skill's sense". Hedera's ledger sits in `research/findings/`; its header sentence (line 4) lists where claims appear as README, AGENTS.md, outro, submission and DX survey, and says the file "moves into" the template repository once that exists. It has not moved: the template repository tracks no claims or ledger file. The UI is missing from the header sentence but not from the table: the column is headed "claim, as it will be said or shown", and rows A4 ("README cost table, UI preview") and A22 ("cost table; UI cost preview copy") already name the UI as a location, in 2 of 84 rows. (corrected: the UI does appear in two rows; the re-verify/unverified mapping is partly the source's own; the planned move into the repository added)
- **Implication for /frontend:**
  - Parse both vocabularies: verified is backed, unverified is re-verify, cut is do-not-claim.
  - Render a number, a superlative or a comparison only when its row is verified or backed.
  - Tag each rendered number with its ledger id in a data attribute, so the T-6h audit can trace it (F24).
  - Make "web page" a standard value of the ledger's "where it appears" column, where Hedera used ad hoc "UI preview" labels.
  - Read the ledger from wherever it lives: /hackathon says "Keep it in the repository, not in someone's head" (03-claims-ledger.md line 32), and Hedera planned to move it into the product repository.
- **Evidence:**
  - [03-claims-ledger.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/03-claims-ledger.md) — accessed 2026-09-30 — line 30: "- **Status** — `verified`, `unverified`, `cut`. Nothing ships as `unverified`."
  - [claims-ledger.md](C:/Users/Utilisateur/Documents/Coding/Hedera/research/findings/claims-ledger.md) — owner's Hedera project, started 2026-09-21, accessed 2026-09-30.
    - line 4: "One table of every claim the README, AGENTS.md, the `template.json` outro, the submission text or the DX survey is LIKELY to make, and what backs it today."; same line: "When the template repository exists, this file moves into it (or is mirrored there)".
    - lines 7-9: "- **backed** —", "- **re-verify** —", "- **do-not-claim** —"; line 8 continues: "Until then it is `unverified` in the skill's sense, and nothing ships as `unverified`."
    - line 25 (table header): "| # | claim, as it will be said or shown | where it appears | current backing | rung | status |"; row A4, where column: "README cost table, UI preview"; row A22: "cost table; UI cost preview copy".
  - Verification, 2026-09-30: `git ls-files | grep -i -E "claim|ledger"` in `Hedera/scaffold-hbar-saucerswap-v2` (HEAD 8de47d0, 2026-09-30 15:53 +0200) printed nothing; `find -maxdepth 4 -iname "*claims*"` found ledgers in no other workspace.
- **Limits / false positives:** BNB, TOKEN2049, Ledger and XRPL have no ledger file, since TOKEN2049 and Ledger have not started. The verified↔backed and cut↔do-not-claim pairings are mine; re-verify↔unverified is stated in Hedera's line 8.

### FD13-F11 — Four kinds of "never show" input exist upstream; only the never-public kind is checked by a script, and only in files

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** The upstream material defines four kinds of content the public surfaces must not carry:
  - **do-not-carry:** claims that were refuted or are already public (TOKEN2049 wave-2 §5, recommendation §3.1; BNB wave-1 §2);
  - **undisclosed security matters:** "none may be demoed, published or exploited" (TOKEN2049 §3.2);
  - **never-public:** material for a private report to the sponsor (BNB wave-1 §4, SPEC §8);
  - **date-bound embargo:** findings held "until after the submission (2026-10-11 12:00 UTC)" (BNB memory).
  TOKEN2049 adds a default naming rule for counterparties. BNB's `redact-check.mjs` hashes the never-public deny-list and scans text: by default every file git would carry (tracked plus untracked, not ignored), or one file or folder given as an argument, such as a video script or a slide export. Images, PDFs, video, audio and fonts are read as bytes and only their names are checked, so text inside a screenshot or a PDF export is invisible to it. No hook or code path scans commit messages, although its header names "a commit message" among what it guards. It has no notion of dates; a grep for date, until, embargo or hold finds no such logic. (corrected: it does not scan commit messages, and binary exports are checked by file name only)
- **Implication for /frontend:**
  - Take a machine-readable never-show list with four classes and an optional `until` date.
  - Keep its plaintext outside the repository, as redact-check does.
  - Scan the rendered text of every page before each publish or deploy, not only the source.
  - Run the project's own redaction script when one exists.
  - Also apply the counterparty naming rule to on-page labels.
- **Evidence:**
  - [wave2/_summary.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave2/_summary.md) — accessed 2026-09-30 — line 607: "## 5. Cross-wave do-not-carry list (compiled)".
  - [_recommendation.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md) — accessed 2026-09-30.
    - line 436: "### 3.2 The undisclosed security items — none may be demoed, published or exploited"
    - lines 476-477: "**Default, until the organiser answers:** name the **deployment and the script hash**, not the platform, on any slide that carries a number."
  - [wave1/_summary.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/findings/wave1/_summary.md) — accessed 2026-09-30 — line 36: "## 2. Do not carry forward (refuted or already public)"; line 70: "## 4. Private matters — never in the repo, pitch or public channels".
  - [bnb_redaction_and_publication.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur-Documents-Coding-BNB/memory/bnb_redaction_and_publication.md) — owner memory, 2026-09-23, accessed 2026-09-30.
    - lines 15-16: "`scripts/redact-check.mjs` must run **locally** before publishing anything and **before recording the demo video**"
    - line 19: "**Hold until after the submission (2026-10-11 12:00 UTC):** the sponsor API unit findings"
  - [redact-check.mjs](C:/Users/Utilisateur/Documents/Coding/BNB/holdover/scripts/redact-check.mjs) — owner's BNB repo, accessed 2026-09-30 — lines 7-8: "This script is the mechanical guarantee that they never leak into the repository, a commit message, a slide or a demo video, whoever is typing and however late it is." Command: `grep -n -i -E "date|until|embargo|hold|2026-10-11" redact-check.mjs` matched only incidental substrings: the `HOLDOVER_` variable names, `update(`, `hexCandidates`, an "Ex-Date" example, "withhold", a `new Date()` timestamp and one probe date. It found no embargo or date-window logic.
  - Verification, 2026-09-30 — redact-check.mjs lines 52-54 (USAGE): "check every file git would carry (tracked + untracked, honouring .gitignore)" and "check one file or one folder — the pre-video pass over a script, a slide export, a screenshots directory"; lines 86-91: "/** Read as bytes, not text. Their names are still checked. */" over `.png` … `.pdf` … `.mp4` … `.woff2`; line 270 runs `git ls-files --cached --others --exclude-standard -z`, its only git call. The repo has no `.githooks/` or `.husky/` folder, no `core.hooksPath`, and no non-sample hook in `.git/hooks`; `.github/workflows/ci.yml` runs it on the tree ("nothing in the tree names private-disclosure material").
- **Limits / false positives:** I did not open the deny-list, which lives outside the repository, by rule. redact-check does not fetch the served HTML; it would scan it only if a saved copy were passed as a path, which was not tested. Data-driven text that is not in a committed file is outside its reach.

### FD13-F12 — The live BNB board already renders the sponsor-API unit findings that the BNB memory says to hold until 11 Oct 12:00 UTC

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (the claim holds; the limits misread the chronology, see below)
- **Claim:** `GET https://holdover.fly.dev/` returned HTTP 200 and 1,080,326 bytes at 2026-09-30T19:44:49Z. The page states that `/rwa/price.tokenPrice` returns per share where it is documented per token, that `referencePrice` is converted once too often, and that `/rwa/tokens.tokenPrice` on an Ondo token returns price × m. The BNB memory, dated 23 Sept, says to hold exactly these findings until after the submission. The never-public terms I searched for had 0 hits: diamond, Permit2, hot key / hot-key / hotkey, ISSUER_ROLE, upgrade path.
- **Implication for /frontend:** A memory note is not enforcement, and the public frontend is where a date-bound hold leaks first. /frontend's publish gate must compare rendered text with the embargo list and its dates. This is also a question for the owner: was the hold lifted after 23 Sept, or is the board ahead of the plan?
- **Evidence:**
  - [Holdover board](https://holdover.fly.dev/) — owner's deployed BNB project, fetched 2026-09-30T19:44:49Z, accessed 2026-09-30 — the rendered HTML, tags stripped: "/rwa/price.tokenPrice is documented per token and returns per share : on SOXSB (m = 1.009026) that is −89.9 bp against fair value per token. referencePrice on the same call is converted once too often, which is −179.7 bp . One endpoint, two fields, both wrong, in opposite directions." and "/rwa/tokens.tokenPrice on an Ondo token returns price × m where the schema says per token: KLACon ×10.03 (+902 %)".
  - [bnb_redaction_and_publication.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur-Documents-Coding-BNB/memory/bnb_redaction_and_publication.md) — owner memory, file mtime 2026-09-23 12:07 +0200, accessed 2026-09-30 — lines 19-21: "**Hold until after the submission (2026-10-11 12:00 UTC):** the sponsor API unit findings — one endpoint divides bStocks by the share ratio, another multiplies Ondo by it, the identity holding on 442/442 and 77/77 rows."
  - Verification fetch, 2026-09-30T20:12:31Z: HTTP 200, `text/html; charset=utf-8`, 1,082,542 bytes (the page carries live data, so the size moves). After stripping tags, both quoted passages are present verbatim, followed by "measured 2026-09-22, keyed, 77 bStocks" and "measured 2026-09-22, keyed, 52 Ondo tokens". diamond, Permit2, hot key, hot-key, hotkey, ISSUER_ROLE and upgrade path: 0 hits in the HTML and in the text.
  - The BNB memory folder (`MEMORY.md`, `bnb_redaction_and_publication.md` 2026-09-23 12:07, `devex_report_written_by_alexandre.md`, `project_bnb_holdover.md` modified 2026-09-30) has no note that lifts the hold.
- **Limits / false positives:** The hold may have been lifted in a session I did not read. The 22 Sept design panel had put the `/rwa/price` deviation on the fold (`p1-judge-first.md` lines 58-59), but that panel predates the hold, written the next day (memory mtime 2026-09-23 12:07 +0200). A page that follows the panel follows the earlier plan; only a record dated after 23 Sept could show a deliberate later choice, and none was found. (corrected: the original said the panel suggested "a deliberate later choice", which inverts the order of the two documents)

### FD13-F13 — The event format decides /frontend's target surface, and the three upcoming events differ

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - **TOKEN2049 Origins:** deliverables are a repo, a project link (live URL or hosted demo) and .ppt or .keynote slides. Live demos are prohibited. The screen recording is embedded in the slides, and the Cardano track caps it at 3 minutes.
  - **Ledger OP3N:** the final is 5 minutes of pitch plus 5 minutes of Q&A, and a live demo is preferred. The submission includes a GitHub link and a short video.
  - **BNB:** the form requires a "Deployed link or judge-runnable instructions" ("A live URL is best"), and the repo, demo and deployed link must stay accessible through judging. The video is marked required on the form, but the page says optional and the organiser's judging slide of 24 Sept says "preferably a demo video under four minutes"; the owner treats it as required anyway. The owner's effort table reads the 20 % UX line as "A judge opens a live URL and understands in 30 s". (corrected: a live URL is the preferred form of a required "deployed link or judge-runnable instructions", and the video is "preferably", not required)
  - The winning XRPL spec shows what a live stage adds: system fonts only because of venue wifi, and a projector zoom that sets the effective width.
- **Implication for /frontend:** Take an event profile with these fields: judged surface (live URL, recording, stage); recording cap and resolution; stage zoom; hosting limits; the window the site must stay up; whether external requests are allowed; team. The output differs by event:
  - **Origins:** one static page, plus recording-ready frames.
  - **Ledger:** a live demo on the presenting machine (self-hosted fonts, tested at projector zoom) and a before/after screen pair (F27).
  - **BNB:** the first 30 seconds of a live URL, an always-up mode, and a frozen mode for takes.
- **Evidence:**
  - [TOKEN2049 rubric.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/rubric.md) — verified 2026-09-17 against the organiser API, accessed 2026-09-30.
    - line 22: "- Deliverables: GitHub repo (public or judge access); project link (live URL or hosted demo); presentation slides as a Google Drive link to a **.ppt or .keynote** file."
    - line 23: "**"Live demos are prohibited to avoid technical errors on stage. Use a screen recording and embed the video directly in your slides. Do not link to YouTube or external video."**"
    - line 34 (Cardano): "demo video ≤3 min".
  - [Ledger rubric.md](C:/Users/Utilisateur/Documents/Coding/Ledger Op3n/research/findings/rubric.md) — accessed 2026-09-30 — line 29: "> ✅ Drop your GitHub link + a short video"; line 380: "| 7 | Final format | **10 min max = 5 min pitch + 5 min Q&A**; slides free; **live demo preferred if possible**. |"
  - [BNB rubric.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/findings/rubric.md) — read 2026-09-22 from the hackathon page, accessed 2026-09-30 — line 23: "- "Your repo, demo and deployed link must stay accessible through judging." One entry per team."; line 37: "| **Demo video ≤ 4 min** | **yes (form)** | the page says "optional" — plan on it; check sharing settings |"; line 38: "| Deployed link or judge-runnable instructions | yes | "A live URL is best" |"; line 48: "| Product quality & UX | 20 % | A judge opens a live URL and understands in 30 s; ≤ 4 min video | 20 % |"; line 99 (Q2): "**ANSWERED by the judging slide**: *"preferably a demo video under four minutes"*. Preferred, not required -- and under 4 min. We treat it as required anyway".
  - [20-SPEC-FRONTEND.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/docs/20-SPEC-FRONTEND.md) — owner's XRPL project, 2026-09-12, accessed 2026-09-30 — lines 896-897: "Two families, both system — **no web fonts**. Venue wifi is a risk and a missing font on stage is a visible failure."; line 936: "The demo runs at 110–125% browser zoom on a projector, so 1440 at 125% ≈ 1150 effective — 1280 is not optional."
- **Limits / false positives:** BNB's "understands in 30 s" sits in the owner's "what full marks look like" column; it is his reading, not the organiser's wording. Ledger's official rubric was unpublished when its rubric file was written. TOKEN2049's rubric.md was verified on 17 Sept and does not carry the Cardano track's weights, which the organiser published by 24 Sept (F32).

### FD13-F14 — Phase A and the design panel already specify the judge's path, the fold and the video's shots

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (p1-judge-first lines 24-25, 45 and 119, `_recommendation.md` line 181, 04-pitch line 55 and 05-pitch-craft lines 207-209 re-read 2026-09-30, verbatim. Also relevant: p1-judge-first §3, lines 126-127, records the video as "Screen capture at 1920×1080, no face cam, subtitles burned in (judges may watch muted)", a third size the recording frames must fit)
- **Claim:**
  - BNB's design panel wrote the judge's path, about 8 minutes across four steps, and designed the fold at two viewports. It also added a `?frozen=1` mode so video takes are immune to network blips.
  - TOKEN2049's recommendation contains a shot-by-shot, 3-minute recorded demo and names "the single frame that carries the idea".
  - /prose requires that nothing is said that is not on screen while it is said.
  - /hackathon's demo practice is one switch into the browser, which then stays there for every beat.
- **Implication for /frontend:**
  - The screen list is the union of the fold spec and every "on screen" cell of the storyboard.
  - Every beat must be reachable inside the browser without leaving it.
  - Ship a frozen or replay mode for takes.
  - Design the fold at 1440×900 and 390×844, the two sizes the owner already used.
- **Evidence:**
  - [p1-judge-first.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/design/p1-judge-first.md) — owner's BNB design panel, 2026-09-22, accessed 2026-09-30.
    - lines 24-25: "A judge, in order: (1) opens the deployed link, (2) watches ≤ 4 minutes of video, (3) skims the README's first screen, (4) reads the DevEx report (a separate private form). They spend maybe 8 minutes total."
    - line 45: "### 2.1 Above the fold (1440×900 and 390×844, both designed)"
    - line 119: "- `?frozen=1` forces that mode — used for the video, so a network blip never ruins a take."
  - [_recommendation.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md) — accessed 2026-09-30 — line 181: "**The single frame that carries the idea:** the **7-redeemer × {buyer, seller, admin} reachability grid** at the current slot, two cells lit."
  - [04-pitch.md](C:/Users/Utilisateur/.claude/skills/prose/references/04-pitch.md) — accessed 2026-09-30 — line 55: "1. **Nothing is said that is not on screen while it is said.**"
  - [05-pitch-craft.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/05-pitch-craft.md) — accessed 2026-09-30 — lines 207-209: "What worked: slides for the framing, **one switch** into the browser, stay there for every demo beat, **one switch** back for the closing."
- **Limits / false positives:** The storyboards are pre-build plans and will change. /frontend has to re-read them at its run, not cache them.

### FD13-F15 — The logo has an upstream precedent (BNB `brand/`) but no upstream visual brief, and Origins has no name yet

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** BNB's repository already holds a complete brand set:
  - a mark whose 90° angle encodes a measured 2.99 h delay;
  - variants: dial, mono, yellow-stale;
  - a lockup (mark and wordmark);
  - a favicon with its colours baked in;
  - avatar PNGs rendered with headless Chromium;
  - a `preview.html` showing every size from 16 px, light and dark;
  - an explicit rule against borrowing ecosystem geometry, gradients or endorsement-like wordmarks, after one deliberate borrowing: "BNB yellow `#F0B90B` on the true hand only".
  The favicon is inlined in the server as a data URI, and a test fails if the inline copy drifts from `brand/favicon.svg`. By contrast, the naming study covers meaning, register, availability and French pronunciation, but gives no visual brief. A whole-word grep for logo, mark, glyph, icon, favicon, visual, colour, color, typeface, font and wordmark in the naming files matches "mark" in its trademark or name-as-mark sense, plus incidental "visual" (an npm package description, the "Gnomon School of Visual Effects" trademark holder) and "colour" (a naming category, and "Free pitch colour"); none of it is a visual brief. TOKEN2049's primary candidate must be renamed first. /hackathon puts the mark alone on the opening slide. (corrected: the grep does not match "only the trademark sense of mark"; the borrowed BNB yellow added)
- **Implication for /frontend:**
  - Produce the same file set and the inline-plus-drift-test pattern.
  - Derive the mark from the naming verdict's meaning, and from a measured number where the project has one.
  - Rasterise with headless Chromium, since ImageMagick, Inkscape and resvg are absent (per the brief).
  - Make the logo task depend on the name. For Origins it is blocked until the rename, which is a manual task.
- **Evidence:**
  - [brand/README.md](C:/Users/Utilisateur/Documents/Coding/BNB/holdover/brand/README.md) — owner's BNB repo, accessed 2026-09-30.
    - lines 3-5: "The mark is a clock caught in holdover: one hand on the truth, one still on the reference it should have left. The 90° between them is three hours on a 12-hour dial — the measured median delay between an on-chain corporate action and the Atlas feed that lends against it (2.99 h across 13 decidable activations, `data/incident_table.csv`)."
    - line 19: "Colours: ink `#0B0E14`, BNB yellow `#F0B90B` on the true hand only, paper `#FAFAF9`."
    - lines 21-22: "Nothing else is borrowed from the ecosystem: no borrowed geometry, no gradient, no wordmark that could read as an endorsement."
    - lines 10-17 list `mark.svg`, `mark-ring.svg` ("variant with a dial"), `mark-stale-yellow.svg`, `mark-mono.svg`, `lockup.svg`, `favicon.svg` ("colours baked in"), `avatar-ink.svg` → `avatar-ink-460.png` and `preview.html` ("every size from 16 px, light and dark, plus a PNG export"); `apps/web/test/brand.test.ts` line 17 compares `drawingOf(FAVICON_SVG)` with the file on disk (verified 2026-09-30).
    - line 28: "msedge --headless=new --window-size=460,460 --screenshot=brand/avatar-ink-460.png brand/avatar-ink.svg"
  - [brand.ts](C:/Users/Utilisateur/Documents/Coding/BNB/holdover/apps/web/src/brand.ts) — accessed 2026-09-30 — lines 7-8: "The markup is the same drawing as `brand/favicon.svg`, and `test/brand.test.ts` compares the two so the copy here cannot quietly drift from the source of truth."
  - [naming/_verdict.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/design/naming/_verdict.md) — 2026-09-23, accessed 2026-09-30 — section 2 ranks names on "(1) carries the propagation/lag story, (2) native to the BNB register ... (3) availability, (4) survives a French speaker saying it aloud next to a number, (5) survives the project outliving the hackathon" (lines 26-28); no visual criterion.
  - [_recommendation.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md) — accessed 2026-09-30 — lines 93-94: "**Rename before anything else.** `Accord` and `accordmesh` are both taken in this exact space".
  - [05-pitch-craft.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/05-pitch-craft.md) — accessed 2026-09-30 — line 196: "- **The opening slide is the mark alone.**"
- **Limits / false positives:** This is one precedent, made by an agent under the owner's direction. Its quality was not judged here.

### FD13-F16 — The proof /execution can consume offline is a command with an exit code and a JSON gate list; the owner's completion-check already fixes the shape

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - The owner's completion-check defines each gate as `(id, title, ifDropped, check)` returning `{ok, detail}`. It prints `{ok, gates}` with `--json`, exits 1 while any gate is open, and is kept out of CI on purpose.
  - In `--json` mode, the machine-readable mode, the build gate G4.build is not run but returns `{ ok: true, detail: 'skipped in --json mode; …' }`. The shape has no third state, so a skipped check is counted as passing, the "skipped check reported as ok" failure that /execution's local-past-builds dossier lists among past lenient proofs (summary item 2). (corrected: this caveat was missing and changes the implication)
  - Hedera's TASKLIST defines a tick as a satisfied proof column, "a command with exit 0 …".
  - /execution's Notion research recommends a repository file as the source of truth, because the completion check must run offline.
- **Implication for /frontend:**
  - Ship one command, for example `frontend-check --json`, in the completion-check shape, extended with a `skipped` state (or `ok: null`) that never counts as passing and is listed in the output.
  - It exits 0 only when every gate passes, never when a gate was skipped, and runs offline against a local build in frozen-data mode.
  - Its gates join /execution's build-phase completion check.
  - Write its receipt into the repository or /execution's run directory, never only into Notion.
- **Evidence:**
  - [completion-check.mjs](C:/Users/Utilisateur/Documents/Coding/BNB/holdover/scripts/completion-check.mjs) — accessed 2026-09-30.
    - lines 15-16: "DELIBERATELY NOT IN CI. This is red for most of a project's life, on purpose, and a job that is red by design teaches everyone to ignore red"
    - line 77: "const gate = (id, title, ifDropped, check) => {"
    - line 244: "process.stdout.write(`${JSON.stringify({ ok: open.length === 0, gates }, null, 2)}\n`);"
    - line 264: "process.exit(open.length === 0 ? 0 : 1);"
    - lines 152-156 (verified 2026-09-30): "`--json` skips it: a machine reading this wants the gate list, not a two-minute build." and "if (json) return { ok: true, detail: 'skipped in --json mode; run `pnpm typecheck && pnpm test`' };"
  - [local-past-builds.md](C:/Users/Utilisateur/.claude/skills/execution/research/local-past-builds.md) — /execution research agent, 2026-09-30, accessed 2026-09-30 — summary item 2: "lenient proofs (a forged evidence record accepted, a skipped check reported as ok, receipts matched by file name)".
  - [TASKLIST.md](C:/Users/Utilisateur/Documents/Coding/Hedera/research/findings/TASKLIST.md) — owner's Hedera plan, accessed 2026-09-30 — lines 3-4: "a box is ticked only when its **proof** column is satisfied (a command with exit 0, a transaction hash re-read on the mirror node, a green CI run, a link that resolves); "C" = Claude does it, "A" = Alexandre does it."
  - [notion-mcp.md](C:/Users/Utilisateur/.claude/skills/execution/research/notion-mcp.md) — /execution research agent, 2026-09-30, accessed 2026-09-30 — lines 42-43: "**Recommendation:** make a repository file the source of truth: git push acts as the compare-and-set, the completion check runs offline, a crash recovers from disk, and the history lives in git."
- **Limits / false positives:** /execution's architecture is not written yet, and the Notion recommendation is that dossier's, not a decision. Whether `frontend-check` belongs in CI once it is green is open (F21).

### FD13-F17 — The XRPL frontend precedent turns "done" into observable checks, a drop order and a never-drop list

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED (quotes verbatim; two line numbers were off by one, fixed below; the 21:00 gate at 20-SPEC lines 1084-1098 is a checklist of `- [ ]` observable behaviours, as claimed)
- **Claim:** The winning XRPL project's frontend task list defines DoD as something you can look at. It orders what to drop when late, lists what is never dropped, and sets a hard integration gate at a fixed time. The gate is a checklist of observable behaviours, with a planned fallback: "the operator page becomes the demo".
- **Implication for /frontend:** Return, per screen, a DoD, a drop order, a never-drop list and the fallback surface. /execution needs these to propose cuts and wait (its decision 2) when the frontend is behind.
- **Evidence:**
  - [21-TASKS-FRONTEND.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/docs/21-TASKS-FRONTEND.md) — owner's XRPL project, 2026-09-12, accessed 2026-09-30.
    - lines 22-23: "**DoD** = definition of done. It is a thing you can look at and check, not a feeling. If you cannot demonstrate the DoD, the task is not done."
    - line 29: "**Drop order if you are running late** — drop from the top of this list, in this order, and tell Alex which:" (corrected: was cited as line 30)
    - line 36: "**Never drop:** the NAV split, `navDivergenceBps`, the phase banner with its countdown ..." (corrected: was cited as line 37)
  - [20-SPEC-FRONTEND.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/docs/20-SPEC-FRONTEND.md) — accessed 2026-09-30.
    - line 1084: "## 9. The integration gate — Saturday 21:00"
    - line 1099: "**If that is not true at 21:00, the operator page becomes the demo** and the frontend is presented as a screenshot in the report rather than live on stage."
- **Limits / false positives:** This was written for a human dev B, not for an agent.

### FD13-F18 — The owner already has a DOM-level UI checker, but it is pasted into devtools and only prints; it cannot gate

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** XRPL's `app/tools/ui-audit.js` (308 lines, no imports) runs against the live DOM; DESIGN.md puts it at "Environ **70 vérifications**", while the file has 25 `record()` call sites, several inside loops, so the run-time count was not measured here. It prints PASS or FAIL together with the measurement that decided it. Its sections cover:
  - `rendering`: NaN, undefined, Invalid Date, [object Object] or null on screen;
  - `contrast`: the WCAG ratio of every rendered text colour;
  - `consistency`: one gap, one radius, at most two font families, one heading tracking;
  - `a11y`: a focus ring on every control;
  - `motion`, `layout`, `contract`, `polls` and `routes`.
  It is run from the devtools console, either by pasting the file (its header) or with `await import('/tools/ui-audit.js')` (DESIGN.md). (corrected: "about 70 checks" is DESIGN.md's figure, not a count)
- **Implication for /frontend:** Port it to a headless Playwright run that exits 0 or 1. Its `contrast` section measures tell 7 (low-contrast dark mode) and its `consistency` section's "one grid gap" and "one panel radius" checks measure tell 15 (inconsistent spacing). It does not measure tell 4 (Inter everywhere): "two font families, no more" caps the number of families at two, so a page set entirely in Inter passes; tell 4 needs a rule on the family name. Its project-specific selectors (`.panel`, `.grid12`, `table.tbl`) must become generic. (corrected: the font-count check was wrongly counted as a tell-4 detector)
- **Evidence:**
  - [DESIGN.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/DESIGN.md) — owner's XRPL project, 2026-09-12, accessed 2026-09-30.
    - lines 184-185: "Le balayage que je faisais à la main est devenu un script. Zéro dépendance, il tourne dans la page contre le vrai DOM et le vrai feed."
    - line 205: "| `consistency` | un seul tracking de label, un seul gap, un seul radius, deux familles de police max — en sautant proprement ce que l'écran ne contient pas |"
  - [ui-audit.js](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/app/tools/ui-audit.js) — accessed 2026-09-30.
    - line 8: "3. paste this whole file, then:  await uiAudit()" (corrected: was cited as line 7, which reads "2. devtools console")
    - line 137: "const BAD = /NaN|undefined|Invalid Date|\[object Object\]|\bnull\b/"
    - line 262: "record('consistency', 'two font families, no more', fams.length <= 2, fams.join(' / '))"
    - lines 253-259 (verified 2026-09-30): `oneOf('no tracking on labels', …)`, `oneOf('one tracking for headings', …)`, `oneOf('one grid gap', '.grid12,.stack', …)`, `oneOf('one panel radius', 'main .panel', …)`; line 219: `record('contrast', …, r >= 4.5, …)`.
  - [DESIGN.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/DESIGN.md) — line 194: "Environ **70 vérifications**, en sept sections."; line 189: "await import('/tools/ui-audit.js')".
- **Limits / false positives:** DESIGN.md says "sept sections" while its table lists nine. I did not run the script.

### FD13-F19 — Reference captures belong in the private research workspace; /frontend's screenshots are verification artifacts, and README screenshots come last

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (01-find-the-gap line 472, `_recommendation.md` lines 510-511, XRPL CLAUDE.md §1.2 (lines 28-29), 05-pitch-craft lines 189-190, the execution memory line 25 and CLAUDE.md line 104 re-read 2026-09-30; `git check-ignore -v` confirms XRPL's `docs/`, `reference/`, `tools/`, `fixtures/` and `vendor/` are ignored by `.gitignore`)
- **Claim:**
  - /hackathon's boundary rule is that knowledge crosses into the event and code may not.
  - Origins forbids any code before the start, "not even a `package.json`".
  - The XRPL project kept all pre-event material gitignored.
  - /hackathon prefers slide artefacts drawn rather than fetched "so nothing needs clearing".
  - BNB's brand forbids borrowed geometry and wordmarks.
  - /execution's decision 5 puts README screenshots at the very end, after the order build, then harden, then record.
- **Implication for /frontend:**
  - Write captures of customer sites, extracted palettes and layout notes to the workspace's research tree, for example `research/frontend/refs/`, never to the product repository.
  - Write verification screenshots to a gitignored directory.
  - Never commit third-party images, logos or wordmarks.
  - Leave README screenshots to /execution's last task.
- **Evidence:**
  - [01-find-the-gap.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/01-find-the-gap.md) — accessed 2026-09-30 — line 472: "Knowledge always crosses. Code may not, unless the rules say so."
  - [_recommendation.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md) — accessed 2026-09-30 — lines 510-511: "**No repository, no scaffold, no snippet, no starter — not even a `package.json`.**"
  - [XRPL CLAUDE.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/CLAUDE.md) — owner's XRPL project, accessed 2026-09-30 — section 1.2: "Everything in `reference/`, `docs/`, `tools/`, `fixtures/` and `vendor/` was produced **before** the hackathon opened (Sat 12 Sept 2026, 09:00 Paris). It is gitignored and must stay that way."
  - [05-pitch-craft.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/05-pitch-craft.md) — accessed 2026-09-30 — lines 189-190: "- **At most one artefact per slide** — a mark, a glyph, a single image. Drawn rather than fetched, so nothing needs clearing."
  - [project_execution_skill.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur/memory/project_execution_skill.md) — accessed 2026-09-30 — line 25: "5. README screenshots are always the very last task."
  - [CLAUDE.md](C:/Users/Utilisateur/.claude/CLAUDE.md) — accessed 2026-09-30 — line 104: "Order: build complete → harden → fix → record → ship."
- **Limits / false positives:** Whether a logo or token file made before the event counts as a "prototype" under the Origins rule is not answered anywhere (see "What could not be found").

### FD13-F20 — The frontend depends on a frozen data contract and real fixtures; building without them once cost a whole collaborator's work

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (workflow script line 13, file dated 2026-09-12 03:12 +0200, and 20-SPEC-FRONTEND lines 4, 40 and 70-72 verbatim, re-read 2026-09-30. The November 2025 fact reaches us through a Claude-written workflow brief, not a first-hand note by the owner)
- **Claim:** In November 2025 every page a collaborator built was discarded, because routes and data shapes were imagined. The XRPL fix was a frozen API contract, a real fixture server with no mock layer, strings from the backend rendered verbatim, and no invented number on screen.
- **Implication for /frontend:** In /execution's DAG, /frontend's build nodes depend on a contract-freeze node: an API contract plus fixtures or committed payloads. Once it exists, /frontend runs in parallel with file-disjoint backend work. Pitch-copy strings come from the backend or the spec verbatim, and /frontend never computes or invents a displayed figure.
- **Evidence:**
  - [xls6566-deliverables workflow script](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur-Documents-Coding-XRPL-Hackathon-2026/923db298-ebe9-4ef8-8731-636d9035dd74/workflows/scripts/xls6566-deliverables-wf_7fe8db28-535.js) — owner's XRPL session, 2026-09-12, accessed 2026-09-30 — line 13: "In a previous collaboration in November 2025, 100% of Dev B's pages were discarded and rewritten by Alex, because Dev B built pages at routes he chose against data shapes he imagined. The structural fix is already in place: a REAL fixture server, not mocks."
  - [20-SPEC-FRONTEND.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/docs/20-SPEC-FRONTEND.md) — accessed 2026-09-30.
    - line 4: "API truth: `docs/01-API-CONTRACT.md` (FROZEN)."
    - line 40: "If a number is not in those responses, it does not exist."
    - lines 70-72: "**The strings are fixed.** ... are written by the backend and are pitch copy. Render them **verbatim**." (ellipsis mine)
- **Limits / false positives:** For a mode-B pass over an existing app, as on BNB, the contract is the running app's own data. Nothing to freeze separately.

### FD13-F21 — /harden needs a tree with no untracked files, freezes snapshots and configs, and its default deadline grows by 20 minutes per 1,000 lines

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - /harden runs on a feature-complete tree with a passing build.
  - Any untracked or modified file outside `.harden/` rules out apply mode; in autonomous mode the run then continues report-only. Its dirty check uses `--untracked-files=all`, and gitignored files are not listed.
  - During a run, existing test lines, snapshots, lint and format configs, and CI are read-only.
  - Its default deadline is 60 min plus 20 min per 1,000 in-scope lines (`in_scope_loc` from its ledger), clamped to 120-600 min. The default applies only when the run profile sets neither `deadline_utc` nor `max_minutes`; either one replaces it. (corrected: the formula is a default that the profile overrides, and it is a deadline, not a measured duration)
- **Implication for /frontend:**
  - Every output must be committed or gitignored before hand-over. Reference captures stay outside the repository; Playwright's `test-results/` and reports are ignored.
  - Visual baselines and slop-check configs that /frontend commits become frozen during /harden. A harden accessibility fix that changes pixels would turn a pixel-snapshot gate red; harden then retries at most three times and marks the item blocked (inference from invariants 2 and 9). So keep pixel snapshots out of the gates that /harden infers.
  - Under the default, only in-scope lines between 3,000 and 27,000 in total add time, 20 min per 1,000: below 3,000 in total the 120-minute floor holds, and above 27,000 the 600-minute cap holds. So 2,000 frontend lines add 40 minutes to a project that already has 3,000 or more, and nothing to a project that stays under 3,000 with them. /execution can set `max_minutes` or `deadline_utc` in the harden profile instead. (corrected: the 40-minute figure holds only between the floor and the cap)
- **Evidence:**
  - [harden SKILL.md](C:/Users/Utilisateur/.claude/skills/harden/SKILL.md) — accessed 2026-09-30.
    - line 3: "Use when a project is feature-complete and its build and tests pass, before a release, audit, hand-over or open-sourcing."
    - lines 40-41: "**Existing test lines, snapshots, lint/type/format/test-runner configs and CI workflows are read-only.**"
    - line 163: "any `??` or modified line outside `.harden/` rules out apply mode."
    - line 79: "**Stop instead of forcing.** At most 3 gate attempts per item"
  - [run_state.py](C:/Users/Utilisateur/.claude/skills/harden/scripts/run_state.py) — accessed 2026-09-30 — line 609: `git_proc(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])`.
  - [budget.py](C:/Users/Utilisateur/.claude/skills/harden/scripts/budget.py) — accessed 2026-09-30 — lines 144-147: "MIN_MINUTES = 120", "MAX_MINUTES = 600", "BASE_MINUTES = 60", "MINUTES_PER_KLOC = 20"; line 762: "minutes = min(MAX_MINUTES, max(MIN_MINUTES, BASE_MINUTES + MINUTES_PER_KLOC * kloc))".
    - Verification, 2026-09-30: lines 741-742 read `loc = int((ledger.get("totals") or {}).get("in_scope_loc") or 0)` and `kloc = loc / 1000.0`; lines 752-760 build the deadline from the profile's `deadline_utc` or `max_minutes` when either is present, and line 762 runs only in the `else:` branch. harden SKILL.md line 163 (preflight) uses `git status --porcelain=v1 --ignored=matching`; lines 164-165: "in autonomous mode never stash: the run continues report-only".
- **Limits / false positives:** Whether harden's self-setup would adopt a Playwright check as a gate was not tested. Its inference rules only accept commands it can prove offline (local-skills-interlock F05).

### FD13-F22 — /harden's frontend lens loads only for React, Next.js, Vue, Svelte or Vite; the BNB board and the planned Origins page fall outside it

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (lens-frontend lines 4, 27 and 180, FE-19 at line 166, harden SKILL.md line 304 and `_recommendation.md` lines 494-495 re-read 2026-09-30; both git commands rerun in `holdover/`: `0`, and no manifest match (grep exit 123); `apps/web/src/html.ts` and `sections/*.ts` build markup with a tagged `html` template)
- **Claim:**
  - The lens loads only when JSX/TSX, `.vue` or `.svelte` files are present, or a react, next, vite, vue or svelte dependency is.
  - Its axe run needs gates that can start the app and a Playwright install.
  - Even when it runs, contrast, target size and focus-not-obscured are report-only (FE-21), and it applies only mechanical fixes (FE-19).
  - BNB's `apps/web` is TypeScript template strings. It depends on decimal.js, pino, zod and workspace packages, holds 0 `.tsx`, `.jsx`, `.vue` or `.svelte` files, and no manifest in the repo names react, next, vite, vue or svelte.
  - TOKEN2049's recommended project link is "no framework".
- **Implication for /frontend:**
  - Run its own axe pass (tags `wcag2a` to `wcag22aa`) and keyboard checks on every surface, because /harden may never look at them.
  - Meet contrast and target size itself.
  - Pre-empt FE-19 (`lang`, linked labels, names on icon-only buttons, `type="button"`), so /harden has nothing to change in /frontend's markup.
- **Evidence:**
  - [lens-frontend.md](C:/Users/Utilisateur/.claude/skills/harden/references/lens-frontend.md) — accessed 2026-09-30.
    - line 4: "> Read when: JSX/TSX, `.vue` or `.svelte` files, or a `react`, `next`, `vite`, `vue` or `svelte` dependency, are in scope."
    - line 27: "**Runtime checks, run by the orchestrator only where the gates can already start the app and Playwright is present"
    - line 180 (FE-21): "Report, never fix: 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum; 24 by 24 CSS px with five exceptions), 3.3.8 Accessible Authentication (Minimum), plus 3.2.6 Consistent Help and 3.3.7 Redundant Entry (level A) and any colour-contrast change."
  - [harden SKILL.md](C:/Users/Utilisateur/.claude/skills/harden/SKILL.md) — accessed 2026-09-30 — line 304: "| references/lens-frontend.md | React, Next.js, Vue or Svelte code exists |"
  - [apps/web/package.json](C:/Users/Utilisateur/Documents/Coding/BNB/holdover/apps/web/package.json) — accessed 2026-09-30 — dependencies: `@holdover/*`, `decimal.js`, `pino`, `zod`. Commands:
    - `git ls-files 'apps/web/**' | grep -c -E "\.(tsx|jsx|vue|svelte)$"` printed `0`;
    - `git ls-files '*package.json' | xargs grep -l -E '"(react|next|vite|vue|svelte)"'` printed nothing.
  - [_recommendation.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md) — accessed 2026-09-30 — lines 494-495: "Host a static page on **GitHub Pages** (same repo, no backend, no framework, **not Vercel**)".
- **Limits / false positives:** Harden's other lenses (security, readability) still read these files. Only the frontend-specific rules and the axe floor are missing.

### FD13-F23 — /prose checks Markdown only, runs after harden's docs lens, and never mentions UI copy

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - `prose_check.py` flags defects "in Markdown".
  - /prose expects docs that are already true, after harden's readability lens.
  - It never invents a fact.
  - Its thresholds, for example PR-01 at 2.0 em dashes per 1,000 words, were measured on six human-written documents: five with word counts from 105 (the Svelte overview page) to 4,600 (esbuild's architecture doc), and the Diátaxis index, listed only as "short". (corrected: the sixth document has no word count)
  - A grep of /prose's SKILL.md and references for UI, interface, frontend, button, landing, microcopy, web page and website returned nothing.
- **Implication for /frontend:** UI copy (hero, headings, labels, empty states) reaches /prose only if /frontend extracts the rendered text into a Markdown file. Per-1,000-word densities measured on long documents are unproven on a 200-word page (inference). Tells 16 (em dashes) and 17 (buzzword copy) therefore need /frontend's own checks, or an agreed /prose extension.
- **Evidence:**
  - [prose_check.py](C:/Users/Utilisateur/.claude/skills/prose/scripts/prose_check.py) — owner's /prose skill, accessed 2026-09-30 — line 2: "Flag candidate prose defects in Markdown, with file:line, so a writing pass argues about text and not taste."
  - [prose SKILL.md](C:/Users/Utilisateur/.claude/skills/prose/SKILL.md) — accessed 2026-09-30 — lines 10-12: "It does not check whether the docs are correct. That is the job of the `harden` skill's readability-docs lens, which owns drift, dead links, stale commands and unverified claims. Run that first."; lines 40-41: "When a rewrite needs a number, a name, a version or a date that the source does not contain, ask the author or cut the claim."
  - [02-measured-shape.md](C:/Users/Utilisateur/.claude/skills/prose/references/02-measured-shape.md) — accessed 2026-09-30 — line 70: "| PR-01 | 1 | em dashes above 2.0 per 1 000 words in a file |"; lines 11-18: the six-document control corpus and its word counts.
  - Command: `grep -r -n -i -E "\bUI\b|interface|frontend|front-end|button|landing|microcopy|web page|website" --include=*.md ~/.claude/skills/prose` printed nothing.
  - Verification, 2026-09-30: the same grep, and the same pattern over every file of the skill (`.py` included), printed nothing; a control grep for "README" matched in eight of the nine files. /prose does use "screen" in the pitch sense (04-pitch line 55, "on screen while it is said"), which is not UI copy.
- **Limits / false positives:** None beyond the inference marked above.

### FD13-F24 — The T-6h demo audit is an audit of the frontend; its hunt list is a checklist /frontend can run first

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (04-demo-audit lines 3 ("Mandatory, at T-6h, whatever state the build is in."), 16-17 and 63, the hunt list at lines 43-74, and 06-operations lines 125-127 re-read 2026-09-30; the eight items listed match the source, which also names "a stale stage direction", "a navigation gesture that silently does the wrong thing" and "a promise the script makes that no file supports")
- **Claim:** /hackathon's mandatory T-6h audit checks that the screen, the script and the captured artifact agree. Its hunt list includes:
  - a number said that is not on screen;
  - a figure that cannot be recomputed from what is on screen;
  - a label that reads as missing data;
  - a screen that borrows an identity it should not;
  - evidence that reaches no pixel;
  - a fold hiding the thing pointed at;
  - a colour carrying the wrong meaning;
  - links that 404, including single-page apps that answer 200 for a route they then render as not-found.
- **Implication for /frontend:** Pre-empt these in its own proof. Tag every number with its ledger id and give every ratio a visible denominator. Keep all artifact evidence reachable, keep nothing folded that the script points to, and check each external link by rendering it, not by status code. Screens must be stable before T-6h.
- **Evidence:**
  - [04-demo-audit.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/04-demo-audit.md) — accessed 2026-09-30.
    - lines 16-17: "Not the code. The **demo path**: the exact sequence a judge will watch, and whether every screen supports every sentence said over it."
    - line 63: "- **Evidence that exists in the artifact and reaches no pixel.**"
  - [06-operations.md](C:/Users/Utilisateur/.claude/skills/hackathon/references/06-operations.md) — accessed 2026-09-30 — lines 125-127: "Check every external link by fetching it. Public explorers often have no route for the object type you are linking to, and a single-page app returns `200` for a route it will then render as not-found — so a status check is not enough."
- **Limits / false positives:** The audit also covers the script and the captured data, which /frontend does not own.

### FD13-F25 — /hackathon's deck builder hard-codes Orma's mark and palette, and prints `${PROJECT}` literally on the cover

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (build.mjs lines 86, 149 and 164 verbatim; the bug reproduced in scratch with node 24: `<svg/><p class="wordmark">${PROJECT}</p>`. The Orma attribution holds although build.mjs never names Orma: the MARK path `M32 6c10.5 0 18 8.9 18 21.5…` also appears in `XRPL_Hackathon_2026/app/public/assets/mark.svg` and in that project's deck, whose `<title>` is "Orma". The font stacks name "Plex Mono" and "Plex Sans", which XRPL DESIGN.md line 106 identifies as self-hosted IBM Plex; build.mjs itself ships no `@font-face`)
- **Claim:** `deck/build.mjs` inlines one fixed mark, the Orma drawing, a fixed palette and IBM Plex font names. Line 149 puts `${PROJECT}` inside a single-quoted string. I evaluated that exact line in scratch with `PROJECT = 'Holdover'`, and it produced `<p class="wordmark">${PROJECT}</p>`. Origins requires .ppt or .keynote slides anyway (F13).
- **Implication for /frontend:** The brand output must reach the slides as files: SVG and PNG marks at slide sizes, plus the palette tokens. Report the cover bug to the owner. Fixing /hackathon's asset is outside /frontend's scope.
- **Evidence:**
  - [deck/build.mjs](C:/Users/Utilisateur/.claude/skills/hackathon/assets/deck/build.mjs) — owner's /hackathon skill, accessed 2026-09-30.
    - line 86: "/** The mark, inline, so the deck stays a single file that works from any directory. */"
    - line 164: "--bg:#0A0B0E; --panel:#0E1015; --fg:#EAE0CE; --gold:#C9A45F;"
    - line 149: "${s.layout === 'cover' ? MARK + '<p class="wordmark">${PROJECT}</p>' : ''}"
  - Command, run in scratch: `node wordmark_check.mjs`, which wraps line 149 verbatim with `PROJECT='Holdover'`. Output: `<svg/><p class="wordmark">${PROJECT}</p>`.
- **Limits / false positives:** Not observed in a real deck build, because the skill folder is read-only for this research.

### FD13-F26 — The 21 Sept Origins plan leaves /frontend 1 to 2 hours inside a 36-hour window, with no pre-event code and no name yet

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Clock computed with `zoneinfo`:
  - start Tue 6 Oct 12:00 SGT (06:00 Paris), deadline Wed 7 Oct 23:59 SGT (17:59 Paris), 35.98 h;
  - T-12h is Wed 11:59 SGT, T-6h Wed 17:59 SGT;
  - the top-5 stage is 8 Oct 16:00, per memory, which gives no time zone; SGT is an inference from the venue. (corrected: the memory does not say SGT)
  The plan:
  - "the viewer" is cut #3, worth 2.0 h if solo;
  - cuts 1 to 3 are taken at hour 2 if no collaborator has appeared;
  - a complete ugly take is recorded at hours 18 to 20 (Wed 06:00-08:00 SGT);
  - the mandatory project link is a static GitHub Pages page of about 1.0-1.5 h;
  - one visual asset carries the idea.
  The recommendation itself calls front-end "the applicant's weakest axis", in the row of organiser question Q4 about terminal recordings. The /execution research places harden-ready at about T-12h. A second /execution dossier reports a weekly quota reset at Wed 7 Oct 04:00 Paris, 22 h into the window.
  This plan is dated 21 Sept. The Cardano track, the primary's track, has scored User Experience & Design at 20 % since at least 24 Sept (F32), and /execution's target-origins dossier says the minimum UI "has to be decided before kickoff" and puts that question to the owner. The 1-2 h budget is therefore the 21 Sept plan, not a settled constraint. (corrected: the budget predates the track's UX weighting)
- **Implication for /frontend:**
  - Ship a small mode: one static page with no framework, the 7×3 grid, the committed table and the live keyless read.
  - It must fit about 1.5 h and be recordable by hour 18, unless the owner raises the UI budget in answer to the question above.
  - Its code starts at T0. Brand and reference research may be prepared earlier as knowledge.
  - The logo waits for the rename.
- **Evidence:**
  - Command: Python `zoneinfo` script run 2026-09-30. It printed "Origins window hours: 35.98", "Origins T-12h … SGT Wed 07 Oct 11:59" and "Origins T-6h … SGT Wed 07 Oct 17:59".
  - [_recommendation.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md) — accessed 2026-09-30.
    - line 225: "3. **The viewer** (−2.0 h, if no collaborator) — committed JSON plus one static HTML table."
    - lines 236-239: "**Hour 2 is the irreversible decision point:**" … "**Hour 18–20: record a complete, ugly take.**"
    - lines 497-498: "~1.0–1.5 h, ideal collaborator task, and it dodges the ambiguity entirely."
    - line 590: "The applicant's weakest axis is front-end; the whole demo design rests on this"
    - line 609: "**One visual asset carries the whole idea — the 7×3 reachability grid.**"
  - [project_token2049_origins.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur/memory/project_token2049_origins.md) — owner memory, 2026-09-21, accessed 2026-09-30 — line 11: "hack window Tue 6 Oct 12:00 SGT -> submit by 7 Oct 23:59 SGT; top-5 demos 8 Oct 16:00".
  - [local-skills-interlock.md](C:/Users/Utilisateur/.claude/skills/execution/research/local-skills-interlock.md) — /execution research agent, 2026-09-30, accessed 2026-09-30 — line 309: "| Build complete, harden-ready | about Wed 07 11:59 (T-12h) |".
  - [local-past-builds.md](C:/Users/Utilisateur/.claude/skills/execution/research/local-past-builds.md) — /execution research agent, 2026-09-30, accessed 2026-09-30 — summary item 4: "Weekly resets were observed on Wed 23 Sept and Wed 30 Sept at 04:00 Paris. If the cadence holds, the next is Wed 7 Oct 04:00 Paris = 10:00 SGT, 22 h into the Origins window".
  - Verification, 2026-09-30: the `zoneinfo` computation rerun gives 35.98 h, T-12h Wed 07 Oct 11:59 SGT, T-6h Wed 07 Oct 17:59 SGT, hours 18-20 = Wed 06:00-08:00 SGT, and 04:00 Paris on 7 Oct = 10:00 SGT = 22.00 h into the window. `_recommendation.md` lines 225, 236-238, 497-498, 590 and 609, the Origins memory line 11 (file modified 2026-09-21T10:33Z), local-skills-interlock line 309 and local-past-builds summary item 4 are as quoted.
  - [target-origins.md](C:/Users/Utilisateur/.claude/skills/execution/research/target-origins.md) — /execution research agent, written 2026-09-30 21:37 Paris, after this dossier's listing, accessed 2026-09-30 — line 320: "| 2 | Track decision (primary vs fallback) and project rename | A | a dated decision line in the spec | Sat 3 Oct | pending since 21 Sept |"; line 385: "**UI scope has to be decided before kickoff.**"; line 419: "what is the minimum UI the user wants /execution to build before /frontend exists".
- **Limits / false positives:** The primary candidate can still switch to the fallback on 5 Oct (§2.3). The quota reset is another agent's extrapolation and was not re-verified. The T-12h anchor is that dossier's inference.

### FD13-F27 — Ledger OP3N: a week of remote build that dev B carries for the first five days, then a live 5-minute final

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:**
  - Build from Tue 6 Oct 18:00 Paris, 12.0 h after the Origins start, to Tue 13 Oct 23:59 Paris (173.98 h); internal freeze 21:00 that day.
  - Final on Fri 16 Oct 15:00 Paris (rubric line 169: "Fri 16 Oct 13:00 UTC (15:00 Paris)"): 5 min pitch plus 5 min Q&A, live demo preferred.
  - The pitch budget is two sentences, one before/after screen pair and one live step.
  - No product code before 6 Oct 18:00.
  - Eli carries the build 6-11 Oct. The owner is "effectively unavailable 6 Oct 06:00 Paris → end of 8 Oct" and in Singapore until the morning of 12 Oct SGT; the source says Eli "carries" the build, not that he builds alone, and gives no unavailability after 8 Oct (inference: the owner may contribute remotely from 9 Oct). (corrected: the title's "alone" overstated the source)
  - /execution's decision 4 gives dev B the identical setup on his own machine.
- **Implication for /frontend:**
  - Dev B must be able to install and run it alone, which the XRPL lesson shows is not automatic: the no-attribution hook was machine-local.
  - For Ledger, its centre is a before/after screen pair, which may include device screen captures, and one live step.
  - A live stage means self-hosted fonts and testing at the presenting machine's zoom (F13).
- **Evidence:**
  - [Ledger rubric.md](C:/Users/Utilisateur/Documents/Coding/Ledger Op3n/research/findings/rubric.md) — accessed 2026-09-30.
    - line 171: "**Our internal freeze: Tue 13 Oct 21:00 Paris (19:00 UTC).**"
    - lines 174-176: "**OP3N starts 12 hours into the Origins hack.** Alexandre is effectively unavailable 6 Oct 06:00 Paris → end of 8 Oct, and in Singapore until the morning of 12 Oct SGT. Eli carries the build 6-11 Oct."
    - line 387: "- **No product code before 6 Oct 18:00 Paris.**"
    - line 391: "- Pitch budget is 5 minutes: two sentences + one before/after screen pair + one live step."
  - [project_execution_skill.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur/memory/project_execution_skill.md) — accessed 2026-09-30 — lines 23-24: "4. The shared plan lives in Notion (Notion MCP). With a teammate, dev B runs the identical setup (own Claude Code + /execution + Notion MCP) on the same repo."
  - [local-past-builds.md](C:/Users/Utilisateur/.claude/skills/execution/research/local-past-builds.md) — accessed 2026-09-30 — summary item 6: "the no-AI-attribution hook is machine-local and did not protect dev B."
  - Command: Python `zoneinfo`. It printed "Ledger start is 12.0 h after Origins start".
- **Limits / false positives:** The rubric, the T&C and a promised "(mega) surprise" were unpublished when the rubric file was written. The format may change.

### FD13-F28 — BNB: the visual pass is waiting for /frontend, and the windows are before the 3 Oct freeze or on 9 Oct

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (memory lines 43-46, 63-64 and 83-85 and FEATURE-CATALOGUE lines 87-88 re-read 2026-09-30. The two windows are also in the BNB plan: SPEC.md line 133, "Effective build days: 23 Sep – 3 Oct (minus Hedera), then 9–10 Oct", and lines 148-150, "Fri 3 Oct | freeze, hardening, backup video, clean-machine dry run", "4–8 Oct | Singapore. No deploys, no config flips", "Thu 9 Oct | ERC-8183 settle; final video; polish". The board fetched at 20:12Z had no external script, stylesheet, image, font, `@import` or `url(http…)`, and its favicon is a `data:image/svg+xml` URI)
- **Claim:**
  - As of 30 Sept, the owner called the current BNB design "visuellement catastrophique", chose functionality first, and let the visual pass wait for the frontend skill.
  - Dates: freeze Fri 3 Oct; no deploys 4-8 Oct; repo public and report written Fri 10 Oct; submission Sun 11 Oct 12:00 UTC; judging 12-23 Oct.
  - /harden (G5) runs before the video.
  - The board is live at `holdover.fly.dev` as a single response with zero external resources.
- **Implication for /frontend:** BNB is a mode-B customer (F01). The pass keeps the single-response rule: no CDN, no external font, favicon inlined. It must land and deploy by 3 Oct or on 9 Oct, and /harden and the video follow it. A 9 Oct pass leaves /harden (minimum 120 min), the video, the report and the flip to 9-10 Oct.
- **Evidence:**
  - [project_bnb_holdover.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur-Documents-Coding-BNB/memory/project_bnb_holdover.md) — owner memory, modified 2026-09-30, accessed 2026-09-30.
    - lines 43-44: "- Fri 2026-10-03 freeze · 4-8 Oct Singapore, no deploys · Fri 2026-10-10 repo public + the report written."
    - lines 45-46: "**Submission + Developer Experience Report due Sun 2026-10-11 12:00 UTC (14:00 Paris).**"
    - lines 63-64: "Board live at `https://holdover.fly.dev` (1.05 MB, one response, zero external resources)"
    - lines 83-85: "He called the current design "visuellement catastrophique" and is writing a frontend skill; when asked on 30 Sept he chose functionality first and the visual pass waits for the skill."
  - [FEATURE-CATALOGUE.md](C:/Users/Utilisateur/Documents/Coding/BNB/research/FEATURE-CATALOGUE.md) — accessed 2026-09-30 — lines 87-88: "Server-rendered, works with JavaScript off, one HTTP response renders everything (no CDN, no external font, favicon inlined as a data URI)."
- **Limits / false positives:** The owner may choose to skip the visual pass for BNB.

### FD13-F29 — /frontend has about 2.5 days to exist before /execution's proposed fixture rehearsal

- **Grade:** B · **Kind:** OBSERVED · **Verdict:** VERIFIED (JSONL line 191 carries the quoted "Ven 2 oct" row verbatim; memory lines 31-33 verbatim; `zoneinfo` from 2026-09-30 21:35 Paris gives Origins start 128.4 h, flight 86.4 h, BNB close 256.4 h. The calendar is still unconfirmed: no owner message follows line 161)
- **Claim:**
  - The owner decided that /execution's first real use is Origins, and that it must be built and rehearsed on a fixture before he flies on Sun 4 Oct 12:00 Paris.
  - The design session proposed this calendar: architecture validated and skill built Thu 1 Oct, full rehearsal Fri 2 Oct (also Hedera submission day), corrections Sat 3 Oct, departure Sun 4 Oct.
  - At 21:35 Paris on 30 Sept, 86.4 h remained until the flight.
- **Implication for /frontend:** If /frontend v1 is not usable by the Fri 2 Oct rehearsal, /execution rehearses and runs Origins with its simple-UI fallback. Build the minimum first: the contract, small mode (F26) and `frontend-check` (F16).
- **Evidence:**
  - [/execution design transcript (JSONL)](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur-Documents/1b81010d-85f5-4bc4-9aad-c09f0606fc88.jsonl) — accessed 2026-09-30 — line 191, assistant, 18:57:48Z: "| Ven 2 oct | Répétition complète sur un petit projet de test : plan, vagues, une tâche manuelle, Notion, reprise depuis ton téléphone. C'est aussi le jour de la soumission Hedera, donc je te demanderai peu de temps |"
  - [project_execution_skill.md](C:/Users/Utilisateur/.claude/projects/C--Users-Utilisateur/memory/project_execution_skill.md) — accessed 2026-09-30 — lines 31-33: "9. First real use = TOKEN2049 Origins (hack window 6 Oct 12:00 SGT -> 7 Oct 23:59 SGT). No earlier real use, so it must be built and rehearsed on a fixture before the user flies (Sun 4 Oct 12:00 Paris)."
  - Command: Python `zoneinfo` from 2026-09-30 21:35 Paris. It printed "Hours from now to: Origins start 128.4; flight 86.4; BNB close 256.4".
- **Limits / false positives:** The day-by-day calendar is a proposal the owner had not confirmed in the transcript, hence grade B.

### FD13-F30 — Claude Design sync can only run under the owner's own /design-sync, and the account has no Design System artifact

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (DesignSync description reloaded with ToolSearch on 2026-09-30: both quotes verbatim, and it adds "Never use it to make a design, deck or prototype: those are made from a Slides or Design Artifact type with the Artifact tool." Both Artifact listings rerun: the same two core types for `type_query: design`, and the same "No Artifacts made from the type "Design System" … that this user can open are listed" answer. DesignSync's own `list_projects` was not called, because its description limits it to the user-started /design-sync skill, so whether claude.ai/design design-system projects exist, a separate store from Artifacts, is unknown. The Artifact tool is present in workflow agents (F03))
- **Claim:**
  - The DesignSync tool's own description limits it to the user-started /design-sync skill, and requires the user to review and approve a plan before any write.
  - The account lists two core Artifact types, "Design" and "Design System".
  - No Design System artifact exists that the user can open.
- **Implication for /frontend:**
  - Inside /execution, /frontend cannot push a design system to claude.ai/design. A sync is a manual task for the owner.
  - To show designs for review on the phone through the Design type, /frontend should first create a per-project Design System from its own tokens. Without one, there is no system to apply.
- **Evidence:**
  - DesignSync tool description, loaded with ToolSearch in this session on 2026-09-30, Anthropic tool definition: "Use this only with the /design-sync skill, which the user starts, to keep a local component library in sync with one of those projects — incrementally, one component at a time, never as a wholesale replace." and "`finalize_plan` … Call this after the user has reviewed and approved the plan."
  - Artifact tool, `list` with `scope: types` and `type_query: design`, run 2026-09-30: "[core] "Design System" — Design systems: a brand's README, tokens (colors across themes, type scale and fonts, spacing, radius), components with live previews and guidelines, and assets — one browsable reference agents read and build on."
  - Artifact tool, `list` with `type: "Design System"`, run 2026-09-30: "No Artifacts made from the type "Design System" (https://claude.ai/artifact/5M7UeXXcx16TP3vzVFNDzd) that this user can open are listed — carry on without one."
- **Limits / false positives:** I did not read the Design type's own instructions, so the craft-rule quotes in the brief are not re-verified here.

### FD13-F31 — The past hackathon frontends span nine folders and at least twelve framework manifests, and XRPL's own "anti-slop" pass added grain, a vignette and Lucide icons without a checker

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** CORRECTED
- **Claim:** Nine past hackathon folders have a web frontend manifest; eight hold 12 framework manifests (node_modules excluded), and BNB's has no framework:
  - Monad_Blitz_Paris (auramaxx/web, blitz-fork/web);
  - Monad_Hackathon (Monad_ETHDenver/frontend);
  - ETHDenver (agentfi/frontend);
  - Hackathon_SUI (repo/web, and "Insurance DApp Frontend Design", a Figma Make export, F33);
  - BaseBatches (spark-onchain-app/apps/web);
  - XRPL_Hackathon (hackathon-rwa);
  - Hedera (scaffold-hbar-saucerswap-v2/packages/nextjs, plus hbar-template-gate-skeleton/packages/nextjs and spike-metamask/packages/nextjs, which share the scaffold's `packages/nextjs` layout);
  - XRPL_Hackathon_2026 (app);
  - BNB (holdover/apps/web, no framework).
  Outside these folders, `Documents/Coding` holds 13 more framework manifests: BaseWorkshop, Basic_Strategy_BJ, CodingChallenge, inflexion, Plouf-plouf, three in Sui_Workshop, four under `others/`, and a cloned `ledger-live` under Ledger's `research/repos/`. Apart from that clone, which is third-party code, whether each is a hackathon entry, a workshop or a personal tool was not established. (corrected: the null-safe search prints 12 manifests in the eight framework folders, not nine; a plain `xargs` split the spaced path of the SUI Figma export, which was missed)
  In XRPL 2026, the owner's brief made "no more AI slop" priority 1. The pass that followed kept the owner's switch to shadcn with Lucide icons (`lucide-react` is imported in 8 source files). It also added a 24 px masked grid with a radial vignette behind the content, and 4 % scanlines plus 5 % grain in front. A later pass the same day, "Adoucissement du chrome — 12/09", cut the 24 px grid and lowered scanlines to 2 % and grain to 3.5 %; the grain stayed. That is tell 10, and the grain-over-gradient texture of tell 20. (corrected: the later softening added; what shipped must be read from the rendered page, not the log)
- **Implication for /frontend:** The slop checker's positive set should start from these folders, including the Figma Make export; ask the owner which of them he counts as "vibecoded". The checker must also fire on the output of an unmeasured anti-slop pass, since the one on record traded some tells for others.
- **Evidence:**
  - Command, 2026-09-30: `find <folder> -maxdepth 4 -name package.json | xargs grep -l -E '"(react|next|vite|vue|svelte|@sveltejs/kit)"'` over the listed folders. The researcher reported nine framework manifests across eight folders (two in Monad_Blitz_Paris). BNB's web app, which has no framework, was identified separately (F22).
  - Verification rerun, 2026-09-30: the command exactly as written also prints dozens of `node_modules/*/package.json` hits (BaseBatches, XRPL_Hackathon) and cannot read `Hackathon_SUI/Insurance DApp Frontend Design/package.json`, because `xargs` splits on spaces. The null-safe form `find <folder> -maxdepth 4 -name node_modules -prune -o -name package.json -print0 | xargs -0 grep -l …` prints 12 manifests over the same folders: the nine listed, `Hackathon_SUI/Insurance DApp Frontend Design`, `Hedera/hbar-template-gate-skeleton/packages/nextjs` and `Hedera/spike-metamask/packages/nextjs`. The same test over all of `Documents/Coding` (126 manifests, build folders pruned) prints 25.
  - [XRPL app/package.json](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/app/package.json) — accessed 2026-09-30 — dependencies include `lucide-react`, `radix-ui`, `tailwindcss`, `tw-animate-css`. Command: `grep -r -l "lucide-react" app/src | wc -l` printed `8`.
  - [DESIGN.md](C:/Users/Utilisateur/Documents/Coding/XRPL_Hackathon_2026/DESIGN.md) — accessed 2026-09-30.
    - line 213: "« Décision owner : on passe l'UI sur shadcn, même si ça veut dire recoder des composants déjà là. Qualité > garder l'ancien JSX. »"
    - line 224: "| `shadcn` (init `-b radix -p nova`) | CLI | style `radix-nova`, `cssVariables: true`, icônes lucide |"
    - line 280: "Brief owner : priorité 1 « que ça ne fasse PLUS AI slop », priorité 2 « vivant + smooth »."
    - lines 292-293: "3. **Les aplats sans matière.** Fond mort = rendu, pas machine. Ajouté, CSS pur et inerte : grille 24px masquée + vignette **derrière** le desk, scanlines 4% + grain 5% **devant**."
    - lines 782-784 (verified 2026-09-30), section "## Adoucissement du chrome — 12/09" (line 759), table "Ce qui a été adouci": "| grille de fond 24px | `--line-2` à 70% | **coupée** — …", "| scanlines | 4% | **2%** |", "| grain | 5% | **3,5%** |".
- **Limits / false positives:** I rendered none of these projects, as the task rules require. Presence of the other tells is unverified. Some are template-derived (the three Scaffold-HBAR packages), exported from a tool (the Figma Make bundle) or not owner-designed (auramaxx was built by several people), so they may not count.

### FD13-F32 — The Cardano track scores User Experience & Design at 20 %, with a criterion that restates /frontend's goal; the Origins plan that budgets 1-2 h of UI predates it (added at verification)

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** The organiser's public API for the Cardano "Agentic Commerce" track, last updated 2026-09-24T13:39:53Z, scores the track on "30% Technical Execution & Use of Cardano Tech", "20% Innovation & Creativity", "20% User Experience & Design", "20% Impact & Feasibility" and "10% Pitch & Presentation". The UX criterion reads: "Is the design intuitive and user-friendly? Does it consider real-world onboarding and usability? Could someone new to blockchain understand it quickly?" To qualify, a project needs "a DApp with a frontend, or a tool/agent with a live demo". The owner's rubric.md, verified on 17 Sept, carries the qualifying line but no track weights, and the 21 Sept recommendation, whose primary candidate competes on this track, cuts "the viewer" to a static table (F26). The main track, which every team enters, has no UX criterion. /execution's target-origins dossier found the weights first and put the UI budget to the owner as an open question.
- **Implication for /frontend:**
  - For Origins, /frontend's output is scored directly at 20 % of the primary's track score, on the question the owner's brief asks: can someone new understand it quickly.
  - The 1-2 h budget (F26) is a 21 Sept plan. Put the choice to the owner as a manual task before kickoff: the small mode as the minimum, and what one or two more hours would buy.
  - Store event rubrics with their fetch date and re-fetch before the event, as rubric.md line 4 already warns ("the pages are still being edited").
- **Evidence:**
  - [BuilderBase public event API, `cardano-agentic-commerce`](https://edge.builderbase.com/events/public/cardano-agentic-commerce) — TOKEN2049 Origins organiser (BuilderBase), `data.event.updated_at` "2026-09-24T13:39:53.58+00:00", fetched 2026-09-30T20:19:42Z (HTTP 200, 28,150 bytes), accessed 2026-09-30 — primary. Text of `data.event.page_data.html` after stripping tags: "How Cardano judges this track This track has its own criteria. Weights show how much each counts toward the track score. 30% Technical Execution & Use of Cardano Tech … 20% Innovation & Creativity … 20% User Experience & Design Is the design intuitive and user-friendly? Does it consider real-world onboarding and usability? Could someone new to blockchain understand it quickly? 20% Impact & Feasibility … 10% Pitch & Presentation"; and "To qualify A working prototype on Cardano network : a DApp with a frontend, or a tool/agent with a live demo."
  - [TOKEN2049 rubric.md](C:/Users/Utilisateur/Documents/Documents Perso/token2049/research/findings/rubric.md) — "verified 2026-09-17", accessed 2026-09-30 — lines 13-19: the main track's five criteria (Functionality & Execution 30 %, Technical Implementation & Integration 25 %, Innovation & Originality 20 %, Usefulness & Potential Impact 15 %, Demo & Presentation 10 %); line 34 (Cardano): "Requirements: working prototype on **Cardano network** (DApp with frontend, or tool/agent with live demo)", with no weights; line 4: "Re-fetch before relying on any line: the pages are still being edited."
  - [target-origins.md](C:/Users/Utilisateur/.claude/skills/execution/research/target-origins.md) — /execution research agent, 2026-09-30 21:37 Paris, accessed 2026-09-30 — line 66: "since at least 24 Sept, Cardano scores its track on 30 % Technical Execution & Use of Cardano Tech, 20 % Innovation & Creativity, 20 % User Experience & Design, 20 % Impact & Feasibility and 10 % Pitch & Presentation"; line 419: "Given the Cardano rubric (UX & Design 20 %), what is the minimum UI the user wants /execution to build before /frontend exists".
- **Limits / false positives:** The weights apply to the Cardano track prize only, and only if the primary candidate is kept at the 5 Oct switch. The page is organiser-edited HTML and can change again before 6 Oct.

### FD13-F33 — The owner's corpus already holds one AI design-to-code output: a Figma Make export for the SUI hackathon, shipping stock shadcn/ui and Lucide (added at verification)

- **Grade:** A · **Kind:** OBSERVED · **Verdict:** VERIFIED (added at verification)
- **Claim:** `Documents/Coding/Hackathon_SUI/Insurance DApp Frontend Design/` is a Vite code bundle exported from Figma Make. Its README calls it "a code bundle for Insurance DApp Frontend Design" and links the original Figma design file. `src/Attributions.md` says it includes components from shadcn/ui and photos from Unsplash. `src/guidelines/Guidelines.md`, the file Figma Make's AI reads for rules, is still the untouched template. Of its 49 `.tsx` files, 18 import `lucide-react`, and `src/components/ui` holds 48 files. Its stylesheet imports Inter and JetBrains Mono from Google Fonts and sets Inter as the `body` font under the comment "Base typography with web3-friendly styling". The bundle is not a git repository; its `package.json` is dated 2025-09-28. F31's search missed it because of the space in the folder name.
- **Implication for /frontend:**
  - The owner is weighing a Figma MCP. His one recorded Figma-to-code output carries tells 4 (Inter as the body font) and 10 (Lucide everywhere), and, unless restyled, 11 (untouched shadcn UI) by construction. Any Figma route must pass the same slop checker as hand-built code.
  - The unused lever is visible: Figma Make reads a guidelines file, and this one was left empty. If Figma is used, /frontend should write that file from its own rules and tokens.
  - Add this bundle to the checker's candidate positive set, and ask the owner whether the SUI `repo/web` frontend was derived from it.
- **Evidence:**
  - [README.md](C:/Users/Utilisateur/Documents/Coding/Hackathon_SUI/Insurance%20DApp%20Frontend%20Design/README.md) — owner's SUI hackathon folder, accessed 2026-09-30 — line 4: "This is a code bundle for Insurance DApp Frontend Design. The original project is available at https://www.figma.com/design/…" (file id elided here).
  - [src/Attributions.md](C:/Users/Utilisateur/Documents/Coding/Hackathon_SUI/Insurance%20DApp%20Frontend%20Design/src/Attributions.md) — accessed 2026-09-30: "This Figma Make file includes components from [shadcn/ui](https://ui.shadcn.com/) used under [MIT license]…" and "This Figma Make file includes photos from [Unsplash](https://unsplash.com) used under [license]…".
  - [src/guidelines/Guidelines.md](C:/Users/Utilisateur/Documents/Coding/Hackathon_SUI/Insurance%20DApp%20Frontend%20Design/src/guidelines/Guidelines.md) — accessed 2026-09-30: "**Add your own guidelines here**", then a commented template: "Use this file to provide the AI with rules and guidelines you want it to follow."
  - Commands, 2026-09-30, in `src/`: `find . -name '*.tsx' | wc -l` → 49; `grep -r -l 'lucide-react' --include=*.tsx . | wc -l` → 18; `ls components/ui | wc -l` → 48; `components/figma/` holds `ImageWithFallback.tsx`; `git rev-parse` → not a git repository; `package.json` mtime 2025-09-28 05:55.
  - `src/styles/globals.css` line 1: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');`; lines 143-148: "Base typography with web3-friendly styling" … `body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;`. `src/index.css` line 2: "tailwindcss v4.1.3".
- **Limits / false positives:** Not rendered. Whether this bundle was shown to judges, or only used as a starting point, is unknown. The compiled `index.css` defines `.bg-gradient-to-r`, `.bg-gradient-to-br` and `.backdrop-blur-xl`, but no `.tsx` file uses a gradient, a blur or a purple, violet, indigo or blue colour-stop class, so tells 1, 2 and 6 are not evident in the markup.

## Contradictions between sources

1. **When /frontend runs.** The workflow script's rendering of the /frontend request says /execution calls it during the build; the owner's own words say only that it "sera appelé par execution". The owner's first message in the /execution session says /execution "fera surmeent intervenir" /frontend. The /execution memory (#6) and the workflow brief read it as "simple UI first, /frontend later as its own pass", and the design session asked the owner to confirm with no answer on record (F01). (corrected: "during the build" attributed to the script, not the owner)
2. **Copying customer sites.** The owner's brief allows drawing on customer websites and copying some aspects. On the other side:
   - /hackathon wants slide artefacts "drawn rather than fetched, so nothing needs clearing";
   - BNB's brand rule forbids "borrowed geometry … no wordmark that could read as an endorsement", after borrowing one thing on purpose, "BNB yellow `#F0B90B` on the true hand only";
   - TOKEN2049's default is to name "the deployment and the script hash, not the platform" on anything carrying a number, while organiser question Q1 is still open.
   A workable reading: layout, density and information structure may be learned, while images, logos, wordmarks and distinctive geometry are not taken. The owner should confirm (F15, F19, F11).
3. **BNB embargo versus the live board.** The memory of 23 Sept holds the sponsor-API unit findings until 11 Oct 12:00 UTC, yet the public board on 30 Sept renders them (F12).
4. **Spec-level design rules versus mid-event decisions (XRPL).**
   - The spec forbids "component library that brings its own design (MUI, AntD, Chakra, shadcn, DaisyUI)" (20-SPEC line 79), and DESIGN.md records the owner's switch to shadcn on 12 Sept (line 213).
   - The spec says "no web fonts" (line 896); DESIGN.md removed the Geist web font that shadcn's init installed and kept Plex self-hosted (lines 231-232).
   /frontend's rules need a recorded override protocol, not silent drift.
5. **Claims-ledger vocabularies.** /hackathon uses verified / unverified / cut; Hedera uses backed / re-verify / do-not-claim (F10).
6. **TOKEN2049 viewer.** Cut #3 reduces "the viewer" to "committed JSON plus one static HTML table" (line 225). §3.4 says "A committed HTML file is not a live URL" and requires a hosted page (line 494). The project link is a mandatory deliverable, so the frontend cannot be cut to zero; the cut applies to a richer viewer.
7. **Tools of a background subagent.** The /execution dossier cc-skills-hooks (F21) lists the tools a background subagent keeps without `Agent`. The official page says `Agent` follows the depth rule "wherever the subagent runs". For a regular subagent, such as a `context: fork` skill, that is an omission rather than a conflict. For a workflow agent, the 2.1.286 binary disallows `Agent` outright and runs the agent in the foreground, and that dossier's own verifier marked the workflow-agent part of its F21 refuted: /frontend cannot fan out from inside a wave's `agent()` call (F03). (corrected: resolved at verification)
8. **Origins UI budget versus the Cardano rubric.** The 21 Sept recommendation cuts "the viewer" to a static table as cut #3; the Cardano track, the primary's track, has weighted User Experience & Design at 20 % since at least 24 Sept, and asks "Could someone new to blockchain understand it quickly?" (F26, F32). (added at verification)

## What could not be found, and how it was searched

- **The owner's answer on /frontend's timing.** Searched all user messages in the /execution transcript (32 user records). The last record is at 19:18:56Z and has no answer. Re-checked at verification: at 20:06Z the file had 49 user records and still only two owner-typed messages (lines 11 and 161).
- **/execution's architecture and SKILL.md.** `C:/Users/Utilisateur/.claude/skills/execution/` held only `research/` at 21:25 and 21:37 Paris. Five of the nine planned dossiers existed: cc-skills-hooks, local-past-builds, local-skills-interlock, notion-mcp and prior-art-loops. prior-art-planning, prior-art-parallel, cc-runtime and target-origins were not yet written, so the plan format and task schema /frontend must fill are unknown. Update at verification: all nine dossiers exist by 22:03 Paris (prior-art-planning 21:31, target-origins 21:37, prior-art-parallel 21:53, cc-runtime 21:56), so prior-art-planning was probably already there at the 21:37 listing; cc-skills-hooks and notion-mcp gained verification sections afterwards. There is still no SKILL.md, so the task schema remains unknown.
- **A customer-website field in any Phase A output.** Searched with URL-domain counts per customer file in four events, plus `grep -i "website|homepage|landing page|site web"` across the BNB research tree. Found only docs, API, press and newsroom URLs (F06).
- **Any visual, brand or frontend guidance in /hackathon.** `grep -r -i "logo|favicon|brand|wordmark|typeface|font|frontend|UI|landing|website|homepage"` over its references found only "Start the frontend" (06-operations line 25) and one font remark (05-pitch-craft line 181). Assets contain only the deck's hard-coded mark (F25). Rerun at verification with a word-boundary `UI`: a third hit, 00-rubric.md line 10, "Not the landing page", which refers to the event's page, not a frontend; the conclusion stands.
- **UI-copy scope in /prose.** A grep for UI terms found nothing (F23).
- **Whether a logo, token file or design mock made before the event counts as a "prototype" under Origins' pre-existing-work rule.** Not among organiser questions Q1-Q8 of `_recommendation.md` §5, and no answer in `rubric.md`.
- **Which tools a workflow agent gets, beyond being a subagent.** The workflows page does not list them. Not tested. Resolved at verification from the 2.1.286 binary, this verifier's own tool list and an executed Skill call: the built-ins minus `Agent`, `Workflow` and `SendUserMessage` (the binary's `disallowedTools`) and minus the first filter's list for every non-fork subagent (`AskUserQuestion`, `EnterPlanMode`, `ScheduleWakeup` and the others on sub-agents.md lines 426-433), with Skill usable (F03).
- **Whether harden's self-setup would adopt a Playwright-based check as a gate.** Not tested; harden's self-setup was not run.
- **Ledger's official rubric and T&C.** Unpublished in the latest rubric file; no newer file found in `research/`.

## Weak spots of this dossier

- Almost every source is the owner's own workspace. These files are primary for what his system does and decided, but many record plans made on 21-25 Sept that may have been superseded. F12 is an example: the embargo may have been lifted in a session I did not read.
- /execution is being designed now. Its research dossiers, and my reading of them, may be outdated within hours; the contract here should be re-checked against /execution's SKILL.md once it exists.
- Claude Code behaviour rests on the docs as fetched at 19:35Z and one executed experiment made by another agent. The binary auto-updates, and the docs can change.
- I ran no project and rendered no past frontend, by rule. Tell presence in the corpus (F31) rests on two greps.
- The customer-URL check sampled one file per event and four DefiLlama slugs.
- Grades are mostly A because the sources are the owner's primary files and official docs. That grades provenance, not correctness: a primary file can hold a wrong plan.
- Several implications are my inferences and are marked as such: the pixel-snapshot interplay with /harden (F21), UI-copy densities (F23), lookalike domains (F06) and the compaction fill order (F04).

## Dropped at verification

None. Every cited source exists and says substantially what the finding claims. Seventeen findings needed a correction, recorded in each Verdict line and marked "(corrected: …)" in the text; two findings were added (F32, F33).

## Verification notes

**Method.** One adversarial pass on 2026-09-30, about 20:06-20:45Z, by a workflow agent that did not write the dossier. Every finding's sources were re-opened; nothing was taken from the dossier or from memory.

- Local files: each cited line read with `sed -n`/`grep -n` at the cited number; quotes compared character for character, ignoring line wraps. The /execution transcript was parsed with Python (utf-8), and the Workflow script at its line 182 was extracted and read.
- Official docs: `code.claude.com/docs/en/{skills,sub-agents,workflows}.md` re-fetched as raw Markdown (100,566, 107,123 and 38,943 bytes); line numbers match the dossier's.
- Web data: `api.llama.fi/protocol/<slug>` for the four slugs; `https://holdover.fly.dev/` (HTTP 200, 1,082,542 bytes at 20:12:31Z); `edge.builderbase.com/events/public/cardano-agentic-commerce` (HTTP 200 at 20:19:42Z). Downloads deleted after use.
- Commands rerun: the git, grep and find commands of F10, F11, F22, F23 and F31; globs of F05 with `bash -O globstar -O nullglob`; the `zoneinfo` clocks of F26, F27 and F29; line 149 of the deck builder in node 24; `grep -a` on the Claude Code 2.1.286 binary.
- Tool facts: `ToolSearch select:Agent,AskUserQuestion,Workflow,Task` (none found), one `Skill` call (json-canvas loaded), the DesignSync description (read, not called), and both Artifact listings of F30.

**Patterns in the corrections.**
- Stale snapshots: the transcript and the /execution research folder kept changing after the researcher read them (F01, "What could not be found").
- Measurement overreach: a font-count check counted as an Inter detector (F18); "alone" for a source that says "carries" (F27); a video that is "preferably" read as required (F13).
- Commands whose output was misreported: a grep said to match "only" one sense of a word (F15); an `xargs` without `-0` that silently dropped a path with spaces and would also have listed node_modules (F31).
- Missing conditions: the `--json` skip reported as `ok` (F16); harden's budget formula applies only without a profile deadline (F21); forks exempt from the tool filters, and workflow agents without `Agent` (F03).
- Attribution: "during the build" came from the workflow script, not the owner (F01); a research recommendation reported as a design plan (F04); "about 70 checks" is DESIGN.md's claim, not a count (F18).
- Line numbers off by one (F17, F18) and a wrong section reference (F05).

**Sources not opened.**
- The BNB plaintext deny-list (`~/.holdover/redaction.txt`), by rule; the TOKEN2049 `research/.env`, by rule.
- The owner's Figma design file linked from the SUI export's README (F33): a private design link, not needed for the finding.
- DesignSync `list_projects`: its description limits it to the user-started /design-sync skill, so whether claude.ai/design design-system projects exist is unknown (F30).
- The vendor GitHub issues that cc-skills-hooks' verifier cites (#95469, #82237 and others): not cited by this dossier, not reopened.

**Residual doubts.**
- The `kp` constant in the binary has two definitions (`"SendUserMessage"`, `"mariadb"`); that the workflow agent's third disallowed tool is SendUserMessage is the other verifier's reading. `Agent` and `Workflow` are unambiguous.
- The Claude Code binary was replaced on 30 Sept (file time 21:09 Paris; cc-skills-hooks reports two updates that day), and skills.md changed the same day; every tool fact here holds for 2.1.286 and the pages as fetched.
- Whether a workflow agent can run a `context: fork` skill (which spawns a subagent) was not tested.
- F12: the hold may have been lifted in a conversation that left no memory note.
- F31 and F33 rest on manifests, source greps and CSS, not on rendered pages.
- F32: the organiser edits the track page; the weights can change again before 6 Oct, and they matter only if the primary candidate stays on the Cardano track after the 5 Oct switch rule.
- Line numbers in live files (the transcript, the memory files, the BNB catalogue) will drift; quotes are the stable reference.
