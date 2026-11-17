# /execution research: interlock with the owner's own skills and rules

Dimension: how `/execution` must fit between `/hackathon` (upstream), `/harden` and `/prose` (downstream), the
global `CLAUDE.md` rules and the global `hooks/guard.py`. Researched 2026-09-30, read-only, on Windows 11 with
Claude Code 2.1.286, Python 3.13.2, git 2.51.1.windows.1. Nothing outside this file was written; every `--help`
run happened in the session scratchpad.

Paths: `~` is `C:/Users/Utilisateur`. `H/` is `~/.claude/skills/harden/`, `K/` is `~/.claude/skills/hackathon/`,
`P/` is `~/.claude/skills/prose/`.

Confidence labels: **verified-executed** (I ran it and saw the output), **verified-source** (read in the file at the
cited line), **reported** (stated by the owner, a memory note or a docstring, not re-checked), **inferred** (my
reasoning from the sources, not stated anywhere).

---

## Summary for the designer

1. `/harden` can only be started by a human typing `/harden` (`disable-model-invocation: true`); that invocation *is* the consent. `/execution` ends with a hand-over, never a call.
2. An autonomous `/harden` silently drops to report-only on: any untracked non-ignored or modified file outside `.harden/`; a red or flaky build, typecheck or test gate over 3 repeats; no test gate its self-setup can clear; a committed `.only`; a fresh-clone install or gate that fails. `/execution`'s exit gate must reproduce exactly these (F02-F06).
3. That can be proven in advance without touching `.harden/`: `prescan`, `inventory`, `infer_profile infer/probe/finalize` (never `--install`) with output paths outside the repository, then `gates.py --repeat 3` on the inferred gates and in a fresh clone. `gates.py` is directly reusable as the proof engine: exit 0 means every run of every gate passed (F11, F12).
4. Skill-scoped PreToolUse hooks do not fire for subagent tool calls (harden's measurement A01-F45). Hooks inside an agent definition do fire. The global settings guard does too: it blocked this very workflow subagent. Enforcement over `/execution`'s workers must sit in agent definitions or in post-hoc git checks (F13).
5. The global guard blocks AI-attribution trailers, which the harness's own commit template asks for. It also blocks reads of `.env*`, keys and `.npmrc`, and any read verb whose argument *names* `.env`, even as an exclusion filter. Agents launched with `omitClaudeMd` must carry these rules in their own prompt (F33, F34).
6. `/hackathon` Phase B has three parts: continuous ledgers (claims, DX journal, known behaviour), time anchors (demo audit at T-6h, recount "the morning of", re-verify hashes before citing, record the video last) and a recon cadence table by event length. The "freeze" is referenced but never timed, so `/execution` must define it (F19-F21).
7. Event shape decides whether the visibility calendar, the judge-path table, "the README is the pitch", in-room versus clone-and-grep field reading, and Discord-by-hand versus Telegram MCP apply. Origins is a hybrid: an in-person build, judged from the repo, a hosted link and `.ppt`/`.keynote` slides with an embedded video. No code may predate the start, and nothing may change after Wed 7 Oct 23:59 SGT (F22, F26-F28).
8. `/harden` sizes its own deadline at 60 min + 20 min per 1,000 lines of code, clamped to 120-600 min; pilots took 80-108 min on a small fixture. On Origins, build-complete has to land around T-12h (Wed 11:59 SGT) to fit harden, merge, fix, the T-6h audit, recording and shipping (F07, F28).
9. `/harden` flags contract sources for redeploy only by the suffixes `.sol` and `.vy`, and has no Cardano or Aiken coverage, so a change to a Cardano validator would reach the branch unflagged and no gate would guard it (F09).
10. C: had 2.4 GB free at about 21:10 today, with a `/harden` run active on the Hedera repo whose scratch clones live under the OS temp directory on C:. `/execution` needs a disk-space gate before parallel installs and before the hand-over (F35).
11. `/prose` assumes the docs are already true and never invents a fact. The claims ledger must be closed and the evidence must sit in files before it runs; any fact it lacks becomes a question for the owner (F32).

---

## Findings

### A. The /harden entry contract (what /execution's exit gate must produce)

**F01. /harden is user-invoked only, and the invocation is the owner's consent.**
- Evidence: `H/SKILL.md:5` "disable-model-invocation: true". `H/SKILL.md:3`: "Use when a project is feature-complete and its build and tests pass, before a release, audit, hand-over or open-sourcing." `H/research/user-policy-autonomy.md:50` (U01-F05): "its table row for `disable-model-invocation: true` reads "You can invoke: Yes", "Claude can invoke: No". SKILL.md sets it, so every run starts from a person's own invocation." `~/Documents/Coding/BNB/holdover/scripts/completion-check.mjs:230-231`: "Last, and not automatable from here: the `harden` skill sets `disable-model-invocation: true`, so a human types `/harden`." `~/.claude/CLAUDE.md:100-101`: "`/harden` (user-invoked; it sets `disable-model-invocation: true`) needs a feature-complete, green tree".
- Confidence: verified-source.

**F02. "Clean tree" for /harden means `git status --porcelain=v1 --untracked-files=all` lists nothing outside `.harden/`. Ignored files do not count. A dirty tree makes an autonomous run report-only; it never errors.**
- Evidence: `H/scripts/run_state.py:607-609`: `def dirty_entries(...)`: "`git status --porcelain` lines (untracked included), ignoring the run directory." It runs `["status", "--porcelain=v1", "-z", "--untracked-files=all"]` and skips `.harden` (lines 622-623). `H/scripts/run_state.py:76-80` (docstring): "Mode auto without a valid profile, with a profile blocker (...), or on a dirty working tree (an autonomous run cannot ask the owner to commit or stash) starts in report-only with the reason printed and logged, never with an error." `H/SKILL.md:163-165`: "any `??` or modified line outside `.harden/` rules out apply mode ... in autonomous mode never stash: the run continues report-only".
- Consequence: `/execution`'s own run directory must be excluded through `.git/info/exclude` (the /harden way: `H/scripts/_common.py:350-351` "Create `.harden/` and exclude it through `.git/info/exclude` (never through .gitignore)") or live outside the repository.
- Confidence: verified-source.

**F03. /harden runs its gates 3 times on the untouched base. A red or flaky build, typecheck or test gate makes the whole run report-only. A red lint or format gate becomes a ratchet instead of blocking.**
- Evidence: `H/SKILL.md:233-236`: "Then run `... gates.py" --label baseline --repeat 3`. A gate red or flaky there (build, typecheck and test gates never leave it): `run_state.py set-mode report-only --reason "red baseline"` for the whole run (PF-11)." `H/references/protocol-preflight.md:132`: "Put the runner's shuffle option in the test gate (or add a second test gate) so at least one run is randomised". PF-23 (`protocol-preflight.md:366-372`): "A shuffled test gate carries a seed taken from the base commit".
- Consequence: tests must be order-independent and deterministic under a fixed shuffle seed. Three green repeats with one shuffled run is the exact bar.
- Confidence: verified-source.

**F04. With no test gate, or with a committed focused test, /harden is report-only.**
- Evidence: `H/references/protocol-preflight.md:95` (finalize): "sets `mode: "report-only"` when no test gate survives (PF-20)". `protocol-preflight.md:142` (step 13): "A committed focused-test marker is a T2 finding for the owner, never an approvable commit: run `... set-mode report-only --reason "focused test committed"`". The detector regex is at `protocol-preflight.md:274`: `\b(describe|it|test)\.only\(|\bfit\(|\bfdescribe\(`.
- Confidence: verified-source.

**F05. Self-setup turns a command into a gate only when it can clear it without running it. Test commands that load an existing dotenv file, fork a live network or read keys are excluded or banned, and without a surviving test gate the run is report-only.**
- Evidence: `H/scripts/infer_profile.py:12-24` defines the verdicts: "forbidden: a leaf deploys, signs, publishes, pushes, forks or selects a live network, handles keys, ... or loads a secret file that exists"; "allowed-ci: a GitHub-hosted Actions job runs it literally with no secrets, vars or environment reference, no continue-on-error and no job-level `if:`"; "allowed-source: every leaf is a known static, build, runner or file leaf whose scan completed and found no network client". `infer_profile.py:29-35`: "... Anything else is `excluded: unsupported`, which is safe." `H/evals/pilots-auto-2-to-4.md:32-33`: "A repository file that tools load into the environment (for example Next.js/Vitest `.env.local`) makes self-setup refuse the test commands that load it; park such files outside the repository for the run." The owner's launcher `~/Documents/Coding/Hedera/research/harden/run-harden.sh:19-30` refuses to start while `packages/nextjs/.env.local` and its siblings exist. The self-setup profile also carries `sandbox_ack: true` on native Windows (U01-F05, `user-policy-autonomy.md:52`).
- Consequence: a GitHub Actions workflow on GitHub-hosted runners that runs the offline gates literally (no secrets, vars, environment, `continue-on-error` or job-level `if:`) is the strongest way to make `/harden` find gates. Unit tests with URL literals or imported network clients are "unproven" without that CI evidence (U01-F09, `user-policy-autonomy.md:98`).
- Confidence: verified-source.

**F06. /harden replays setup from a fresh clone (`git clone --no-local`, lockfile install, every gate). If that replay fails, or the network scope forbids the install, the autonomous run applies nothing.**
- Evidence: `H/references/protocol-preflight.md:141` (step 12): "when it was skipped, could not install, or turned a baseline-green gate red, the verifier could not judge the branch either, so run `... set-mode report-only --reason "fresh-clone replay unavailable"`." `protocol-preflight.md:77`: "`denied` on a project that installs dependencies also leaves the end-to-end verifier without a clone it can install (step 12), so the run applies nothing." `protocol-preflight.md:74` lists the lockfile-enforcing commands: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `uv sync --locked`, `cargo build --locked`.
- Consequence: the lockfile must be committed, and the build cannot depend on untracked local state (a gitignored fixtures directory, a local `.env`, a generated file that is not committed).
- Confidence: verified-source.

**F07. /harden sizes its own time: 60 min + 20 min per 1,000 in-scope LOC, clamped to 120-600 min, unless an owner profile sets a deadline. The measured pilots took 80-108 min and USD 35-102 on a small fixture, and even then left fixes undone.**
- Evidence: `H/scripts/budget.py:144-147`: `MIN_MINUTES = 120`, `MAX_MINUTES = 600`, `BASE_MINUTES = 60`, `MINUTES_PER_KLOC = 20`. `budget.py:762`: `minutes = min(MAX_MINUTES, max(MIN_MINUTES, BASE_MINUTES + MINUTES_PER_KLOC * kloc))`. `H/evals/pilots-auto-2-to-4.md:10-13`: wall and cost "USD 35, 90 min", "USD 102, 97 min", "USD 69, 80 min", "USD 68, 108 min". `pilots-auto-2-to-4.md:24-25`: "34 approved fixes were left for lack of time within the default 2-hour budget of this small repository." Computed (verified-executed): 2 KLOC gives 120 min, 5 KLOC 160, 10 KLOC 260, 20 KLOC 460.
- Confidence: verified-source (formula), verified-executed (arithmetic).

**F08. /harden works on its own local branch, never merges or pushes, and hands back a report whose sections are the input to a fix wave.**
- Evidence: `H/SKILL.md:167`: "Create branch `harden/$(date +%F)`." `H/SKILL.md:462`: "Do not merge, push or open a PR unless asked." `H/research/user-policy-autonomy.md:166` (U01-F13): "the run applies only to its own branch and merges, pushes or deploys nothing." `H/assets/report-template.md:106,122,227` hold the headings "## Applied, review before merge", "## Needs your decision" and "## Open owner items". The finding statuses are in `H/assets/findings.schema.json`: candidate, verified, rejected, approved, applied, reverted, reported, deferred, blocked, partial.
- Confidence: verified-source.

**F09. /harden recognises contract sources only by the suffixes `.sol` and `.vy`, and nothing in the skill covers Cardano, Plutus or Aiken.**
- Evidence: `H/scripts/validate_findings.py:197-199`: "Contract sources: any change alters the metadata hash in the deployed bytecode, and the fix takes effect only when the owner redeploys (user-policy-autonomy U01-F12). `CONTRACT_SOURCE_SUFFIXES: Tuple[str, ...] = (".sol", ".vy")`". A case-insensitive search for `aiken`, `plutus` and `cardano` over every `.md`, `.py` and `.json` file of `H/` returned no file. I checked a second way, with a recursive grep over the whole directory: again no file. The self-setup leaf table (`infer_profile.py:63-77`) lists no `aiken` command, so `aiken build` or `aiken check` would be `excluded: unsupported` (`infer_profile.py:35`).
- Consequence for Origins (Cardano track): `/harden` could edit a validator without the `contract-source` review mark, and no gate would re-check the validator. Any change also alters the script hash, and with it the address and every recorded transaction (inferred).
- Confidence: verified-executed (the searches), verified-source (suffix list).

**F10. /harden's readability-docs lens checks the README's commands, links, `.env.example` and TODO markers. A README that is missing or aspirational at hand-over produces findings instead of hardening.**
- Evidence: `H/references/lens-readability-docs.md` rule headings: RD-19 (line 159) "Triage TODO, FIXME and HACK markers; never blanket-delete"; RD-25 (201) "Execute every example that claims to run"; RD-31 (243) "Replay the README verbatim from a fresh clone in a disposable environment"; RD-35 (271) "Keep .env.example in sync with the env vars the code reads"; RD-38 (292) "Hand-over files: README basics with status and limitations, and a real security channel". `P/SKILL.md:10-12`: "That is the job of the `harden` skill's readability-docs lens, which owns drift, dead links, stale commands and unverified claims. Run that first."
- Confidence: verified-source.

### B. What /execution can reuse from /harden

**F11. `gates.py` works outside a /harden run: given explicit paths it runs any gate list from a JSON config and records exit code, duration and output tail per run. It reports flaky gates across repeats and warns on masking constructs.**
- Evidence: `H/scripts/gates.py --help` (verified-executed): `--label`, `--repeat`, `--only`, `--config CONFIG`, `--repo REPO checkout the gates run in`, `--out-dir OUT_DIR`, `--min-count-from`, `--ratchet-from`, `--reuse-if-tree`, `--json`. Exit codes (docstring): "0 every run of every selected gate passed ... 1 at least one gate failed, timed out or could not start ... 2 configuration or usage error". Docstring: "Masking constructs in a gate command (`|| true`, `|| exit 0`, `set +e`, `--passWithNoTests`, scanner soft-fail switches ...) ... are reported as warnings". `H/assets/config.example.json:5`: "gates[].cmd: a list is run as argv without a shell (portable; on Windows 'pnpm' resolves to pnpm.cmd); a string is run through the platform shell (cmd.exe on Windows)."
- Coupling to know: `gates.py:1594-1596` reads a run marker at `<repo>/.harden/active` **and at `<out-dir>/../active`** for forbidden commands. An `/execution` state directory must not hold a file named `active` next to its `gates/` output unless that is intended.
- Confidence: verified-executed (help), verified-source (behaviour).

**F12. /harden's self-setup can be run as a read-only dry run with every output outside `.harden/`. This is the most exact proof available that /harden will find gates, and the owner already ran one on the Hedera repo today.**
- Evidence: `H/scripts/infer_profile.py:7239-7241`: `if value: return Path(value).resolve()` (an explicit `--out-dir` creates no `.harden/`). `H/scripts/inventory.py:1558-1564`: with `--out` the default `.harden/` branch is skipped. `prescan.py` never calls `ensure_harden_dir` (grep). Docstring: "`infer` and `finalize` run no project code"; "probe ... It needs a clean tree"; "finalize ... --install validates the profile and writes the untracked .harden/profile.json". Exit code 2 covers "a run active (infer)". Memory note `project_harden_skill.md`: "Hedera: read-only self-setup dry run 2026-09-30 gives 7 offline gates + 66 bans, but ONLY if packages/nextjs/.env.local is parked outside the repo".
- Caveat: `probe` runs project code, with the inferred allowlisted environment. `finalize --install` must never be used by `/execution` (see F37).
- Confidence: verified-source; reported (the Hedera dry run).

**F13. Skill-scoped PreToolUse hooks do not fire for a subagent's tool calls. Hooks declared in an agent definition do fire. The global settings guard fired for this workflow subagent.**
- Evidence: `H/research/pilot-auto-calibration.md:433-436` (A01-F45): "a skill's `PreToolUse` hook with matcher `Bash` did not fire for a subagent's Bash call, while the skill's SubagentStart and PostToolUse hooks fired for the same subagent" (Claude Code 2.1.282, n = 1). The calibration: "`harden-verifier` runs `hook_guard.py` in its own PreToolUse hook". My own Bash call in this workflow subagent (Claude Code 2.1.286) was refused: "PreToolUse:Bash hook error: [bash ~/.claude/hooks/py.sh guard.py]: Blocked by the global guard: `grep` would read or expose \.env." Owner memory note: "hooks cannot be tested inside workflow subagents (unit tests cover them)".
- Consequence: a `/execution` frontmatter hook would guard only the orchestrator's own calls. Worker agents need guards in their agent definitions, or checks run after they return (harden's `git status` check after each subagent, `H/SKILL.md:269-271`).
- Confidence: verified-executed (global guard in a subagent); reported (A01-F45, n = 1).

**F14. Dedicated agents need a pinned model, installation before the session starts, and a Stop hook that saves their report. Without them /harden measured cheap-model substitution, missing agents, and orchestrator context spent on retyping reports.**
- Evidence: `pilot-auto-calibration.md:343-345` (A01-F41): "The orchestrator started all 65 lens passes as the owner's `codebase-explorer` agent (`model: haiku`) ... The passes missed D05, D18, D19, D25". The owner's `~/.claude/agents/codebase-explorer.md` frontmatter does say `model: haiku` (verified-executed). A01-F41: "an agent file copied into an existing `.claude/agents/` 8 s before the call was refused ("Agent type 'probe-lens' not found")". `pilot-auto-calibration.md:371-381` (A01-F42): 961k characters retyped, "about 38% of its whole context"; "a `SubagentStop` hook in a skill's frontmatter never fired"; "a `Stop` hook in an agent definition fired as SubagentStop and received the final message exactly". `H/assets/agents/harden-lens.md:7`: `omitClaudeMd: true`.
- Confidence: verified-source; reported (measurements, n = 1 each).

**F15. The run-state pattern to copy: one script writes the marker; the hooks do nothing when the marker is absent; `progress.md` carries the invariants and a resume line; the scratch directory lives outside the repository; the hook launcher fails open.**
- Evidence: `H/scripts/run_state.py:5-6`: "hook_guard.py refuses every Edit/Write of `.harden/active`, so this script is the only writer of the run marker". `run_state.py:8-16`: the progress template "carries the checklist, one line per SKILL.md invariant and red flag, and the resume instruction". `run_state.py:1251`: "Re-read this file at the start of every phase and after any compaction." `run_state.py:27-41`: the scratch directory is "one unique directory OUTSIDE the repository, made with tempfile.mkdtemp(prefix="harden-scratch-") under the OS temp directory". `protocol-preflight.md:187` (PF-04): "Skill hooks stay registered for the rest of the session, so each hook must be a no-op without the marker." Commit `29b23c1` in `~/.claude`: "CLAUDE_SKILL_DIR is unset in the hook environment, the $HOME fallback reached Windows Python as /c/Users/... when Git Bash path conversion was off, Python exited 2 ("can't open file"), and exit 2 means "block" for a PreToolUse hook, so every Bash and Edit call was refused." The fixed launcher is `H/SKILL.md:11`. `~/.claude/hooks/py.sh:2-4`: "fail open when the script is missing: a hook exit code of 2 means "block", and Python exits 2 when it cannot open its script."
- Confidence: verified-source.

**F16. The budget pattern to copy: a deadline fixed once, reserves counted back from the end, and a `check` that only ever stops new work.**
- Evidence: `H/scripts/budget.py:6-13`: "Time is reserved from the end: the final check, then Apply, then Prioritise to Approve and Verify; detection gets the rest ... `check` closes a phase's window; it only ever stops a phase earlier. It never loosens a gate, never skips the final check and never stops verify_branch.py." `H/SKILL.md:277-278`: "exit 1 ends detection ...; exit 2 means run `plan` first, never a stop."
- Confidence: verified-source.

**F17. No claim without output, and the final message is printed by a script from files and git.**
- Evidence: `H/SKILL.md:50-52` (invariant 3): "No finding without evidence; no claim without output. ... "Fixed", "passes", "clean" need the command and its exit code next to them." `H/SKILL.md:453-456`: "run `... final_message.py` ... send the script's last output unchanged as your final message, adding nothing".
- Confidence: verified-source.

**F18. /harden's commit discipline, which the guard is compatible with: the message is written to a file and committed with `git commit -F`, the body carries `cmd:`, and there are no attribution trailers.**
- Evidence: `H/references/protocol-change.md:45`: "Write the planned commit message (step 10) to `.harden/tools/msg-<id>-a<n>.txt`; step 10 commits that file with `git commit -F`." `protocol-change.md:50`: "every body carries `cmd: <exact command>`; no AI attribution trailers." `~/.claude/rules/git-conventions.md:4`: "Use conventional commits format: `type(scope): description`"; lines 24-26 cover one logical change per commit, never committing `.env` files or keys, and running lint and tests before committing. The guard reads `-F` message files: `~/.claude/hooks/guard.py:126-139`.
- Confidence: verified-source.

### C. /hackathon Phase B: what /execution schedules

**F19. Phase B consists of continuous ledgers and time-anchored activities. The skill's own index names the anchors.**
- Evidence: `K/SKILL.md:59`: "Phase B — Sprint | The 24 to 48 hours on site | A demo that survives a hostile question". `K/SKILL.md:108-119`: "claims-ledger ... Started on day one, closed before the freeze"; "demo-audit ... Mandatory, at T-6h"; "dx-journal — one row per friction, written at the moment it happens ... Opened on day one whatever the rubric says". `K/SKILL.md:181-182`: "keep `03-claims-ledger.md` open and add to it continuously. Run `04-demo-audit.md` at T-6h whatever the state of the build." `K/SKILL.md:184-185`: "When something feels finished, it isn't". `K/references/03-claims-ledger.md:58`: "Recount every number on the morning of the pitch, from the artifact". `K/references/06-operations.md:68`: "An hour before the pitch, on the machine that will present". `K/references/05-pitch-craft.md:235`: "Record it last, once the demo is audited and stable". `K/references/02-verification.md:90`: "Before any citation goes somewhere public ... re-run it". `K/references/07-contribution.md:42`: "Write the row before you fix the thing".
- Confidence: verified-source. The full schedule is in Implications, section 2.

**F20. "The freeze" is referenced four times in /hackathon and never given a time.**
- Evidence: `K/assets/claims.md:4` ("Closed at the freeze"), `K/references/00-rubric.md:18` ("what is submitted, in what form, by when. Freeze time."), `K/references/03-claims-ledger.md:3,98`, `K/SKILL.md:109`. The same result came back from two searches, `freeze|T-...` and `freez|frozen|code freeze|feature freeze`. The owner's hand-written practice sets freezes explicitly: `~/Documents/Coding/Hedera/research/findings/TASKLIST.md:69-70` ("contract-level findings from the quality skill must land BEFORE Mon 28 evening"; "Contract freeze Wed 30 Sept") and lines 83-84 ("Tag the submitted commit"; "No push after the tag").
- Confidence: verified-executed (two searches), verified-source.

**F21. The reconnaissance cadence is a table keyed by event length, bound by three rules. Its "halfway point" falls at 05:59 SGT for Origins.**
- Evidence: `K/references/01-find-the-gap.md:296-300`: "24 hours | once at the halfway point, once about two hours before you submit"; "a weekend | the evening of day one, the morning of the last day"; "one to three weeks | weekly, then every two days in the last week, and a final pass three days before the deadline, never the day of". Lines 304-311: "Set the response rule before you read ... anything they do better that costs under half a day, you copy the same day"; "Late reconnaissance never changes the subject"; "The last pass needs time to act on." Computed (verified-executed): the Origins halfway point is Wed 07 Oct 05:59 SGT (Tue 23:59 Paris).
- Confidence: verified-source, verified-executed.

**F22. Several rules switch on or off with the event's shape, and each says so in its opening "Applies when" or "Does not apply" line.**
- Evidence: `K/SKILL.md:20-25`: "each section of the references opens with the condition under which it applies ... Read the applicability line before the rule." `K/references/06-operations.md:34-36`, on the visibility calendar: "Applies when your work is private while you build it and has to be public to be judged ... Does not apply at a live event". `K/references/02-verification.md:13-18` gives the judge-path table: a remote bounty built by a tool, a remote submission a human clones, a live event with a stage, a hosted judging environment. Lines 30-32 of the same file: "At a live hackathon ... this section collapses into `06-operations.md`". `K/SKILL.md:113`: "When the event is asynchronous and there is no stage, the README is the pitch". `K/references/01-find-the-gap.md:256` ("When the submissions are public ... Clone every entry and grep") versus line 271 ("In a room ... two conversational moves"). `K/references/04-demo-audit.md:80-82`: "Ship the command that makes your own checker fail. Applies when anything you claim is checkable by a stranger ... Does not apply to a demo whose whole claim is a running interface". `K/references/07-contribution.md:14-18`: the report's depth follows the rubric weight.
- Confidence: verified-source.

**F23. Some Phase B activities can only be done by a human, and /hackathon says so.**
- Evidence: `K/references/01-find-the-gap.md:345`: "Discord | by hand. Copying is against nobody's rules; automating it with your own account token is a self-bot, which breaks the terms of service and gets accounts banned". Line 346: "Telegram | an MCP server exists; use it rather than copying". Line 348: "in person | the two conversational moves above. The room is the channel". `K/references/00-rubric.md:65`: "Ask on day one, in writing, in the public channel." `K/references/05-pitch-craft.md:229`: "Rehearse from the run of show with the timer running, on the machine you will present from." `K/references/06-operations.md:56-57`: "Making a public repository private again does not undo a fork." In the owner's own TASKLIST the human (A) items are the wallet session with captures (line 35), "Record the video" (line 80), "Submit the form" (line 82), "AMA ... Paste the answers back" (line 88) and "A + C — Make the template repo public" (line 63).
- Confidence: verified-source.

**F24. The /hackathon files have fixed columns, which a completion check can parse.**
- Evidence: `K/assets/claims.md:9`: columns `#`, claim as it will be said or shown, where it appears, evidence, status. `03-claims-ledger.md:30` limits the statuses to "`verified`, `unverified`, `cut`. Nothing ships as `unverified`." `K/assets/dx-journal.md:7-9`: "Times in UTC"; columns When (UTC), Who, Where (page / endpoint / tool / version), What I tried, What happened (exact text), Time lost; each row is marked VERIFIED or UNVERIFIED with who verified it (line 34), and refuted rows are kept (line 36). `K/assets/expectations.md:13`: call, expected change, expected return, source of the expectation, what actually happened, evidence. `K/assets/findings-log.md:10`: id, disagreement, layers, evidence, who loses money and how, filed. `K/assets/known-behaviour.md:10,19`: fact, evidence, verified on; plus a "Withdrawn" table. `K/assets/runsheet.md`: format header, a "Before you walk up" table, then the beats (time, duration, on screen, words, stage direction, notes). `K/assets/deck/content.md:4-9`: `## S1 — Title`, `<!-- time | duration | layout | artifact -->`, `### on screen`, `### notes`. `K/assets/preflight.sh:116-119` expects `docs/runsheet.md` and `docs/hard-questions.md` in the product repository.
- Confidence: verified-source.

**F25. Neither the preflight skeleton nor the deck builder can serve as a mechanical proof as shipped: both exit 0 on the defects they report.**
- Evidence: `K/assets/preflight.sh:106-111`: a frontend that never comes up prints `bad "the interface did not come up..."` and the script continues. Lines 121-122: `[ "$DEMO_STATE" -eq 2 ] && echo "... The demo data needs refreshing ..."` followed by `exit 0`. `K/assets/deck/build.mjs:290-292`: `if (slides.length > SLIDE_CAP) console.log(... "OVER THE CAP" ...)` with no non-zero exit. This sits against `K/references/06-operations.md:8`: "The pre-flight must be able to say no".
- Confidence: verified-source.

**F26. The deck asset produces an HTML deck, while Origins requires `.ppt` or `.keynote` with the video embedded, and refuses links.**
- Evidence: `K/assets/deck/content.md:11-12`: "Build: PROJECT="YourName" node build.mjs / Open: index.html". Origins rubric, `~/Documents/Documents Perso/token2049/research/findings/rubric.md:22-24`: "presentation slides as a Google Drive link to a .ppt or .keynote file"; "Live demos are prohibited to avoid technical errors on stage. Use a screen recording and embed the video directly in your slides. Do not link to YouTube or external video."; "Google Slides / Gamma / Vercel links not accepted. No changes after the deadline."
- Confidence: verified-source.

**F27. The boundary rule for pre-event work: knowledge crosses, code does not. Origins forbids any code written before the start.**
- Evidence: `K/references/01-find-the-gap.md:466-474`: "Keep pre-event material in directories that are gitignored from the first commit ... Never move a file out of those directories to get it committed ... Knowledge always crosses. Code may not, unless the rules say so." Origins `rubric.md:26`: "All submitted projects must be built entirely within the 36-hour Origins Hackathon. Projects, prototypes or substantial code developed prior to the official start of the hackathon are not eligible. Publicly available libraries, frameworks, APIs and developer tooling may of course be used."
- Confidence: verified-source.

**F28. Origins' clock and shape.**
- Evidence (computed with `zoneinfo`, verified-executed): the start is Tue 06 Oct 12:00 SGT (04:00 UTC, 06:00 Paris). The deadline is Wed 07 Oct 23:59 SGT (15:59 UTC, 17:59 Paris). The window is 35.98 h. T-12h falls at Wed 11:59 SGT, T-6h at Wed 17:59 SGT, T-2h at Wed 21:59 SGT. The user flies Sun 04 Oct 12:00 Paris, about 86.8 h after this research. Rules: `rubric.md:11-25` gives the weights 30/25/20/15/10 (Functionality & Execution 30 %, Demo & Presentation 10 %), "Teams 1–4", the deliverables (repo "public or judge access", project link "live URL or hosted demo", slides), no live demos, and "No late entries". Memory note: "top-5 demos 8 Oct 16:00". The Cardano track requires "demo video ≤3 min" (`rubric.md:34`).
- Confidence: verified-executed (clock), verified-source (rules), reported (the 8 Oct stage slot).

### D. Global rules, /prose and the guard

**F29. CLAUDE.md fixes the completion rule and the order of work.**
- Evidence: `~/.claude/CLAUDE.md:91`: "Completeness is proven against the plan, never against the test suite." Lines 94-96: "Write a `completion-check` script that reads the plan's items against the tree and exits non-zero while any is open ... Keep it out of CI". Line 99: "Treat a TODO in anything the audience reads as an open gate". Line 104: "Order: build complete → harden → fix → record → ship." Lines 101-102: /harden "needs a feature-complete, green tree — on an unfinished one it reports the unfinished parts as defects and buries the real findings."
- Confidence: verified-source.

**F30. The owner's completion-check mixes build gates with post-harden and deliverable gates. Unchanged, a "build complete" exit would never be reachable.**
- Evidence: `completion-check.mjs:77-85` defines the pattern `gate(id, title, ifDropped, check)`, where a check that throws counts as open. Line 264: `process.exit(open.length === 0 ? 0 : 1)`. The same list holds the build gates G1 and G4, "no deferral marker in any judge-facing document" (G2, with the regex at line 42 and the exemption `<!--todo-ok-->` at line 49), the deliverable gates G3.video and G7.public (`gh repo view --json isPrivate`), a deadline gate G6 ("the one clock that cannot be recovered", lines 171-197), and G5.harden (lines 233-237), which looks for `.harden/report.md`.
- Confidence: verified-source.

**F31. The owner's hand-written TASKLIST is the direct model for /execution's plan rows, and it holds freeze and tag rules that /hackathon lacks.**
- Evidence: `TASKLIST.md:3-5`: "a box is ticked only when its proof column is satisfied (a command with exit 0, a transaction hash re-read on the mirror node, a green CI run, a link that resolves); "C" = Claude does it, "A" = Alexandre does it. Dates are the latest acceptable, Paris time." Line 63 fixes the order of the flip day: "flip, then run the judges' own command ... from a clean folder, then the same without `-s` ... then boot each one, then dispatch the full gate matrix — and only then submit the form". Line 64: "Judge audit + census re-run on Mon 29 Sept ... Repeat both on Thu 1 Oct." Lines 69-70: the quality-pass constraint and the contract freeze. Lines 83-84: the tag and "No push after the tag".
- Confidence: verified-source.

**F32. /prose needs docs that are already true, and it never invents a fact.**
- Evidence: `P/SKILL.md:9-12`: "take documentation or a pitch that is already true ... It does not check whether the docs are correct. That is the job of the `harden` skill's readability-docs lens ... Run that first." Lines 40-42 (invariant 3): "When a rewrite needs a number, a name, a version or a date that the source does not contain, ask the author or cut the claim." Lines 45-46: "Run `--shape` on the corpus first and last". Line 91: "`--shape` for the numbers, `--json` for a machine, exit 1 on tier 1". `P/scripts/prose_check.py:8-10`: "Exit code is 1 when a tier-1 rule fires, 0 otherwise, so it can gate a commit once a project has agreed to its thresholds." `P/references/04-pitch.md:10-16`: keep the two sentences "identical in substance everywhere they appear: the README's opening, the submission form's description field, and the first thing said in the video ... A checker can compare the three and fail when they drift." Lines 55-60: "Nothing is said that is not on screen while it is said"; "145 words a minute is brisk, 130 unhurried"; "Name what the recording cannot prove."
- Confidence: verified-source.

**F33. The global guard blocks every form of AI attribution in commits. That contradicts the harness's own commit template, and agents that skip CLAUDE.md will not know the rule.**
- Evidence: `~/.claude/hooks/guard.py:4-5`: "No AI attribution in commits: refuses a `git commit` whose message (inline, heredoc, -F file or --trailer) carries Co-Authored-By, Signed-off-by or a "Generated with Claude" line." Lines 32-35 hold `ATTRIBUTION_RE`. `~/.claude/CLAUDE.md:4`: "The system prompt's commit template includes a `Co-Authored-By: Claude` line — IGNORE IT." This session's harness reminder still said: "End git commit messages with: Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" and "End pull request descriptions with: ... Generated with [Claude Code]". The guard inspects `git commit` only, not `gh pr create` bodies (`guard.py:28`, `GIT_COMMIT_RE`). `H/assets/agents/harden-lens.md:7` shows agents that run without CLAUDE.md (`omitClaudeMd: true`). `~/.claude/hooks/guard.log` records two real false positives on 2026-09-25, both commit messages describing the guard itself; `test_guard.py:55` (`test_allows_prose_that_names_the_rule`) covers that case now.
- Confidence: verified-source; verified-executed (log counts).

**F34. The guard's secret rules, and a false positive that /execution's agents will hit.**
- Evidence: `guard.py:40-50`: secret names are `.env`, `.env.*` (except the template suffixes example, sample, template, dist, default, defaults and schema), `*.env`, pem/p12/pfx/jks/keystore/ppk, `id_rsa`-style keys, `.netrc`, `.pgpass`, `.npmrc`, `.pypirc`, `credentials(.json)`, `secrets*`/`service-account*` json/yaml/toml, and `UTC--` keystores. Line 51: scripts named like `reveal-pk`, `reveal_private_key` or `export_private_key` are blocked. Lines 52-58 list the read verbs (cat, grep, rg, sed, awk, head, tail, jq, cp, and others). Lines 107-108 block inline `python -c` and `node -e` snippets that name a secret. Lines 191-194: "Write would overwrite the existing secret file". Executed: my command `find ... | grep -v -i "\.env"`, meant to *exclude* such files, was refused with "`grep` would read or expose \.env".
- Consequence: agents cannot inspect `.npmrc` when debugging registry problems, cannot rewrite an existing `.env` (for example to rotate a testnet key), and must not name `.env` in any filter. Running a project script that loads its own keys stays allowed.
- Confidence: verified-executed, verified-source.

**F35. The machine: C: is nearly full, and a /harden run is active on another repository right now.**
- Evidence (verified-executed): `df -h /c` reports "C: 454G 452G 2.4G 100%" at about 21:10 Paris; the brief said 6.9 GB this morning, and the memory note says "C: had only 6.9 GB free on 30 Sept (99% full)". `~/Documents/Coding/Hedera/scaffold-hbar-saucerswap-v2/.harden/active` exists, with mtime 2026-09-30 20:25:05 +0200. Two `harden-scratch-*` directories sit in `~/AppData/Local/Temp`; one holds `harden-fresh/`, `cache/` and `fresh-install.console.txt`, and `du` on it did not finish within 100 s. That repo's `.yarn` directory is 325 MB. `run_state.py:29`: the scratch directory is created "under the OS temp directory", which is on C:.
- Inference: /harden's fresh clone and each verifier clone install dependencies on C:. Parallel installs from `/execution`'s waves compete for the same 2.4 GB.
- Confidence: verified-executed (measurements); inferred (the causal link between the harden run and the drop in free space).

**F36. Standing house rules that bind /execution's agents and reports.**
- Evidence: memory `feedback_language_french_convo.md`: "la conversation soit en français. Tout le reste — docs, specs, README, code, messages de commit — reste en anglais." Memory `feedback_windows_file_writing.md`: "`pathlib.Path.write_text()` / `open(..., 'w')` in Python convert `\n` to `\r\n`"; "The Write tool can decode `\uXXXX` escapes"; "Git Bash heredocs mangle backslashes". `K/references/08-assistant-failures.md:54-55`: "source code goes through the file-writing tool, never through a shell heredoc". The same file: "before I tell you something is missing, I must find it a second way" (26-28), "never chain a success message onto a command that can fail" (75-76), "When I dispatch agents to find defects, I dispatch a second pass to refute them" (87-90). `CLAUDE.md:32` ("remind the user to commit ... Want me to commit these changes?") is superseded for `/execution` by the owner's standing authorisation (decision 3). `CLAUDE.md:33`: "run `git log --oneline -20` ... at the start of a session or when resuming". `CLAUDE.md:37`: "draft an X post and offer it ... I write, Alexandre posts." `CLAUDE.md:57`: "Never present finished work as if it were happening now."
- Confidence: verified-source; reported (memory notes).

**F37. An agent must never write or promote /harden's profile. `/execution` may draft one outside the repository; only the owner turns it into consent.**
- Evidence: `H/assets/profile.schema.json` ("template" key): "A profile that still carries this key is the unreviewed template and is invalid: the owner reviews every field, deletes the key and saves the file as .harden/profile.json. An agent never does this for the owner." `H/SKILL.md:187-188`: "`run_state.py profile-template` drafts a profile for an owner who wants to write one; never promote it yourself". `infer_profile.py:7209-7211`: install refuses "an owner profile exists; it wins (U01-F05)". An owner profile kept outside the repository is passed as `/harden --profile <path>` (`H/SKILL.md:29`); Hedera keeps its profile at `~/Documents/Coding/Hedera/research/harden/profile.json`. A self-setup profile sets `"situation": "release preparation"` (`infer_profile.py:6388`).
- Consequence: `validate_profile.py` rejects a *tracked* profile but cannot tell an agent-written one from the owner's. The rule is a matter of discipline, not mechanics (inferred).
- Confidence: verified-source.

**F38. Events can ship their own capture tooling into the project, and /hackathon asks for honest periodic reporting.**
- Evidence: this session's skill listing includes `xrpl-feedback`, `xrpl-session-analysis` ("Use when the developer runs it, mid-day and end of day"), `xrpl-setup` ("asks for consent ... registers the hooks project scoped") and `xrpl-status`, all from `Coding/XRPL_Hackathon_2026/.claude/skills`. `K/references/07-contribution.md:149-160`: "Some events ship a tool that captures your session and asks for periodic analyses ... Report honestly, including empty periods."
- Confidence: reported (skill listing), verified-source (hackathon text).

---

## Implications for /execution

### 1. Interface contract: /hackathon → /execution → [/frontend] → /harden → fix → /prose → deliverables

The pipeline order is the owner's (memory `project_execution_skill.md`: "Pipeline: /hackathon (Phase A) -> /execution -> [/frontend pass] -> /harden -> /prose -> deliverables") combined with `CLAUDE.md:104` ("build complete → harden → fix → record → ship").

**Stage 0: /hackathon Phase A → /execution (inputs)**
- Files Phase A leaves, with paths per project (Origins: `~/Documents/Documents Perso/token2049/research/findings/`):
  - the rubric file, `00-rubric` "Extract, into one file": weights, format, deliverables and freeze time, the pre-existing-work rule, disclosure rules, tracks, and the organisers' answers;
  - the effort allocation table (criterion, weight, what scores full marks, owner, hours);
  - the recommendation or spec (Origins: `findings/wave3/_recommendation.md`, "demo storyboard, hour-by-hour core, risks");
  - the two sentences and the answers to the exit test;
  - `known-behaviour.md`, the expectation ledgers, the findings log and the graveyard notes;
  - the boundary decision (where pre-event material lives, gitignored);
  - the recon response rule ("copy under half a day the same day").
- Event profile, from the user: team (solo, or dev B on the same repo); presence (in person or remote); judging (live jury or asynchronous; what judges fetch); demo (live, recorded, format and length cap); channels (Discord by hand, Telegram through MCP, forum); deadlines with time zones; visibility (private until when, public, or judge access); the pre-existing-work rule; wallet state (testnet funded? mainnet set up by the user?).
- `/execution` entry conditions from this dimension:
  - the user has approved the plan;
  - `test ! -e <repo>/.harden/active` (a live /harden run owns the tree: F35 shows one exists today on Hedera);
  - under a no-prework rule, the product repository's first commit is after the event start: `git log --reverse --format=%cI | head -1` against the start time (F27);
  - free disk space on the volume that holds the temp directory is above a floor (F35).

**Stage 1: /execution → [/frontend] → /harden (the "build complete" hand-over)**

`/execution`'s exit gate should be a phase-scoped completion check (F30): every `build` item PASSes while the `harden` and `deliverable` items stay open by design. On top of that, a **harden-ready** gate made only of commands:

- H1: `git rev-parse HEAD` succeeds (/harden refuses a repository with no commit).
- H2: `.harden/active` is absent.
- H3: `git status --porcelain=v1 --untracked-files=all` prints nothing outside `.harden/` (F02). `/execution`'s run directory is listed in `.git/info/exclude` or sits outside the repository.
- H4: `git grep -nE '\b(describe|it|test)\.only\(|\bfit\(|\bfdescribe\('` finds nothing (F04).
- H5: the self-setup dry run with every output outside the repository (F12): `prescan.py --repo R --out X/prescan.json`; `inventory.py --repo R --out X/inventory.json --quiet`; `infer_profile.py infer --repo R --inventory X/inventory.json --out-dir X`; `infer_profile.py probe --repo R --out-dir X`; `infer_profile.py finalize --repo R --out-dir X --json` **without `--install`**. Pass when the profile has at least one test gate, `mode` is not report-only and `live_side_effects` is `none`.
- H6: the baseline: a gates.py config holding the finalized gates, then `gates.py --config X/cfg.json --label handover --repeat 3 --out-dir X/gates` exits 0 and the JSON lists no flaky gate (F03, F11). The test gate includes a shuffled run with a fixed seed.
- H7: the fresh clone: `git clone --no-local R <scratch>/fresh`, the lockfile-enforcing install, then `gates.py --repo <scratch>/fresh --config X/cfg.json --out-dir X/gates --label fresh` exits 0 (F06).
- H8: no file that test or build tools auto-load (Next.js or Vite `.env*`, `.env.yarn`) sits in the tree during /harden. These are parked by the human, a manual task (F05). `run-harden.sh:22-30` is the model check.
- H9: `python ~/.claude/skills/harden/scripts/harden_agents.py status` exits 0, and the agents were installed before the session that will run /harden (F14).
- H10: free space on the temp volume is at least a floor sized for three installs plus a margin (F35; the size is inferred).
- H11: the time left before the first deliverable anchor is at least /harden's budget (60 + 20/KLOC, clamped 120-600 min) plus the review/merge, fix, record and ship reserves (F07). Otherwise `/execution` proposes and waits (decision 2): `/harden <paths>`, `--report-only`, or an owner-reviewed profile with `budget.max_minutes`.
- H12: on-chain sources are frozen, and the evidence tied to their deployed addresses is recorded. For non-Solidity chains, `/execution` proposes scoping /harden away from them (`/harden <paths>`) or schedules redeploy plus evidence regeneration afterwards (F09).
- H13: the docs are true: the README's commands run, `.env.example` matches the variables the code reads, and no TODO or TBD sits in any judge-facing file (F10; `CLAUDE.md:99`).
- H14: the latest run of a GitHub Actions workflow on GitHub-hosted runners, which runs the offline gates literally with no secrets, vars, environment, `continue-on-error` or job-level `if:`, is green on HEAD (F05). The completion check itself stays out of CI (F29).
- H15: a script prints the hand-over message from files and git (F17). It carries the HEAD sha, the gates JSON paths, the dry-run profile summary (gates and bans), the files parked, the time left against /harden's estimate, and the exact thing for the user to type: `/harden`, `/harden <paths>` or `/harden --profile <path>`. `/execution` never invokes /harden (F01).

`/execution` must not write anything under `.harden/`, write or promote a profile (F37), run `finalize --install`, invoke `/harden`, or leave untracked files or a `.only` behind.

**Stage 2: /harden → fix wave (re-entry of /execution)**
- /harden hands back (F08): branch `harden/<date>`, local and unpushed; `.harden/report.md` with the sections Applied, review before merge; Needs your decision; Open owner items; Limits; Residual risk; `.harden/findings.json` (a status per finding); `.harden/verify.json`; the script-printed final message.
- Manual task: the user reviews the "Applied, review before merge" commits, each listed with its `git revert <sha>`, and merges.
- The fix wave runs the items the user picks, plus redeploy and evidence regeneration if an on-chain source changed. Entry: `.harden/active` is absent and the harden branch is merged. Exit: the gates (H6, H7) are green again and the push is done (standing authorisation).

**Stage 3: /prose and the deliverables**
- `/prose` entry: the claims ledger is closed (no `unverified` row; every claim checked in every place it appears); the facts sit in `known-behaviour.md`, the DX journal and the evidence files; /harden's docs lens has run; the two sentences are final (F32).
- `/prose` output: rewritten files; a report with `prose_check.py --shape` before and after, every rule that fired with file:line, refused candidates, and missing facts. Each missing fact becomes a manual task for the owner, never an invented fact.
- Then, in order: the demo audit (T-6h, if not already run on the final tree); recording (human); slides (for Origins, `.ppt` or `.keynote` with the video embedded, F26); README screenshots last (decision 5); the public flip or the judge-access grant, then the judge's fetch run twice from a clean directory; the form (human); tag the submitted commit; no push after the deadline or the tag (F31; Origins "No changes after the deadline").

### 2. Phase B tasks /execution must schedule, with triggers by event shape

Owners: **A** means an agent can do it; **H** means only a human can (F23); **H+A** means the human acts and an agent drafts or records. The proofs are suggestions for the designer (inferred), except where a quote gives them.

| # | Activity (content stays in /hackathon) | Trigger | Output | Owner | Suggested proof of done |
|---|---|---|---|---|---|
| 1 | Open the DX journal (`assets/dx-journal.md`) | T0, every shape | journal file | A | the file exists with its header at T0 plus a few minutes |
| 2 | Add a journal row at each friction, before the fix (`07-contribution.md:42`) | each failure, continuous | rows with verbatim text, UTC times | A for agent frictions; H reports wallet or UI frictions | each `fix:` commit that names an error has an earlier row (heuristic) |
| 3 | Open the claims ledger (`assets/claims.md`) | T0 | ledger | A | the file exists |
| 4 | Add a row for every claim (numbers, counts, firsts, negatives, promises, attributions) | continuous | rows | A | every row has an evidence cell |
| 5 | Close the claims ledger | at the freeze, which /execution defines (F20) | closed ledger | A, then H reads the claims aloud | no row with status `unverified`; each claim found in every place listed |
| 6 | Add known-behaviour rows and actuals in the expectation ledger | each verified fact or new call | rows | A | each row cites a hash or a file:line |
| 7 | Organiser questions in writing, in the public channel | day one (`00-rubric.md:65`) | answers in the rubric file | H posts, A drafts and files the answers | an answers section with who said what and when |
| 8 | Reconnaissance passes (field, organisers, sponsor) | cadence table (F21); response rule set before reading | dated notes and copy/no-copy decisions | H for Discord and the room; A for Telegram MCP, forums and public repos | a dated notes file per pass |
| 9 | Field reading in the room (the two moves) | in person, during the build | team, assumption, where it bites | H | notes pasted back |
| 10 | Visibility calendar: flip, then the judge's fetch twice, then submit | remote or private-while-built only; never on travel or submit day (`06-operations.md:46-47`) | public repo or judge access | H approves (forks survive a flip back), A runs the checks | `gh repo view --json isPrivate` false; the judge's command exits 0 twice from a clean directory |
| 11 | Verify along the judge's path (`02-verification.md` table) | after build complete, again after harden | shape-specific | A, or H at the venue | per shape |
| 12 | Adapt `preflight.sh` so it can say no | before the first rehearsal or recording | a project preflight | A | exits non-zero on stale demo state and on a dead frontend (F25) |
| 13 | Demo audit, one agent per beat plus a refutation pass, against a live instance | T-6h, every shape; before recording when the demo is a video | fixes re-verified, plus a hard-questions file | A; the presenter (H) receives the survivors | an audit record where each survivor is fixed (sha) or listed in hard-questions |
| 14 | A command that makes your own checker fail | when claims can be checked by a stranger (F22) | command and test | A | exits 1 on tampered data |
| 15 | Adversarial pass on anything written, then a blind read | before submission (README, form, video script) | attacker findings, fixer verdicts, the blind reader's answer verbatim | A | refuted findings recorded as refuted |
| 16 | Recount every number from the artifacts | the morning of the pitch; before recording | refreshed numbers | A | the regenerated counts equal the counts in the docs |
| 17 | Re-verify hashes and fetch every link | before anything goes public | a link report | A | each link fetched and its content checked (a single-page app answers 200 to a missing route) |
| 18 | Run of show (or video script) | written before rehearsal, updated after the audit | runsheet or script | A drafts, H rehearses on the presenting machine | video: word count at 130-145 wpm within the cap (Origins Cardano track: 3 min or less) |
| 19 | Memory, ports and orphan processes; the presenting machine | an hour before the pitch (live) or before recording | a preflight line | H | the memory line is above 2.5 GB |
| 20 | Time-limited demo state: expiry and rebake | before rehearsal and recording | expiry in the runsheet, a rebake command | A | preflight re-run after the rebake |
| 21 | Record the video (the backup, or for Origins the only one) | last, after the audit and after harden (`CLAUDE.md:104`) | the video | H | the file exists; timestamp after the last code commit |
| 22 | Name a competitor as a customer | live pitch, placed late; needs listening in the room | one sentence in the notes | H listens, A drafts | n/a |
| 23 | Periodic reports to event-shipped capture tools | the tool's cadence (XRPL: mid-day and end of day) | honest reports, empty periods included | H consents, A drafts | the tool's status command |
| 24 | Freezes (validator or contract, code-for-recording, docs), then the tag and a push freeze | /execution-defined times (F20, F31) | a tag and a recorded sha | A; H approves the times | the tag exists; no commit after the tag or deadline on the pushed branch |
| 25 | X post offers at milestones (`CLAUDE.md:37`) | first end-to-end run, a surprising number, a real failure | a draft in `posts.md` | A drafts, H posts | n/a (never automated) |

**What changes with the event's shape** (F22):
- **24 hours in a room.** Recon at the halfway point and about 2 h before submitting. No visibility calendar, since the work is public when presented. The judge's path is the presenting machine and the venue network. Run of show, rehearsal, memory check and backup video apply. Field reading happens in person.
- **A weekend.** Recon on the evening of day one and the morning of the last day.
- **One to three weeks, remote.** Recon weekly, every two days in the last week, with a final pass three days before and never on the day. The visibility calendar applies (flip early, run the judge's fetch twice, submit last). The judge's path is the tool-built artefact or a fresh clone. The README is the pitch when there is no stage. Field reading means cloning and grepping public entries.
- **Live jury versus asynchronous.** A live jury needs the run of show, the hard-questions file in the presenter's head, the questions protocol and slides. Asynchronous judging needs the README, the form fields and the video script under `/prose`.
- **Live demo versus recorded video.** The T-6h audit is mandatory for both. A recorded demo takes the video script rules (`04-pitch.md:55-60`) and "record it last". A live demo takes the machine and memory checks.
- **Origins (hybrid).** The build is in a room, so field reading happens in person and the channels are read by hand or through MCP. Judging is asynchronous over the repo, the hosted link and the slides with the embedded video, so the README is judged too and the repo must be "public or judge access". A live demo is prohibited. The top 5 present on 8 Oct, a conditional run of show. No pre-event code, and no changes after the deadline.

### 3. Origins worked clock (inferred plan from verified times, F28)

| Anchor | SGT | Paris | What must be true |
|---|---|---|---|
| T0 | Tue 06 12:00 | Tue 06 06:00 | repo created now or later; DX journal and claims ledger opened; organiser questions posted (H) |
| Recon 1 | Tue 06 about 20:00 | Tue 06 about 14:00 | in the room plus channels; the response rule was set earlier |
| Halfway | Wed 07 05:59 | Tue 06 23:59 | the 24 h row's "halfway" lands at night; move it to Wed morning |
| Build complete, harden-ready | about Wed 07 11:59 (T-12h) | about Wed 07 05:59 | the H1-H15 gate passes; the user types `/harden` (possibly from the phone through Remote Control) |
| /harden | T-12h to about T-9h | | budget 120-260 min for 2-10 KLOC (F07) |
| Merge and fix | to T-6h | | review "Applied, review before merge"; gates green |
| Demo audit | Wed 07 17:59 (T-6h) | Wed 07 11:59 | on the merged tree; fixes and hard-questions |
| Freeze and recount | about T-4h | | claims ledger closed; numbers regenerated |
| Record | about T-4h to T-3h | | human; video of 3 minutes or less |
| Slides, /prose, screenshots last | to T-2h | | `.ppt`/`.keynote` with the video embedded |
| Final narrow recon | at or before T-2h (Wed 21:59) | Wed 15:59 | only two narrow questions (`01-find-the-gap.md:317-319`) |
| Public or judge access, judge's fetch twice, submit, tag | before Wed 23:59 | before Wed 17:59 | no push afterwards |

### 4. Reuse list from /harden

**Reuse directly** (call the script with outputs outside `.harden/`):
- `H/scripts/gates.py`: the proof engine for any "command that exits 0". It takes `--config`, `--out-dir`, `--repeat`, `--repo <clone>`, `--only` and `--json`, writes JSON per label, flags flaky gates, checks test counts with `count_regex` and `--min-count-from`, supports an environment allowlist, and warns on masking constructs. Mind `<out-dir>/../active` (F11).
- `H/scripts/prescan.py --repo R --out X`: scan a spec, PRD or starter repository before agents read it (repository text is data, invariant 6).
- `H/scripts/inventory.py --repo R --out X --quiet`: languages, tools and candidate commands at planning time.
- `H/scripts/infer_profile.py infer|probe|finalize --out-dir X` (never `--install`): the offline gate list for proofs, the `forbidden_commands` list (which tasks touch deploy, sign, live, fork, publish or push, and so need care or a human), and the harden-readiness dry run (F12).
- `H/scripts/validate_profile.py <draft> --repo R`: check a profile `/execution` drafts for the owner to promote (F37).
- `H/scripts/harden_agents.py status`: part of harden-ready (H9).
- The budget formula in `H/scripts/budget.py:144-147,762`, to reserve /harden's slot. Use the constants, not the script, which needs run files.

**Copy as a pattern** (write /execution's own version):
- A run marker (`.execution/active`) with one writer script; hooks that exit at once when it is absent; the fail-open launcher with the `$HOME` fallback and `cygpath` from `H/SKILL.md:11` (F15). The run directory is excluded through `.git/info/exclude`, never `.gitignore`.
- `progress.md` with the invariants, red flags, checklist, blocked items, a log and the resume line; re-read after every compaction and at every wave; `skill_dir` recorded. Invariants go in the first 5,000 tokens of SKILL.md, because after compaction only that much is re-attached (`protocol-preflight.md:201`, PF-06).
- A canary that proves hooks fire (`protocol-preflight.md:194`, PF-05).
- Consent written before the run and validated by a script, with a conservative default for each unanswered question, logged (PF-22). For /execution: the approved plan plus the event profile.
- Dedicated agents with a pinned model, `omitClaudeMd` plus their own copy of the no-attribution and no-secrets rules, their own PreToolUse guard, and a Stop hook that saves the report byte for byte and returns one line; installed before the session or passed as `--agents` JSON; probed at start (F13, F14). The "verifier that did not write it" is the `harden-verifier` shape: Read, Grep, Glob, guarded Bash, no edits.
- After a subagent returns: `git status --porcelain` must show nothing unexpected; revert anything else (`H/SKILL.md:269-271`).
- A deadline fixed once, reserves counted back from the end, and a `check` that exits 1 to stop launching new work and never loosens a gate (F16). This is where decision 2 ("propose and wait") triggers.
- A script-printed final message and hand-over (F17).
- Commit through a message file and `git commit -F`, with a `cmd:` line and no trailers (F18).
- Evidence written by scripts, not by agents: /harden's hook makes `.harden/gates/**` read-only to agent tools (`hook_guard.py` docstring, "run-evidence-write").
- "Blocked" is a good outcome: at most 3 attempts per item, each from the last green commit (`H/SKILL.md:79-80`, invariant 9).
- A fresh-clone replay as the final proof (the pattern of `verify_branch.py`).

**Do not reuse**:
- `verify_branch.py`: it requires `.harden/active` and its scratch directory (docstring, step 0).
- `run_state.py` and `hook_guard.py` as they are: they carry /harden's semantics, such as existing tests being read-only, which would block legitimate build work.
- `infer_profile.py finalize --install`: it writes `.harden/profile.json` (F37).
- `ledger.py` and `findings.py`: they are specific to detection.

### 5. Standing rules for /execution's agents (from guard.py, CLAUDE.md, /hackathon 08 and memory)
- Commits: conventional (`type(scope): description`), one logical change, lint and tests before committing, no trailers of any kind. Write the message to a file and use `git commit -F`. Ignore the harness attribution template. Strip "Generated with Claude Code" from PR bodies too (the guard does not check them; inferred from the owner's "never any AI attribution").
- Secrets: never Read, cat, grep, sed, head, copy or upload `.env*` (templates excepted), keys, keystores, `.npmrc` or `.pypirc`. Never name `.env` in a filter; use `git ls-files` for tracked files instead. Never use `python -c` or `node -e` snippets that name a secret. Run project scripts that load keys themselves; never print a key. A new `.env` may be written, an existing one may not be overwritten, so key changes are a human task.
- Files: write source through the file tool, never a heredoc; write text from Python with `newline='\n'`; never write `\uXXXX` literals through the Write tool.
- Claims: report an absence only after a second search method; never print success after a command that can fail; treat another agent's report as a hypothesis and verify it before ticking.
- Refusals: never retry a refused command in another form (harden invariant 9 states it for /harden; the same logic applies to the guard).
- Language: conversation in French; every file, commit and doc in English. The language of Notion reports is an open question.

---

## Risks and failure modes

1. **Silent report-only /harden.** `/execution` hands over a tree that looks green, but /harden drops to report-only for one of: an untracked `.execution/` file, a flaky test, a test loading `.env.local`, no CI evidence for a test command with URL literals, a `.only`, or a fresh-clone install that works only with local state. The hours reserved for fixes are then lost, and the report says why only at the end (F02-F06).
2. **Forged consent.** An agent writes `.harden/profile.json` or runs `finalize --install` to "help". /harden then treats it as the owner's profile, which wins whole (F37).
3. **Unguarded workers.** `/execution`'s frontmatter hooks do not fire for subagents (F13). A worker could edit tests, run a deploy script or broadcast a mainnet transaction without the skill noticing. Only the global guard (attribution and secrets) still applies.
4. **Attribution loop.** A worker launched without CLAUDE.md follows the harness template, the guard blocks the commit, and the worker retries or stalls (F33).
5. **Guard false positives.** A worker's reasonable `grep -v .env` or `cat .npmrc` is blocked; a naive agent may try another form (F34).
6. **Disk exhaustion.** 2.4 GB free on C:; /harden's clones and parallel dependency installs all land there; a /harden run is live on Hedera now (F35). Installs failing mid-wave look like code failures.
7. **Timeline collapse on a 36-hour event.** /harden alone is 2-4 h on a small repo, and the 24-hour "halfway" recon lands at 06:00 SGT (F07, F21, F28). If build-complete slips past about T-12h, CLAUDE.md's order (harden before record) and the T-6h audit collide.
8. **Cardano validators unprotected by /harden.** Changes pass unflagged, no gate covers `aiken`, the script hash changes, and the recorded evidence goes stale silently (F09).
9. **False proofs from /hackathon assets.** `preflight.sh` and the deck builder exit 0 on the very defects they print (F25).
10. **Wrong deliverable format.** The HTML deck is not a `.ppt` or `.keynote` with an embedded video (F26).
11. **Disqualification by prework.** Code committed before T0 in the event repository, or the rehearsal fixture repository reused as the event repository (F27).
12. **Judge-visible internals.** /hackathon's layout puts `docs/runsheet.md` and `docs/hard-questions.md` in the product repository (`preflight.sh:116-119`). A public repo would expose the caveats chosen for answering in person, and the TODO gate scans `docs/` (F24, F30).
13. **An unreachable exit.** Copying the BNB completion-check pattern without phase tags makes build-complete impossible, because the harden, video-URL and public-flip gates are open by design at that point (F30).
14. **Push after the deadline.** The standing push authorisation, left unchecked, conflicts with "No changes after the deadline" (F28, F31).
15. **A second developer while /harden runs.** Dev B keeps pushing to the branch /harden started from, and the harden branch no longer merges cleanly (inferred).
16. **Noise.** CLAUDE.md's "remind the user to commit" and "offer an X post" fire during an autonomous run unless `/execution` states that its standing authorisation supersedes the first and routes the second to Notion (F36).
17. **Headless relaunch pitfalls.** `claude -p` from Git Bash needs `MSYS_NO_PATHCONV=1` and the unset session variables that `run-harden.sh:39-46` uses. Without `py.sh`, a Python hook exits 2 and blocks every tool (F15).

## Open questions

1. During a 36-hour event, should /harden run in full, scoped (`/harden <paths>`), report-only, or under an owner-reviewed profile with `budget.max_minutes`? If a profile is used, who drafts it, and is its promotion a manual task on the plan?
2. Should the T-6h demo audit run before or after the /harden merge? /hackathon anchors it in time; CLAUDE.md's order puts harden before recording. The proposal above audits the merged tree and falls back to the pre-harden tree if /harden overruns.
3. Where do /hackathon's sprint files live: the product repository (judge-visible), a private workspace like Hedera's `research/findings/`, or Notion only with a local mirror?
4. Is Phase C (upstream filings, memory, X post offers) in /execution's scope, or does it end at the deliverables?
5. Can agents spawned through the Workflow tool use custom agent definitions with their own hooks (the harden-verifier pattern)? The owner's note says hooks cannot be tested inside workflow subagents.
6. What freezes does Origins need, and when: validators or contracts, code for recording, docs, and the push freeze after the tag?
7. Which branches: `main` with feature branches (`git-conventions.md:29`), which branch /harden starts from, and how does dev B sync around a /harden run?
8. Should Notion wave reports be written in French (the conversation) or English (files)?
9. How should the recon cadence map onto a 36-hour in-person event with a night in the middle?
10. For Origins: flip to public, or grant judges access? And is the 8 Oct top-5 stage slot a conditional run-of-show task?
11. What free-space floor applies before each wave and before hand-over, and should `TMP`/`TEMP` and harden's scratch directory move to another drive?

## Sources

Local primary sources (read on 2026-09-30):
- `~/.claude/skills/hackathon/SKILL.md`; `references/00-rubric.md`, `01-find-the-gap.md`, `02-verification.md`, `03-claims-ledger.md`, `04-demo-audit.md`, `05-pitch-craft.md`, `06-operations.md`, `07-contribution.md`, `08-assistant-failures.md`, `09-previous-rounds.md`; `assets/claims.md`, `dx-journal.md`, `expectations.md`, `findings-log.md`, `known-behaviour.md`, `runsheet.md`, `preflight.sh`, `deck/content.md`, `deck/build.mjs`.
- `~/.claude/skills/harden/SKILL.md`; `references/protocol-preflight.md`, `protocol-change.md` (lines 44-52), `lens-readability-docs.md` (headings), `prioritization.md` (situation); `research/skill-design.md` (T31-F01, F02, F03, F07, F08, F10, F11, F13, F14, F15, F16, F17, F19, F20, F21), `research/user-policy-autonomy.md` (U01-F01 to F14), `research/pilot-auto-calibration.md` (A01-F41, F42, F45); `scripts/run_state.py`, `gates.py`, `infer_profile.py`, `inventory.py`, `prescan.py`, `validate_profile.py`, `budget.py`, `hook_guard.py` (docstring), `verify_branch.py` (docstring), `harden_agents.py`, `ledger.py` (docstring), `_common.py`, `validate_findings.py`; `assets/config.example.json`, `profile.example.json`, `profile.schema.json`, `findings.schema.json`, `report-template.md`, `agents/harden-lens.md`, `agents/harden-verifier.md`; `evals/pilots-auto-2-to-4.md`, `evals/pilot-auto-2026-09-25.md`.
- `~/.claude/skills/prose/SKILL.md`, `references/04-pitch.md`, `scripts/prose_check.py`.
- `~/.claude/CLAUDE.md`; `~/.claude/rules/git-conventions.md`, `env-conventions.md`; `~/.claude/hooks/guard.py`, `py.sh`, `test_guard.py`, `guard.log` (counts only); `~/.claude/settings.json` (hooks); `~/.claude/agents/*.md` (frontmatter).
- `~/.claude` git history: commits `29b23c1`, `4884ab3`.
- Owner memory: `~/.claude/projects/C--Users-Utilisateur/memory/project_execution_skill.md`, `project_harden_skill.md`, `project_token2049_origins.md`, `feedback_windows_file_writing.md`, `feedback_language_french_convo.md`.
- Prior art: `~/Documents/Coding/BNB/holdover/scripts/completion-check.mjs`; `~/Documents/Coding/Hedera/research/findings/TASKLIST.md`; `~/Documents/Coding/Hedera/research/harden/run-harden.sh`.
- Origins rules: `~/Documents/Documents Perso/token2049/research/findings/rubric.md` (lines 1-40).

Executed checks (this session): `--help` of `run_state.py`, `gates.py`, `infer_profile.py` (and subcommands), `inventory.py`, `prescan.py`, `validate_profile.py`; `claude --version` (2.1.286); `df -h /c`; `stat` of the Hedera `.harden/active`; `du` of `.yarn` and of the scratch directories; the Origins clock with Python `zoneinfo`; greps for freeze, Cardano, Aiken and the guard log categories; the global guard refusing one of my own commands.

External sources as quoted inside the /harden dossiers (not re-fetched here): Claude Code docs "Hooks reference" (https://code.claude.com/docs/en/hooks), "Create custom subagents" (https://code.claude.com/docs/en/sub-agents), "Extend Claude with skills" (https://code.claude.com/docs/en/skills), "Best practices for Claude Code" (https://code.claude.com/docs/en/best-practices), "Configure the sandboxed Bash tool" (https://code.claude.com/docs/en/sandboxing); GitHub Docs on Actions secrets and hosted runners (https://docs.github.com/en/actions/concepts/security/secrets); Anthropic "How we built our multi-agent research system" (https://www.anthropic.com/engineering/multi-agent-research-system).
