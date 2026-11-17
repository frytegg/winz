# Local past builds: how the user's hackathon builds were orchestrated with Claude Code, and what went wrong

Dimension: past orchestration practice (read-only). Researched 2026-09-30 by one agent of the /execution research
team. Every claim below cites a file (path:line) or a transcript (path + UTC timestamp) or a command I ran. Paths use
forward slashes. `~/.claude/projects/<P>` means `C:/Users/Utilisateur/.claude/projects/<P>`.

Material read: 97 persisted Workflow run records (`~/.claude/projects/*/*/workflows/wf_*.json`), the 26 build and
event workflow scripts, three run journals, the memory stores of the home, Hedera, BNB and XRPL projects, the Hedera
build notes (`Documents/Coding/Hedera/research/build/day1..day7`), `TASKLIST.md`, BNB `research/TASKS.md` and
`holdover/scripts/completion-check.mjs`, the XRPL `docs/02-TIMELINE.md`, `11-TASKS-BACKEND.md`, `21-TASKS-FRONTEND.md`,
`45-RUNSHEET.md`, `47-MATIN.md`, `48-PROMPT-DEVB-FEEDBACK.md`, the /hackathon references `06` and `08`, the /harden
overnight plans in its session scratchpad, and user messages extracted (not whole transcripts) from the Hedera, BNB,
XRPL and Monad sessions. No `.env` or credential file was opened.

---

## Summary for the designer

1. The user already ran a hand-driven /execution: a plan file (Hedera `TASKLIST.md`, BNB `TASKS.md`) + one Workflow per "day-wave" (sole-installer foundation -> parallel file-disjoint builders -> integrator -> read-only adversarial reviewer -> fixer that re-confirms each finding) + an orchestrator routine between waves (re-verify, trailer grep, push, dispatch CI, poll, update plan and memory). Hedera: 10 waves, 44 agents, 16.5M tokens, 26.8 h of workflow time over 38 h; one day-wave = 3-4 h, 4-8 agents, 2.3-3.1M tokens.
2. The code-writing rarely failed. The loop around it did: usage limits (11 h and 4.5 h of overnight time lost; the weekly quota exhausted twice in the week of 23 Sept), plan drift (TASKLIST stale within a day, dated items silently skipped), lenient proofs (a forged evidence record accepted, a skipped check reported as ok, receipts matched by file name), disk full four times (0 MB, 0.78 GB, 278 MB; 2.4 GB free tonight), context compaction during every event, and deliverables started before the build was complete.
3. The best prior art for the autonomous loop is the /harden overnight run: a ticked plan file plus a CronCreate watchdog every 30 min that checks real state and resumes with `resumeFromRunId`. It failed only when the weekly quota ran out.
4. Weekly resets were observed on Wed 23 Sept and Wed 30 Sept at 04:00 Paris. If the cadence holds, the next is Wed 7 Oct 04:00 Paris = 10:00 SGT, 22 h into the Origins window: the first 22 h of the hack draw on the same week as tonight's /harden, /prose and the /execution rehearsal.
5. Completeness checks must put the burden on "done": the 30 Sept pre-harden workflow's two-skeptic, default-refuted layer rejected all 9 plan-vs-tree findings, mostly because the plan lived outside the repo.
6. For two developers the XRPL recipe worked (frozen contract, real fixture server, path ownership, hard checkpoints, a self-contained prompt for dev B), but the no-AI-attribution hook is machine-local and did not protect dev B.

---

## Findings

### A. The de-facto build wave and what it cost

**F01. A Hedera build wave had a fixed shape: serial foundation (the only agent allowed to install), parallel file-disjoint builders, an integrator, a read-only adversarial reviewer, then a fixer run only if the review found anything above minor.**
Evidence: `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera--scratch/6052e9a6-d475-44b3-8b24-4e8c24b70da1/workflows/scripts/hedera-template-base-and-skeleton-wf_c24b73a4-4a5.js:4-10`: `{ title: 'Base', detail: 'real CLI scaffold + base rules, verified green locally' }, { title: 'Parallel', detail: 'file-disjoint: CI workflows, route hardening + probe, docs/manifest/rewrite checkers' }, { title: 'Integrate', ... }, { title: 'Review', detail: 'adversarial review against the decision document, then fixes' }`; line 69: `you are the ONLY agent allowed to run the main dependency install`; line 151: `if (review && review.findings && review.findings.some(f => f.severity !== 'minor')) {` ... `else { log('Review found nothing above minor severity; skipping the fix agent') }`. The same shape recurs in day2 (`hedera-template-day2-wf_fad060d4-d39.js:4-9`), day3, day4-lp, docs-traps, readme, day7.
Confidence: verified-source.

**F02. The BNB variant was a per-lane pipeline (builder -> reviewer that fixes), agents never committed (the parent reviewed and committed), and two workflows ran on the same repo at once, fenced only by file ownership stated in the prompt.**
Evidence: `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-BNB-holdover/f3a0fee8-143f-434c-aba6-de59c871fd80/workflows/scripts/holdover-engine-and-hygiene-wf_5e087bd4-4d3.js:22-23`: `A parallel workflow is writing packages/sources/src/{chain,sponsor-keyed,sponsor-keyless,lending,pools}.ts RIGHT NOW — do not edit those files`; line 37: `Do not commit; I review and commit. Do not push.`; lines 158-180: `pipeline(LANES, (lane) => agent(... build ...), (built, lane) => agent(... You are the ADVERSARIAL REVIEWER ... Fix what you find, re-run until green ...))`. Run records: holdover-sources started 2026-09-22 22:41Z and holdover-engine-and-hygiene 22:45Z (both completed). Orchestrator commits in the BNB transcript used `git add -A` (e.g. 2026-09-23T16:40Z `git add -A && git commit -q -F - <<'EOF' docs(readme): ...`).
Confidence: verified-source.

**F03. At the in-person XRPL event the build itself was not run by workflows: the user drove the main session step by step, and workflows were used only for pre-event specs, the post-workshop rescope, overnight documents with a writer->verifier pair per page, the demo-path audit and the filing prep.**
Evidence: user messages in `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-XRPL-Hackathon-2026/923db298-ebe9-4ef8-8731-636d9035dd74.jsonl`: 2026-09-12T14:21Z `go ahead, build the poller`, 14:55Z `go ahead with the escrow collateral flow`, 15:05Z `go ahead with the oracle publisher`, 15:12Z `wire the publisher into the poll loop`, 15:16Z `go ahead with the FCL history and reputation`. Workflows of the event (run records): xls6566-deliverables 09-12 01:12Z (4 agents, the three spec+tasklist pairs, written `04:10 and the team is asleep`), workshop-rescope 09:23Z, orma-mintlify-docs 22:23Z (21 agents; log `10/10 pages written and verified, 63 factual errors caught and fixed`), orma-readme-paper-deck 22:25Z, orma-annex-finishing-pass 09-13 07:30Z, demo-path-audit 09:33Z (31 agents, 13.8 min, log `16 confirmed after adversarial verification`), filing-prep 10:53Z. Monad Blitz (one day, in person) was the same: the user parallelised by hand, 2026-09-19T13:37Z: `j'ai d'autres terminal ici meme qui s'occupent d'autres pages du frontend pour paralleliser le travail` (`~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Monad-Blitz-Paris-auramaxx/5db41ea3-0e77-4306-b1f2-7b337466d452.jsonl`).
Confidence: verified-source.

**F04. Measured wave cost (Workflow run records, `totalTokens`, `durationMs`, per-agent `durationMs`/`tokens`).**
Evidence: my script over `~/.claude/projects/*/*/workflows/wf_*.json` (union of run intervals for busy time):

| project | runs | agents | tokens | workflow-busy | calendar span | builder agent median / max | reviewer median |
|---|---|---|---|---|---|---|---|
| Hedera template (22-23 Sept) | 10 | 44 | 16,515,013 | 26.8 h | 38.4 h | 46 / 124 min | 26 min |
| Holdover (BNB, 22-23 Sept) | 4 | 30 | 8,350,919 | 4.0 h | 15.6 h | 32 / 52 min | 20 min |
| Orma event (12-13 Sept) | 7 | 77 | 9,625,779 | 3.3 h | 34.0 h | writers 8 / 31 min | verifiers 2 min |

Hedera waves one by one (start UTC, minutes, agents, tokens): base-and-skeleton 09-22 09:27 (resumed) 196.6 / 8 / 2.54M; day2 13:40 231.0 / 6 / 3.11M; npm-typecheck-fix 17:46 200.6 / 2 / 0.88M; day3 21:09 189.6 / 5 / 2.28M; day4-lp 09-23 06:40 239.0 / 5 / 2.35M; docs-traps 11:46 90.9 / 3 / 0.78M; readme 13:34 79.8 / 3 / 0.78M; lock-and-audit 16:20 70.6 / 4 / 1.08M; day6 18:01 208.2 / 4 / 1.50M; day7-moves 22:10 100.1 / 4 / 1.23M. Every Hedera and Holdover agent ran on the session default model (`defaultModel: claude-opus-5[1m]`). No USD figure exists for any build workflow; USD was only recorded for /harden pilots (F41).
Confidence: verified-executed.

**F05. Between waves the orchestrator ran a fixed routine: re-verify the load-bearing claims itself, grep the new commit messages for AI trailers, push, dispatch the full CI matrix, poll until every run completes, read failed logs, update TASKLIST and memory, then launch the next wave.**
Evidence: Hedera transcript `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera/6052e9a6-d475-44b3-8b24-4e8c24b70da1.jsonl`, tool calls 2026-09-22T21:08Z `git log origin/main..main --format=%B | grep -icE 'co-authored-by|signed-off-by|anthropic|generated (with|by)'`; 2026-09-23T00:20Z `git push origin main; ... gh workflow run gate.yml -R frytegg/scaffold-hbar-saucerswap-v2`; then `for i in $(seq 1 80); do n=$(gh run list ... select(.status!="completed")] | length') ...; [ "$n" -eq 0 ] && break; sleep 30; done`; 2026-09-24T10:58Z `gh run view 35976132523 --log-failed`. TASKLIST rows record the orchestrator's own checks, `Documents/Coding/Hedera/research/findings/TASKLIST.md:23`: `Sourcify v2 exact_match on creation and runtime (re-checked by the orchestrator)`; line 28: `Independently re-verified by the reviewer (14/14 transactions in the mirror DETAIL view) and by the orchestrator`. Memory rule, `~/.claude/projects/C--Users-Utilisateur/memory/project_hedera_scaffold_bounty.md:134-135`: `TASKLIST is the contract ... Keep it updated after every workflow.`
Confidence: verified-source.

**F06. The brief that worked was one shared context block plus one task block per agent, with explicit ownership, machine and git rules, and a notes file per agent.**
Evidence: `hedera-template-base-and-skeleton-wf_c24b73a4-4a5.js:21-31`: `Sources of truth (read what your task names, in full): ...PHASE-A-DECISION.md — sections 5 ..., 6 ..., 7 ..., 8`; `Git: commits are authorised locally — conventional commits ... ONE logical change per commit, and ABSOLUTELY NO "Co-Authored-By" ... NEVER push`; `Machine rules: disk is limited (about 28 GB free) ... ONE dependency install at a time ... never start Docker; any server you start binds the port named in your task, is killed afterwards ... Write files with the Write/Edit tools, never a shell heredoc (heredocs mangled source files twice today). Never chain a success message onto a command that can fail`; `Reporting: write your notes to ${NOTES}\\<your-slug>.md ... Your structured output is a faithful digest.` Task blocks start `## Your task (slug: ci) — you own ONLY ${REPO}\\.github\\ and ${REPO}\\tools\\gate\\ . Do not edit any other path (no package.json: list the root scripts you need in your output instead)` (line 82). Day 3 added a docs rule, `hedera-template-day3-wf_e00db5d5-b52.js:28`: `every feature you land ships its docs section in the SAME commit or the next one`.
Confidence: verified-source.

**F07. Structured-output schemas turned every agent's report into receipts: each verification is a command with its exit code, plus commits, transaction hashes and an explicit not-done list; reviews return severities with evidence and a verdict enum.**
Evidence: `hedera-template-day3-wf_e00db5d5-b52.js:34-66`: `verified: { type: 'array', items: { ... check, command, exit_code, result } }, tx_hashes, commits, docs_written, not_done, open_questions` and `REVIEW = { verdict: { enum: ['ready-to-push', 'ready-after-fixes', 'not-ready'] }, findings: [{ id, severity: { enum: ['blocking', 'major', 'minor'] }, file, problem, evidence, fix }], claims_unbacked, secret_findings }`. Holdover builders also had to list `numbers_used ... every figure written into code or docs, with its source file` (`holdover-engine-and-hygiene-wf_5e087bd4-4d3.js:128`).
Confidence: verified-source.

**F08. Several agents committing into one working tree at the same time worked, because each owned paths and committed with an explicit pathspec; the repo-wide pre-commit hook coupled them.**
Evidence: `hedera-template-base-and-skeleton-wf_c24b73a4-4a5.js:96`: `GIT DISCIPLINE (other agents commit in the SAME repository at the same time): never git add -A, git add ., git commit -a or git stash; never unstage, restore or reset paths you do not own ... commit with an explicit pathspec`; `hedera-template-day2-wf_fad060d4-d39.js:28`: `The repo's pre-commit hook type-checks the whole tree: if it fails on a file that is not yours, stop and report it rather than bypassing the hook (never --no-verify).` Outcome after an interruption, Hedera transcript 2026-09-22T09:27Z: `Aucun travail n'a été perdu et aucun commit ne mélange les agents.`
Confidence: verified-source.

### B. Verification and proof of done

**F09. Review was adversarial in both directions: the fixer had to reproduce each finding before changing anything, and it refuted reviewers with evidence several times.**
Evidence: `hedera-template-base-and-skeleton-wf_c24b73a4-4a5.js:155`: `first confirm it yourself (open the file, run the command) — a reviewer's finding is a hypothesis; if it is wrong, say why with evidence and do not "fix" it`. `Documents/Coding/Hedera/research/build/day3/fix.md:32`: `M7 — a simulator claim moved from the sender to the recipient. **Partly refuted, see section 2.**`; `TASKLIST.md:46`: `Reviewed adversarially: 12 findings, all applied; the fixer corrected the reviewer three times with evidence, including a figure wrong by a factor of ten.`
Confidence: verified-source.

**F10. Every day's review found defects that the green suite, typecheck and lint had passed; planted defects (mutants) were the tool that exposed them.**
Evidence: `Documents/Coding/Hedera/research/build/day3/review.md:29-31`: `planted: constructor accepts 194 -> yarn test:mock | 0 | 16 passing: not caught (finding M4)`; `planted: Send button loses blocked || freshness.stale -> test:unit, typecheck, lint:strict | 0/0/0 | not caught by anything (finding M3)`; `three false positives (finding M5)`. The day-3 blocking finding B1 (`review.md`, section 1): the new `not-estimable` kind `swallows every wallet-relayed HTTP 4xx on a send`; memory `project_hedera_scaffold_bounty.md:129`: `decoder gained not-estimable/supply-gas (review caught it twice too greedy — now gated on the gas-rule module)`. Day 2 review: `13 in-memory mutants ... killed 4 ... survived 8 non-equivalent` (`build/day2/review.md`, command table row 08).
Confidence: verified-source.

**F11. Proof checkers were themselves forgeable or lenient: an evidence checker accepted a false record, the completion check reports a skipped gate as ok, and receipts are recognised by file-name regex.**
Evidence: `Documents/Coding/Hedera/research/build/day4/fix.md:13,27`: `F1 | major | yes, reproduced the exact tamper` and `F1 — yarn evidence:check could not tell a true position record from a false one.` `Documents/Coding/BNB/holdover/scripts/completion-check.mjs:156`: `if (json) return { ok: true, detail: 'skipped in --json mode; run pnpm typecheck && pnpm test' };` and line 109: `const receipts = walk('data').filter((f) => /a5|live-?buy|ondo-?buy/i.test(f));`. I ran `node scripts/completion-check.mjs --json` in `Documents/Coding/BNB/holdover` (exit 1): `G4.build ... "ok": true, "detail": "skipped in --json mode ..."` and `G1.A5.run ... "ok": true, "detail": "data/receipts/.a5-build.json, data/receipts/.a5-calldata.json, data/receipts/a5-live-buy.json"`; open gates today: G2 (`1: docs/JUDGES.md:6`), G3.video, G7.public, G5.harden.
Confidence: verified-executed.

**F12. "It is refused" or "zero hits" counted only with a positive control in the same run: the house rule for scans and probes.**
Evidence: `Documents/Coding/Hedera/research/findings/expectation-ledger.md:14`: `Any claim of the form "X is refused" needs a positive control in the same run`; `build/day4/lp-cycles.md:14`: `Leak scan afterwards over the template repository and research/ (1,098 files): 0 hits, positive control found.`; `TASKLIST.md:98` names the failure: `the new failure modes (a blind 64-hex scan, a per-push gate that only tested one package manager)`.
Confidence: verified-source.

**F13. A "default to refuted" skeptic layer erased the plan-vs-tree signal: in the 30 Sept pre-harden completeness workflow, every one of the 9 plan-sweep findings was refuted, mostly because the plan file sits outside the repository under review.**
Evidence: script `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera-scaffold-hbar-saucerswap-v2/6052e9a6-d475-44b3-8b24-4e8c24b70da1/workflows/scripts/pre-harden-completeness-wf_e6c7920b-f6e.js:78`: `Ignore node_modules, .next, .git, and research/.` (the plan is `research/findings/TASKLIST.md`); line 99: `This is the single most important sweep: the rule being enforced is that completeness is proven against the plan, never against the test suite.`; line 160: `Refute this claim, do not confirm it. Default to refuted=true when you are not sure.` Journal `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera/6052e9a6-d475-44b3-8b24-4e8c24b70da1/subagents/workflows/wf_e6c7920b-f6e/journal.jsonl` (my tally): sweeps returned 41 findings (24 not self-labelled noise); 48 skeptic votes, 40 refuted; all 18 `refute:plan:*` votes refuted, e.g. `REFUTED on three independent grounds. (1) The file is not in the tree being hardened, and the task says to ignore it. TASKLIST.md lives at .../research/findings/TASKLIST.md — in the parent directory, outside the target repository.` Among the refuted: box 62's phone alert (planned, never written) and half of boxes 55/56. Some refutations were correct (box 44: `replay` does run in `lint.yaml`). The critic agent was still running at 20:48Z.
Confidence: verified-executed.

### C. The plan, completeness and deliverables

**F14. The completeness rule came from a real near-miss on 24 Sept (BNB): 920 green tests, yet two of six proof artifacts had never been written, one panel was absent, nothing was deployed, and ten deferral markers sat in judge-facing pages. It became a mechanical gate script kept out of CI, blocking every deliverable.**
Evidence: `Documents/Coding/BNB/research/TASKS.md:5-15`: `The four surfaces were built, 920 tests were green ... That felt like done. It was not: two of the six proof artifacts had never been written — not "not executed", no file existed — the A4 panel the spec describes was not in the web app, there was no deploy, and ten deferral markers sat in pages a judge reads.`; line 28: `Deliverables are BLOCKED while any of G1–G4 is open.`; `completion-check.mjs:15-17`: `DELIBERATELY NOT IN CI. This is red for most of a project's life, on purpose, and a job that is red by design teaches everyone to ignore red`. User origin, BNB transcript 2026-09-24T06:59Z: `Cree une tasklist pour eviter de refaire la meme erreur plus tard (c'est aussi une lecon a tirer pour le claude.md de la config general, oublier de build une partie du code du projet, et sauter aux livrables/demo/vidéo)`.
Confidence: verified-source.

**F15. The deferral markers that later blocked deliverables were created by the orchestrator's own brief.**
Evidence: `holdover-engine-and-hygiene-wf_5e087bd4-4d3.js:99`: `3. Docs skeletons, honest and short, with TODO markers where the build has not happened yet:`. The G2 gate still finds one today (`docs/JUDGES.md:6`, F11 run).
Confidence: verified-source.

**F16. The hand-maintained plan went stale within a day and nobody noticed: TASKLIST.md was last written 24 Sept 23:56 local while work continued on 25 and 30 Sept; on 30 Sept five boxes were done but unticked, one ticked box hid an open remainder, and three planned code items were half or never written.**
Evidence: `ls -la` of `Documents/Coding/Hedera/research/findings/TASKLIST.md`: `28907 Sep 24 23:56`. The completeness journal's plan sweep (F13): `STALE BOX 45 ... Done`, `STALE BOX 53 ... Already done, in commit 44b438a`, `STALE BOXES 33 and 35, the second wallet ... Both ran`, `STALE BOX 71 ... Done on both halves`; open remainder inside ticked box 44 (`TASKLIST.md:44`: `Open (one commit, needs the orchestrator because it is a workflow): replay is in no workflow's --root-scripts`); `Box 62 ... one alert to A's phone ... Planned and never written.`; box 55 `Half written`; box 56 `Two of four are done`.
Confidence: verified-executed.

**F17. Dated plan items slipped silently: the plan scheduled agent work while the user was away (26-29 Sept), but no workflow ran between 25 Sept 21:09Z and 30 Sept 09:34Z, and nothing flagged the missed dates.**
Evidence: `TASKLIST.md:37`: `Code-quality pass 1, Sat 26 / Sun 27`; line 64: `Judge audit + census re-run on Mon 29 Sept, while A is in Rome: neither needs him`. Run table: last run before the gap `harden-round4 | killed` 09-25 21:09Z, next 09-30 09:34Z. Hedera user messages: 2026-09-25T16:26Z `demain matin je pars 4j en italie`, next 2026-09-30T09:25Z. The home session hit the weekly limit on 26 Sept (F21).
Confidence: verified-executed.

**F18. A gate list derived from the artifact list missed the one irrecoverable external clock (the ERC-8183 dispute window); it was added only on 25 Sept.**
Evidence: `completion-check.mjs:173-177`: `Added 2026-09-25, and the omission is the point. ... a job submitted after 30 Sep 20:00 UTC settles after the 11 Oct deadline and the $2,000 special is gone with no way to recover it. Nothing mechanical was watching that date. The gate list was written from the artifact list and inherited its blind spot`.
Confidence: verified-source.

**F19. Deliverables were started before the build was complete at three events.**
Evidence: BNB (F14). Hedera `TASKLIST.md:79`: `Video script written 24 Sept ... Two of its four preconditions were not met and A asked for it anyway: the second wallet has not run, and the code is not frozen.` XRPL user 2026-09-12T10:13Z: `the fact you wrote the feedback right now and we didnt even start to code is not good`; `Documents/Coding/XRPL_Hackathon_2026/docs/47-MATIN.md:28`: `Le deck revendiquait cinq pull requests qui n'existent pas.` The ordering rule that followed (harden before the video): `TASKS.md:45-49`.
Confidence: verified-source.

**F20. Event plans were first built on guessed deadlines, and lane plans written independently double-booked the one human; a single merged timeline then owned the clock.**
Evidence: `Documents/Coding/XRPL_Hackathon_2026/docs/02-TIMELINE.md:3-5`: `The previous version was built on a guessed Sunday 14:00 deadline and a Sunday 17:00 code freeze. Both were wrong, and the 17:00 freeze fell *after the awards ceremony*.`; `docs/11-TASKS-BACKEND.md:6-11`: `this list, the frontend list and the feedback list were written independently and together assigned Alex 29.5 waking hours plus a feedback block that landed on top of the critical path. docs/02-TIMELINE.md is the single merged schedule (23.5 h assigned, 7 h sleep, no double-booking).` Same file: `If an estimate is being exceeded by 50 %, stop and look at the drop list`; the integration gate `INTEGRATION GATE: Saturday 21:00 ... the point at which the plan changes shape.`
Confidence: verified-source.

### D. Usage limits, interruptions and resumption

**F21. Five different usage-limit behaviours were observed, and two of them cost a whole night.**
Evidence:
- Model-specific limit, no auto-resume: Hedera transcript 2026-09-21T22:27:43Z `You've reached your Fable limit. Run /usage-credits to continue or switch models with /model.`; nothing until 2026-09-22T09:25Z (`/model` -> `Set model to Opus 5 (1M context)`; user: `fable limit atteinte. Continue en opus.`). About 11 h of overnight time lost; memory `project_hedera_scaffold_bounty.md:104`: `switched from Fable to Opus 5 (Fable usage limit hit mid-workflow)`.
- Weekly limit with a near reset, announced auto-continue that did nothing: 2026-09-23T00:29:48Z `You've hit your weekly limit · resets 4am (Europe/Paris)` and system `Usage limit reached · continuing automatically at 4am`; 05:42Z user `Continue from where you left off.` -> `No response requested.`; work resumed only after 06:34Z `resume` (about 4.5 h after the reset).
- Session limit inside a workflow, handled by the runtime: hedera-template-day6 log `Usage limit reached — resets at 10:40pm (Europe/Paris). Workflow paused; waiting agents re-run shortly after the reset.` then `Usage limit reset. Re-running 1 waiting agent.` (label `build:thirty-seconds (after usage limit)`).
- Weekly limit with a far reset, agents dropped but the run says completed: harden-eval (09-24 05:30Z) `status: completed`, 19 of 19 agents `error`, log `[run:ts-without-1] failed: usage limit; resets Sep 30, 4am (Europe/Paris), too far out to wait for`, result table all `None`. Older runtime, XRPL recon 09-11: `[verify:xrpl-py] failed: You've hit your session limit · resets 7:50pm`.
- The watchdog cron also hits it: home session 2026-09-26T01:48:26Z `[night-2 watchdog — automated ...]` -> `You've hit your weekly limit · resets Sep 30, 4am (Europe/Paris)`.
Confidence: verified-source.

**F22. The weekly quota was exhausted twice in the week before the event, and its reset falls inside the Origins hack window if the observed cadence holds.**
Evidence: resets observed Wed 23 Sept 04:00 and Wed 30 Sept 04:00 Paris (F21). BNB user 2026-09-22T22:43Z: `Soit autonome cette nuit. La limite hedbomadaire se reinitialise a 4h du matin. Jusque la, utilise un max les tokens en autonomie pour build le code`. Workflow `totalTokens` launched between resets and limit hits (my sums over run records): 16 Sept 02:00Z -> 23 Sept 02:00Z: 27 runs, 65.1M; 23 Sept 02:00Z -> 24 Sept 05:52Z (first weekly-limit message): 18 runs, 78.4M; 24 Sept 05:52Z -> 26 Sept 01:48Z (second): 12 runs, 40.6M. These sums exclude main sessions and headless `claude -p` pilots, and the mapping from `totalTokens` to quota is unknown. On 24 Sept a `resume` at 06:46Z relaunched successfully 54 min after the weekly-limit message; the transcript does not say what lifted it. Hedera user 2026-09-30T18:20Z: `fais gaffe aux tokens je dois en garder pour singapour`. Arithmetic (inferred): next reset Wed 7 Oct 04:00 CEST = 02:00Z = 10:00 SGT; Origins window Tue 6 Oct 12:00 SGT (04:00Z) -> Wed 7 Oct 23:59 SGT; the first 22 h of the window belong to the week that started today.
Confidence: verified-source (observations), inferred (the 7 Oct reset).

**F23. The Workflow runtime's recovery features were used for real: `resumeFromRunId` with cached agents, a stall detector that retries silent agents, and reruns after a session-limit reset.**
Evidence: Hedera transcript tool call 2026-09-21T14:58Z `{"scriptPath": ".../hedera-bounty-phase-a-wave2a-wf_e0b4c30a-508.js", "resumeFromRunId": "wf_e0b4c30a-508"}`; run record wf_c24b73a4-4a5: agents `build:base` and `build:ci` `"cached": true`; `~/.claude/.../scratchpad/night2-plan.md:15`: `round 4 implement + safety failed on the weekly usage limit ... Designs and reviews (6 agents) cached.`; npm-typecheck-fix log `[stall] agent "fix:npm-typecheck" stalled (no progress) after 2761s — retrying (1/5)` then `after 3694s — retrying (2/5)`; bnb-phase-a-wave2 log: 7 stall retries across 4 probes; research-qa: 10 agents stalled at about 2095 s together.
Confidence: verified-source.

**F24. Before resuming, the orchestrator rewrote the task prompts with a resume note that inventoried what the interrupted attempt had committed and left uncommitted; interruptions also left residue (a stale git lock, a held port, uncommitted partial work).**
Evidence: `hedera-template-base-and-skeleton-wf_c24b73a4-4a5.js:95`: `RESUME NOTE (22 Sept, read first): a previous attempt of THIS task was cut off by a usage limit around 00:26 local ... It had already COMMITTED eea4118 ... It left UNCOMMITTED, never verified: modifications to 17 files ... Start with git status and git diff: review that partial work as critically as someone else's (it was never run), keep what is right, fix or discard what is not`. Residue: `build/day1/fix.md:15`: `.git/index.lock (0 bytes, 13:19, before this session) blocked the first commit`; `build/day2/npmfix.md:9`: `3203 was still held after the npm leg's boot step and I stopped that process by hand`; `npmfix.md:15`: `This work started from a tree that a previous, interrupted pass of the same task had left uncommitted`.
Confidence: verified-source.

**F25. The strongest prior art for autonomous overnight execution is the /harden night plan: a markdown plan with ticked steps, hard limits and per-step resume instructions, driven by a recurring CronCreate watchdog that deletes itself at the end.**
Evidence: home transcript `~/.claude/projects/C--Users-Utilisateur-Documents/07b2a7e3-7e11-4172-88b7-b914883d3729.jsonl` 2026-09-24T22:52Z `CronCreate {"cron": "17,47 * * * *", "prompt": "[overnight watchdog — automated, not a user message] Read .../scratchpad/overnight-plan.md and check each unticked step's real state (workflow journals/outputs, running processes, files). If a step is still running, do nothing. If it failed because of a usage limit or a network error, resume it as the plan says. If it finished, do the next step. Respect the plan's hard limits ... When every step is ticked, do step 6 and delete this cron job with CronDelete.", "recurring": true}`. Plan `.../scratchpad/overnight-plan.md:1`: `authorised by the user on 2026-09-25: "gère tout cela en total autonomie cette nuit ... si la limite est atteinte, continue dès qu'elle restart"`; line 17: `If failed on usage/network: resume with Workflow resumeFromRunId.`; watchdog log lines 25-28. Night 1 outcome, `overnight-summary.md:3`: `All six plan steps done.` Night 2 died on the weekly limit (F21).
Confidence: verified-source.

**F26. Context compaction happened during every event build, once 3.5 h before a code freeze; the orchestrator's working state must survive it.**
Evidence: my count of `This session is being continued from a previous conversation` in the main transcripts: XRPL 2026-09-12T15:41Z and 2026-09-13T09:09Z (freeze was 12:30 Paris = 10:30Z); Monad 2026-09-19T12:27Z (event day); Hedera 2026-09-23T22:20Z; BNB 2026-09-23T16:30Z and 2026-09-30T10:07Z; home session 2026-09-25T05:53Z; the /harden run on Hedera tonight twice (18:45Z, 19:06Z, `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera-scaffold-hbar-saucerswap-v2/86909e65-78fd-418a-8f7d-3b12b0fdc4ce.jsonl`).
Confidence: verified-executed.

**F27. The orchestrator sometimes ended a turn announcing work it had not started.**
Evidence: Hedera user 2026-09-25T12:28Z: `plusieurs fois que tu dis "je le fais maintenant" mais rien ne se passe. C'est fait expres?`; assistant 12:28Z: `j'ai écrit l'annonce en dernière ligne au lieu de faire le travail puis de le rapporter. Deux choses sont restées en suspens de cette façon`.
Confidence: verified-source.

**F28. On heavy nights several workflows from different projects ran at once on the one machine, by design, to burn quota before a reset.**
Evidence: run records, 2026-09-22 22:45Z-23:40Z: hedera-template-day3 (21:09-00:19Z), op3n-wave0-scout (22:01Z, 18 agents, 5.8M tokens), holdover-sources (22:41Z, 10 agents), holdover-engine-and-hygiene (22:45Z, 6 agents), op3n-eli-ideas-eval (23:22Z, 17 agents). The user asked for it (F22 quote). Pilot 2 of /harden: `overnight-plan.md:34`: `pilot 2 wrapper shell reaped by Claude Code (low memory; ~16 claude.exe open)`.
Confidence: verified-executed.

### E. The machine

**F29. The C: drive filled up four times during builds, each time from parallel installs, Docker disk images or per-run copies; tonight it has 2.4 GB free.**
Evidence: `Documents/Coding/Hedera/.scratch/w2b-gate-linux/logs/30-host-disk-full-and-daemon-hung.log`: `### 2026-09-21T15:35:04Z ... C: 464414 464143 272 100% /c` and `docker ps exit=124`; memory `project_hedera_scaffold_bounty.md:59-60`: `Disk C: filled up during wave 2b (parallel installs + Docker vhdx 12 GB ...): run ONE install at a time, clean each scaffold after logging`. `build/day2/spike.md:294`: `Disk: C: went from 32 GB free (13:4xZ) to 17 GB free (14:2xZ), mostly not this agent.`; `build/day2/npmfix.md:11`: `disk was down to 11 GB, not the 40 GB the task assumed`. `~/.claude/projects/C--Users-Utilisateur/memory/project_ledger_op3n.md:254-255`: `Disk incident 24 Sept: C: fell to 0.78 GB (user's WSL Ubuntu XRPL node ~17.7 GB + Docker vhdx bloated to 11.7 GB by my per-run repo copies)`. `.../scratchpad/overnight-summary.md:12`: `disk C: full (278 MB) -> deleted 50 node_modules/target dirs of my own eval runs`. Tonight, `df -h /c`: `C: 454G 452G 2.4G 100% /c`; `nproc`: `16`.
Confidence: verified-executed.

**F30. Memory pressure killed processes: the demo backend, and background shells when many Claude processes were open.**
Evidence: `Documents/Coding/XRPL_Hackathon_2026/docs/47-MATIN.md:90`: `Le backend s'est fait tuer deux fois cette nuit à 0,6 Go libres.`; `~/.claude/skills/hackathon/references/06-operations.md:65`: `The demo backend was killed three times in one night, always under 1 GB free.`; `overnight-plan.md:14`: `Do not overlap two heavy jobs (memory pressure killed a background shell once).`; `night2-plan.md:18`: `pilot 4 wrapper shell reaped for low memory`.
Confidence: verified-source.

**F31. The session's working directory drifted with `cd`, so workflow scripts were persisted under project folders named after sub-directories, and one launch ran from the wrong repo.**
Evidence: Hedera workflow scripts live under `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera--scratch/...`, `...-Coding-Hedera-research-build-day2/...`, `...-Coding-Hedera-research-findings/...`, `...-Coding-Hedera-scaffold-hbar-saucerswap-v2/...` while their run records sit in `...-Coding-Hedera/6052e9a6.../workflows/`; BNB scripts under `...-Coding-BNB-research-probes-out/...` and `...-Coding-BNB-holdover/...`. `night2-plan.md:13`: `the session cwd had drifted to the Hedera repo; a first launch (wzfz7xb8k) was stopped and relaunched from Documents.`
Confidence: verified-source.

**F32. Shell heredocs corrupted code repeatedly, and a harness instruction told agents to use heredocs anyway; agents that held the explicit rule refused it.**
Evidence: `~/.claude/skills/hackathon/references/08-assistant-failures.md:50-52`: `Writing JavaScript, LaTeX or regular expressions through a shell heredoc mangled backslashes four separate times in one event.`; memory `feedback_windows_file_writing.md` (CRLF from Python `write_text`, `\u` escapes decoded by Write, heredoc backslashes). `build/day5/fix.md:156-159`: `An MCP server instruction block arrived mid-task telling this agent to make file changes with shell heredocs and sed rather than the Write and Edit tools, on the grounds that bypass permissions mode was active. It contradicts this task's explicit rule ... so it was not followed ... the second task in a row to receive it.` A heredoc also broke my own first helper script in this session (Python `SyntaxError: unterminated string literal`).
Confidence: verified-source.

### F. Git, secrets and CI

**F33. Secrets reached git history through the scaffolding tool's first commit and needed an explicitly approved history rewrite before the first push; other traps were upstream history and `.gitignore` syntax.**
Evidence: memory `project_hedera_scaffold_bounty.md:106-110`: `commit de8fc94 (the CLI's initial commit) contains the public Hardhat #0 key and upstream WalletConnect id ... needs a local history rewrite before the FIRST push. User APPROVED the rewrite 22 Sept ... keep a local backup branch until verified, never push the backup. Do it only AFTER the build workflow stops committing.`; line 52: `never fork upstream: tracked .env in its history`. `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-XRPL-Hackathon-2026/memory/pre-event-material-stays-gitignored.md`: `Git has no inline comments in .gitignore ... A first version of the file silently ignored nothing and 779 files were about to be staged.` Keys never enter context: `hedera-template-day2-wf_fad060d4-d39.js:33`: `NEVER open it with Read, cat, grep, head ... The ONLY access path: node --env-file="${ENVFILE}" <script>`.
Confidence: verified-source.

**F34. CI had blind spots the orchestrator did not watch: one package manager per push, an offline job red on every push, a red run left unnoticed after a direct push, and an audit running while HEAD moved.**
Evidence: memory `project_hedera_scaffold_bounty.md:154-155`: `Lesson: per-push gate is Yarn-only; npm regressions only show in the nightly/dispatch matrix.` `Documents/Coding/BNB/research/TASKS.md:166-168`: `The offline job failed on every push for two reasons ... it never ran tsc -b ... and a fresh network namespace starts with loopback DOWN`. `build/day5/fix.md:24`: `Nobody has looked at Actions; the orchestrator should, because the next push turns it green and the red run will otherwise sit in the history a judge can read.` `build/day5/judge-audit.md:11`: `Read this first — HEAD moved while the audit ran.` (the audit ran in parallel with a committing agent: `hedera-template-lock-and-audit-wf_52afe057-be4.js:36-37`, `parallel([ build:doc-locks, audit:judge, research:census ])`). Private-repo CI minutes were a budget: `hedera-template-npm-typecheck-fix-wf_ae3b61a1-f80.js:58`: `private Actions minutes (about 2,000 a month; each npm leg is roughly 8-10 minutes)`.
Confidence: verified-source.

**F35. The no-AI-attribution guard is machine-local; at the two-developer XRPL event dev B's machine had no protection, and piping `git commit` through another command once hid the hook's failure.**
Evidence: `Documents/Coding/XRPL_Hackathon_2026/docs/48-PROMPT-DEVB-FEEDBACK.md:50-51`: `The repository's commit-msg hook lives on Alex's machine only, so nothing on yours will catch it. Check the message before you commit.`; `~/.claude/hooks/guard.py:2-4`: `Global PreToolUse guard for Claude Code (all sessions, all projects, subagents included). 1. No AI attribution in commits`; XRPL memory `no-ai-attribution-in-commits.md`: `Never pipe git commit through head or any other command when testing hooks — it closes the hook's stdout and masks the failure, which already let one junk commit through.`
Confidence: verified-source.

**F36. Signed transactions by agents ran under per-task rules: a per-task spending ceiling, chain and address assertions before signing, sequential sends, outcome read from the chain, ephemeral keys only in scratch; on mainnet every transaction was proposed with its cost first.**
Evidence: `hedera-template-day4-lp-wf_04085e40-72b.js:32-33`: `HBAR ceiling for this task: ${ceiling} HBAR — stop and report if you would exceed it. Sends strictly sequential, one nonce stream. Every outcome read from the mirror DETAIL view ... never from "the send did not throw".` and `Every signing run first asserts eth_chainId == 0x128 and that the derived address equals process.env.evm_address`. `Documents/Coding/BNB/research/TASKS.md:128-129`: `Spending rule I follow: every signed mainnet transaction is proposed to you first with its exact cost; hard cap $30 per transaction and $100 total unless you widen it.` Memory `project_hedera_scaffold_bounty.md:61-62`: `58 signed testnet txs ... every hash re-opened by a verifier (58/58), key-leak scan 0 hits.`
Confidence: verified-source.

### G. Humans, coordination and reporting

**F37. Manual tasks were frequent and clustered: wallet sessions with screenshots, copying Discord, organiser messages and calls, interactive logins, funding wallets, hardware, UI walk-throughs with screenshots, deploy dashboards, model switches, `/harden`, and "resume".**
Evidence (user messages, UTC): Hedera `6052e9a6...jsonl` 2026-09-21T15:03Z `docker est up. tu as l'accord pour utiliser les cles dans le .env ... j'ai rejoins le discord`; 21:16Z `J'ai du mal a purger docker desktop`; 2026-09-22T20:29-20:55Z MetaMask spike run by the user, step by step with screenshots and pasted tx hashes; 2026-09-23T15:59-16:15Z `Je me charge des screens metamask` ... `j'ai fait les captures`; 2026-09-25T09:41-10:10Z whole Discord channels copied; 2026-09-30T09:25Z AMA replay link; 12:47-13:33Z HashPack session with an error screenshot; 18:20Z `c'est bon j'ai move` (parking `.env.local` before `/harden`). BNB `f3a0fee8...jsonl` 2026-09-22T09:41Z API key into `.env`; 2026-09-23T06:50Z `mon pc a redemarré à cause d'une mise à jour` (watcher died); 07:14Z Agentic Wallet sign-in via phone QR; 14:28Z `bag platform login` device code; 2026-09-24T06:47Z `fly auth login requires an interactive terminal`; 06:49-11:18Z wallet funding moves. XRPL 2026-09-12T10:38Z `what do i do after running /hooks ?`; 21:38Z `Envoie moi une instruction, je l'execute sur le frontend, fait un screenshot et te l'envoie ... une tache a la fois`; 2026-09-13T10:28Z `render login` (not installed). Monad 2026-09-19T09:53Z `je pars chercher le cable. je te monitore via remote control`; 12:09Z `deploy failed`; 12:18Z Vercel install failure. `/harden` must be typed by the user: `TASKS.md:63-64`.
Confidence: verified-source.

**F38. The two-developer recipe that worked at XRPL: a frozen API contract and a real fixture server for dev B, a dev-B task list with critical path, dependencies, definition of done and hard checkpoints, and a self-contained prompt for dev B's own Claude Code with path ownership and a clock.**
Evidence: `xls6566-deliverables-wf_7fe8db28-535.js:13`: `In a previous collaboration in November 2025, 100% of Dev B's pages were discarded and rewritten by Alex, because Dev B built pages at routes he chose against data shapes he imagined. The structural fix is already in place: a REAL fixture server, not mocks.` `Documents/Coding/XRPL_Hackathon_2026/docs/21-TASKS-FRONTEND.md:20-24`: `[CP] = critical path ... dep: = cannot start until that task is done. DoD = definition of done. It is a thing you can look at and check, not a feeling ... Checkpoints are hard: stop, put it on screen, message Alex, wait for a reply before continuing.`; lines 8-10: `The three things that need Alex have been moved so they no longer collide with his schedule`. `48-PROMPT-DEVB-FEEDBACK.md:44`: `Work in one session. Do not launch multi-agent workflows; there is no time to merge their output.` and rule 2: `Touch only these paths ... Alex has uncommitted work in several of those right now, and a conflict at 12:25 is the one thing we cannot afford.` Monad: 2026-09-19T05:41Z `send a paragraph for him for his claude code`.
Confidence: verified-source.

**F39. The user repeatedly polled for status and for a completeness verdict; the best-received reports were short handover notes written for the reader.**
Evidence: Hedera user 2026-09-23T17:52Z `ALORS, la CI et les concureents?`; 22:07Z `alors la CI?`; 2026-09-24T10:57Z `alors?`; 12:00Z `dis moi quand les jambes npm sont vertes`; 06:52Z `du coup, on a terminé l'entiereté du code et des fonctionnalités ?`; BNB 2026-09-30T09:58Z `Il reste quoi à faire, j'ai un peu oublié ou on en est depuis 4j`. Handover notes: `Documents/Coding/XRPL_Hackathon_2026/docs/47-MATIN.md` (French, sections `Livré`, `Ce que les agents de vérification ont attrapé`, `Pour tout démarrer`, `Ce qu'il te reste, dans l'ordre`); `.../scratchpad/overnight-summary.md`.
Confidence: verified-source.

**F40. Mid-build input from judges, mentors and organisers changed scope several times, and the user rated it above build time.**
Evidence: XRPL user 2026-09-12T11:17Z, 12:51Z (`just interacted with shotta for a good 30min`), 13:30Z (`Maxime est venu me voir ... m'a orienter sur une piste`); memory `project_xrpl_vault_oracle.md`: `Talking to the judges was worth more than any hour of building`. Hedera: the AMA of 29 Sept added the second-wallet work on 30 Sept (user 09:52Z `faire le deuxième wallet en priorité`).
Confidence: verified-source.

**F41. Model and effort were rarely varied in builds; the one experiment with pinned cheaper subagent models lost recall and misreported models; USD costs exist only for /harden pilots.**
Evidence: build run records: every agent `model: claude-opus-5[1m]` (Hedera, Holdover). XRPL verifiers used `effort: 'high'` (`demo-path-audit-wf_428fe32b-68c.js:160`), the completeness critic `effort: 'xhigh'` (`pre-harden-completeness-wf_e6c7920b-f6e.js:200`). `overnight-plan.md:40-41`: `pilot 2 ended: success, 97 min ..., USD 101.69 ... Opus orchestrator 66.01, Haiku 24.94, Sonnet 10.74 USD` and `ROOT CAUSES: lens passes launched as codebase-explorer (user agent pinned model: haiku) and verifiers as debugger (model: sonnet) -> recall loss ...; the run misreported models.`; line 28: pilot 1 `90 min, USD 34.84`.
Confidence: verified-source.

---

## A build wave, as the user actually ran it

This is reconstructed from the Hedera day-waves (F01, F05-F09), the Holdover variant (F02) and the XRPL night (F03).
Times and sizes are the measured medians (F04).

```
BEFORE THE WAVE (orchestrator, main session, 5-60 min)
  - read the plan (TASKLIST/TASKS) and the last wave's notes; pick the boxes this wave closes
  - check free disk and running processes; assign ports and paths per agent
  - write the workflow script: CTX block + one task block per agent + schemas (F06, F07)
  - if resuming: inject a RESUME NOTE per interrupted agent (F24); launch with resumeFromRunId

THE WORKFLOW (Hedera day-wave: 190-240 min, 4-8 agents, 2.3-3.1M tokens)
  phase 1  foundation      1 agent, the ONLY installer (scaffold, shared library, contracts)      40-80 min
  phase 2  builders        2-3 agents in parallel, each OWNS disjoint paths, commits with        45-60 min
                           pathspecs, writes research/build/dayN/<slug>.md, returns receipts
           (signed agent)  runs testnet transactions under KEYRULES and a per-task ceiling
  phase 3  integrator      optional: root scripts, docs, full local verification               ~65 min
  phase 4  reviewer        READ-ONLY; scope = commits since <sha> + notes; hunt list in          25-40 min
                           priority order; plants defects; re-opens every tx hash; verdict
  phase 5  fixer           only if something is above minor; confirms each finding first        30-70 min
                           ("a reviewer's finding is a hypothesis"); new commits only;
                           re-runs the whole local verification

AFTER THE WAVE (orchestrator, 15-60 min)
  - re-verify load-bearing claims itself (hashes on the mirror, Sourcify, the gate)
  - grep new commit messages for AI trailers; secret scan with a positive control
  - git push; gh workflow run <full matrix>; poll gh run list until complete; read --log-failed
  - tick the plan boxes whose proof now exists; update memory; report to the user
  - decide: next wave, fix wave (e.g. npm-typecheck-fix: fix agent + independent verifier), or wait for the human
```

Variants that were used:
- **Holdover lanes** (F02): `pipeline(lanes, build, review-and-fix)`; builders 20-50 min, reviewers 20-45 min; agents never commit; the orchestrator commits and pushes.
- **Fix wave** (Hedera npm type failure): one fixer (reproduce the real way, root-cause, fix, prove in both modes) plus one independent verifier that re-scaffolds and plants the original bug shape (`hedera-template-npm-typecheck-fix-wf_ae3b61a1-f80.js:53-67`).
- **Refutation wave** (demo audit, completeness sweep): N finders, then two skeptics per finding that default to "refuted", then one critic asked "what did nobody look for" (`demo-path-audit-wf_428fe32b-68c.js:147`, `pre-harden-completeness-wf_e6c7920b-f6e.js:160,188-199`). Good for defect claims, harmful for completeness claims (F13).
- **Event night** (XRPL): writer->verifier pairs per document page (30 min for 10 pages, 63 errors caught), then a morning handover note in the user's language.

Brief fragments that worked, verbatim:
- Ownership: `you own ONLY <paths>. Do not edit any other path (list the root scripts you need in your output instead)`.
- Git: `never git add -A, git add ., git commit -a or git stash; never unstage, restore or reset paths you do not own ... commit with an explicit pathspec`; `ABSOLUTELY NO "Co-Authored-By", "Signed-off-by" or any AI attribution`; `never --no-verify, never amend, never push`.
- Machine: `ONE dependency install at a time`; `delete throwaway scaffolds' node_modules/.next after logging`; `never start Docker`; `servers bind the port named in your task and are killed afterwards (confirm the port is free)`; `Write files with the Write/Edit tools, never a shell heredoc`; `Never chain a success message onto a command that can fail; report exit codes and real output`.
- Proof: `tests that can fail (every refusal path has a negative test naming the exact error)`; `Proof: three planted violations, lint exit 1 on each, and the clean file exit 0`; `Every outcome read from the mirror DETAIL view, never from "the send did not throw"`.
- Review: `READ-ONLY on <repo> (run scripts and tests, no installs, port <n> if you must boot, kill it after)`; `Severity: blocking / major / minor, each with evidence and a concrete fix.`
- Fix: `Confirm each blocking and major finding yourself before changing anything; if a finding is wrong, say why with evidence and leave it.`

---

## Lessons that must become rules or defaults in /execution

Each rule names the finding it comes from.

1. **One merged schedule owns the clock**, over every human and every lane; deadlines are taken from the organisers' text, never guessed (F20).
2. **Plan state is machine-written.** A box is ticked only by the step that produced its proof, re-checked by an agent that did not write it, and the plan's last-updated time is itself checked; a plan older than the last commit is a defect (F16).
3. **Dated items have alarms.** Every task carries a latest date; when it passes unticked, /execution reports it and asks, instead of letting it slip (F17). The plan must know when the human is unavailable and whether quota exists for the unattended hours.
4. **External clocks are first-class gates** (dispute windows, sessions that expire, repo-public flips, submission forms), derived from the event and the rules, not only from the artifact list (F18).
5. **Proofs re-read the world, never the record**: a transaction hash is re-fetched on chain and its fields compared; a receipt is parsed and validated, never matched by file name; a skipped check is OPEN, never ok (F11). Every proof checker gets a planted forgery that must fail it.
6. **Every negative result carries a positive control** in the same run (F12).
7. **Completeness has the burden on "done"**: the plan is an input to every checker and refuter; "the plan item is outside the repo" is never a reason to drop it; default-refuted skeptics are for defect claims only (F13).
8. **Deliverables are blocked by the completion gate** (video script, video, submission text, README headline claims, public flip); the order is build complete -> /harden -> fixes -> recording -> ship (F14, F19). Placeholder text ("TODO") is never written into judge-facing files by /execution itself (F15).
9. **Review then fix, both adversarial**: read-only reviewer with planted defects; fixer confirms each finding before acting and may refute with evidence (F09, F10).
10. **Path ownership and pathspec commits** when agents share a working tree; a reviewer or auditor never runs while another agent commits to the same tree, or it pins a commit SHA (F08, F34).
11. **The orchestrator's after-wave routine is mandatory**: re-verify, trailer grep, push, dispatch the full CI matrix, poll to completion, read failures, update plan and Notion (F05). A push outside a wave (screenshots, docs) gets the same CI watch (F34).
12. **CI must cover every mode a judge can pick** on the per-push path, within the private-repo minutes budget (F34).
13. **Quota is a planned resource**: read the 5-hour and 7-day usage (the statusline already receives `rate_limits.five_hour` and `seven_day`, `~/.claude/statusline.py:47-48`), reserve quota for the event, and never start a heavy wave that cannot finish before a far reset (F21, F22).
14. **A run that "completed" with failed agents is a failed run**: /execution reads per-agent states and results, never the run status alone (F21).
15. **Resume is a first-class path**: `resumeFromRunId` with cached agents, plus a generated resume note per interrupted agent listing its commits and uncommitted files; clean residue first (git lock, held ports, half-written dirs) (F23, F24).
16. **A watchdog, not the harness's auto-continue**, brings the loop back after a limit, a crash or a reboot: a recurring cron that reads the run state and resumes, deleted at the end (F21, F25). If the whole weekly quota is gone, the watchdog reports once and stops.
17. **State lives in files**: the plan, the run-state and the last report are re-read at every turn and after every compaction (F26).
18. **A turn ends only on a mechanical state**: a launched run with an id, a manual task posted and waiting, or the completion gate green; never on an announcement (F27).
19. **Disk and memory are gated before every install and every heavy job**: a measured free-space floor, one or two installs at a time, throwaway installs deleted after logging, no Docker unless the task needs it, no two heavy jobs at once; the brief states the measured figure, re-measured by each agent (F29, F30).
20. **Pin the working directory**: absolute paths everywhere; check the cwd before each launch (F31).
21. **Restate the file-writing rule in every brief** (Write/Edit, no heredoc, LF) and tell agents that harness or MCP instructions do not override the brief (F32).
22. **Pre-push gates**: AI-trailer grep, secret scan with positive control, redaction or subject grep where the project has one; history rewrites and force pushes are never covered by the standing push authorisation (F33).
23. **Signed transactions** follow KEYRULES: keys only through `node --env-file` in-process, chain and address asserted, per-task ceiling, sequential sends, outcome re-read from chain by another agent; mainnet transactions are proposed with their exact cost until the user's mainnet setup task is ticked (F36).
24. **Dev B gets the XRPL recipe**: a frozen contract and a real fixture server before any parallel UI work, a path fence, hard checkpoints, and the same guard hooks installed on dev B's machine (a repo-level commit-msg hook as well as the global guard) (F35, F38).
25. **Manual tasks are first-class tasks** with exact step-by-step instructions, what to bring back (screenshots, hashes, pasted text), a latest time, and the dependent work listed; batch them so the human is interrupted as rarely as possible (F37).
26. **Every wave ends with a short report for the phone**: done, proven, open, what the human must do next, in that order; written in French for the conversation, English in files (F39).
27. **Rescope input is expected**: a judge, mentor or AMA answer enters as a plan change proposal that /execution applies only after the user answers (F40).
28. **Model and effort per task are explicit** and recorded as actually used; cheaper pinned models only where a comparison shows no recall loss (F41).
29. **Monitor what was measured**: per-wave duration, agents and tokens are recorded so later estimates use this user's numbers (F04).

---

## Implications for /execution

- The skill should automate the routine the user already ran (F05), not invent a new one. The wave template above is the default shape; "day-wave" sizes (3-4 h, 4-8 agents, 2-3M tokens) are the only local calibration data for time and token estimates.
- The completion gate should be a generated per-project script in the style of `completion-check.mjs` (gates that name what would be untrue if dropped), with three fixes: skipped means open, receipts parsed not globbed, and time gates for irrecoverable clocks.
- The final "build complete" proof should combine that script with a completeness sweep whose refuters are given the plan as the contract (F13); the 30 Sept pre-harden workflow is the nearest existing implementation and shows the failure to avoid.
- The unattended loop should reuse the /harden night pattern (plan file + cron watchdog + resumeFromRunId), with Notion as the report target, and must budget quota before it promises unattended hours.
- For Origins (in person, 36 h, recorded video): the plan needs the weekly reset at (inferred) 10:00 SGT on day 2, the session-limit rhythm, a compaction-proof state file, a disk floor (2.4 GB free tonight), the T-6h demo audit and the recon passes scheduled as tasks, and a cut list with a fixed decision hour, as the XRPL and TOKEN2049 plans had (`02-TIMELINE.md:110-119`; `Documents Perso/token2049/research/findings/wave3/_recommendation.md:195-240`).

---

## Risks and failure modes

- **Quota exhaustion before or during the event.** The pre-flight week already burned the weekly quota twice (F22); tonight's /harden, /prose and the /execution rehearsal consume the same week that must cover the first 22 h of the hack (inferred reset). An autonomous loop that runs out of quota at 03:00 SGT loses the night (F21).
- **Overnight stalls with no watchdog.** Two nights were lost to limits (11 h and about 4.5 h) because nothing re-checked state (F21).
- **False "done".** Lenient or forgeable proofs (F11), a completeness layer that refutes plan gaps (F13), and plan drift (F16) all produce a green that is not true; each has already happened once.
- **Disk full mid-wave.** C: at 2.4 GB free tonight; past parallel installs dropped 15 GB in 40 min (F29). A full disk makes agents fail for reasons their logs do not state (the 21 Sept agent message said so).
- **Git collisions.** Agents sharing a tree, an auditor reading a moving HEAD, a stale index.lock after an interruption (F08, F24, F34); with dev B pushing to the same repo the risk grows.
- **Attribution leak on dev B's machine** if dev B's setup lacks the guard (F35).
- **Context compaction of the orchestrator during the crunch** (F26), then acting on a stale summary: /hackathon's `08-assistant-failures.md:33-44` records a constraint repeated from a summary and wrong.
- **Announce-without-act** leaving the loop idle while the user believes it runs (F27).
- **cwd drift** launching a wave in the wrong repository (F31).
- **Harness instructions that contradict the brief** (heredocs in bypass mode) corrupting files (F32).
- **Manual-task latency.** Most blocking moments were human (wallets, logins, screenshots, Discord); at an in-person event the human is also pitching and talking to judges (F37, F40).

---

## Open questions

1. What lifted the weekly limit on 24 Sept at 06:46Z (54 min after `resets Sep 30, 4am`)? Extra usage, a model-specific pool, or a transient message? This decides whether /execution can plan on "buy more" during the event.
2. Is the weekly reset really fixed at Wednesday 04:00 Paris, so that it falls at 10:00 SGT on 7 Oct? The statusline shows the 7-day reset time; check it on 4 Oct before planning.
3. Can a Workflow agent or a hook read the `rate_limits` figures the statusline receives, or must a statusline script persist them to a file for /execution?
4. Does a CronCreate watchdog keep firing while the machine sleeps, the laptop lid is closed, or the session was resumed through Remote Control from the phone?
5. For Origins, is the build run with workflows at all? At XRPL and Monad the in-person build ran in the main session step by step, and workflows were used only around it (F03). The rehearsal should prove parallel builder waves at event speed.
6. The TOKEN2049 plan asks for a complete "ugly take" at hour 18-20 (`_recommendation.md`, section 2.1.6); the user's rule forbids deliverables before completeness. Is a timed insurance recording an exception, as the XRPL backup video was?
7. Who commits when dev B runs the same /execution on the same repo: does each side commit its own lane (Hedera style) or does one side integrate (Holdover style)?
8. Will the 30 Sept pre-harden completeness critic (still running at 20:48Z) report anything that changes F13?

---

## Sources

Run records and scripts
- `~/.claude/projects/*/*/workflows/wf_*.json` (97 records; fields `workflowName`, `status`, `startTime`, `durationMs`, `agentCount`, `totalTokens`, `workflowProgress[].{label, model, state, cached, attempt, durationMs, tokens}`, `logs`)
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera--scratch/6052e9a6-d475-44b3-8b24-4e8c24b70da1/workflows/scripts/hedera-template-base-and-skeleton-wf_c24b73a4-4a5.js`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera/6052e9a6-d475-44b3-8b24-4e8c24b70da1/workflows/scripts/hedera-template-day2-wf_fad060d4-d39.js`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera-research-build-day2/6052e9a6-d475-44b3-8b24-4e8c24b70da1/workflows/scripts/hedera-template-npm-typecheck-fix-wf_ae3b61a1-f80.js`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera-scaffold-hbar-saucerswap-v2/6052e9a6-d475-44b3-8b24-4e8c24b70da1/workflows/scripts/hedera-template-day3-wf_e00db5d5-b52.js`, `...-lock-and-audit-wf_52afe057-be4.js`, `...-docs-traps-wf_5e24b2a7-308.js`, `...-readme-wf_dd77f843-b8f.js`, `...-day6-wf_bbb75252-48f.js`, `...-day7-moves-wf_29e29857-f42.js`, `pre-harden-completeness-wf_e6c7920b-f6e.js`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera-research-findings/6052e9a6-d475-44b3-8b24-4e8c24b70da1/workflows/scripts/hedera-template-day4-lp-wf_04085e40-72b.js`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-BNB-holdover/f3a0fee8-143f-434c-aba6-de59c871fd80/workflows/scripts/holdover-engine-and-hygiene-wf_5e087bd4-4d3.js`, `holdover-sources-wf_a8ec37e8-b2d.js`; `...-Coding-BNB-research-probes-out/.../holdover-engine-apps-wf_5616bc21-62b.js`; `...-Coding-BNB/.../holdover-studio-and-integrations-wf_6ded9ca7-4ba.js`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-XRPL-Hackathon-2026/923db298-ebe9-4ef8-8731-636d9035dd74/workflows/scripts/` (`xls6566-deliverables`, `workshop-rescope`, `orma-mintlify-docs`, `orma-readme-paper-deck`, `orma-annex-finishing-pass`, `demo-path-audit`, `filing-prep`)
- Journal: `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera/6052e9a6-d475-44b3-8b24-4e8c24b70da1/subagents/workflows/wf_e6c7920b-f6e/journal.jsonl`

Transcripts (user messages and tool calls extracted by script, not read whole)
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera/6052e9a6-d475-44b3-8b24-4e8c24b70da1.jsonl`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-BNB/f3a0fee8-143f-434c-aba6-de59c871fd80.jsonl`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-XRPL-Hackathon-2026/923db298-ebe9-4ef8-8731-636d9035dd74.jsonl`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Monad-Blitz-Paris/a770cd7a-dbd6-46ff-9763-622a815b9afb.jsonl`, `...-Monad-Blitz-Paris-auramaxx/5db41ea3-0e77-4306-b1f2-7b337466d452.jsonl`
- `~/.claude/projects/C--Users-Utilisateur-Documents/07b2a7e3-7e11-4172-88b7-b914883d3729.jsonl`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera-scaffold-hbar-saucerswap-v2/86909e65-78fd-418a-8f7d-3b12b0fdc4ce.jsonl`

Plans, notes and code
- `Documents/Coding/Hedera/research/findings/TASKLIST.md`; `Documents/Coding/Hedera/research/findings/expectation-ledger.md`
- `Documents/Coding/Hedera/research/build/day1/{review,fix}.md`, `day2/{review,npmfix,npmfix-verify,spike,fix}.md`, `day3/{review,fix}.md`, `day4/{review,fix,lp-cycles}.md`, `day5/{judge-audit,fix}.md`
- `Documents/Coding/Hedera/.scratch/w2b-gate-linux/logs/30-host-disk-full-and-daemon-hung.log`
- `Documents/Coding/BNB/research/TASKS.md`; `Documents/Coding/BNB/holdover/scripts/completion-check.mjs` (and its `--json` run output)
- `Documents/Coding/XRPL_Hackathon_2026/docs/02-TIMELINE.md`, `11-TASKS-BACKEND.md`, `21-TASKS-FRONTEND.md`, `45-RUNSHEET.md`, `47-MATIN.md`, `48-PROMPT-DEVB-FEEDBACK.md`; `Documents/Coding/XRPL_Hackathon_2026/CLAUDE.md`
- `Documents/Documents Perso/token2049/research/findings/wave3/_recommendation.md` (section 2.1.6)
- `C:/Users/Utilisateur/AppData/Local/Temp/claude/C--Users-Utilisateur-Documents/07b2a7e3-7e11-4172-88b7-b914883d3729/scratchpad/{overnight-plan,night2-plan,overnight-summary}.md`
- `~/.claude/skills/hackathon/references/{06-operations,08-assistant-failures,01-find-the-gap}.md`; `~/.claude/skills/harden/SKILL.md` (frontmatter); `~/.claude/hooks/guard.py` (header); `~/.claude/statusline.py`

Memory
- `~/.claude/projects/C--Users-Utilisateur/memory/{project_hedera_scaffold_bounty,project_harden_skill,project_execution_skill,project_bnb_tokenized_stocks_hack,project_ledger_op3n,project_xrpl_vault_oracle,project_token2049_origins,feedback_windows_file_writing}.md`
- `~/.claude/projects/C--Users-Utilisateur-Documents-Coding-Hedera/memory/project_hedera_scaffold_bounty.md`; `...-Coding-BNB/memory/project_bnb_holdover.md`; `...-Coding-XRPL-Hackathon-2026/memory/{no-ai-attribution-in-commits,pre-event-material-stays-gitignored}.md`

Commands run (read-only)
- Python tabulations over the run records (durations, agents, tokens, per-role medians, busy-time union, token sums between limit events) and over the journal; user-message and tool-call extraction from transcripts.
- `node scripts/completion-check.mjs --json` in `Documents/Coding/BNB/holdover` (exit 1; 4 gates open).
- `df -h /c` (2.4 GB free) and `nproc` (16).
