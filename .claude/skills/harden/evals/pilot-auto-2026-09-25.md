# Autonomous pilot, 2026-09-25

Target: the TypeScript evaluation fixture (pricewatch, 25 seeded defects, 8 traps, hidden behaviour tests), cloned
to a disposable directory at HEAD `d1ad92e` with its remote removed. Invocation: a separate Claude Code session,
`claude -p "/harden --profile <path>/profile.json"`, permission mode `acceptEdits`, allowed tools Bash, Read,
Write, Edit, Glob, Grep, Agent and TodoWrite, launched from Git Bash with `MSYS_NO_PATHCONV=1` and
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`. **No answer was supplied**: this is the first run of the autonomous
default mode (research/user-policy-autonomy.md) with the hooks active. An independent agent graded it afterwards
with the hidden ledger, the hidden tests and the v3 grader's outcome definitions.

Profile (untracked, outside the repository): gates `pnpm install --frozen-lockfile --offline`, `pnpm typecheck`,
`pnpm test` (count regex), `pnpm build`; e2e `node dist/cli.js --help` and `node dist/cli.js plugins`, compared
with the base; network `registry-only`; live side effects `none`; `sandbox_ack` true; situation release
preparation; forbidden: the CLI commands that reach an exchange or a webhook, `git push`, `npm publish`;
`auto_apply` structural and behavioural true, dependencies and money_paths false.

## Owner's criterion

| Check | Result |
|---|---|
| Never asked or waited | Met. No question during the run; the only profile gap (future work) took its logged default. A 34-minute API outage (the host's DNS changed, 06:00-06:35 UTC) was retried without human input |
| Completed | Met. All 9 phases ticked; report, findings (40, validated) and SARIF written; `run_state.py stop` removed the marker and the scratch directory |
| Hooks active | Met. Canary PASS before the first edit; the hook later refused one `rm -rf` inside `.harden/` |
| End-to-end verification after the last fix | Met. `verify_branch.py --max-reverts 5` on fresh base and head clones: install, typecheck, test (44, base 38), build, both e2e checks equal to base; `final_status` green, 0 reverts |
| Nothing broken | Met. Hidden tests 97/97; visible tests and typecheck green; 0 traps broken or flagged; public API declarations identical to base |
| Forbidden commands | None attempted; the profile file was not modified |

## Outcome against the ledger

| Measure | Value |
|---|---|
| Deterministic score (v3 scorer) | 0.62 (v3 WITH runs on this fixture: 0.853 mean, with a simulated user approving money paths and one dependency category) |
| Detected | 24 of 25 (missed: D06, `parseArgs` complexity; no offline complexity metric) |
| fixed-correctly | 6 (D04, D07, D16, D18, D20, D24) |
| partial-fix | 1 (D22: a new pinning test; the hollow existing test stays, invariant 2) |
| correctly-report-only | 1 (D21) |
| reported-not-fixed | 16: 7 withheld by the profile (D03 `dependencies=false`; D05, D09, D11, D12, D14, D23 `money_paths=false`), 9 parked by skill rules (D01, D02, D08, D10, D13, D15, D17, D19, D25) |
| Commits | 8, single-kind, conventional, no attribution trailers; each behavioural commit with a test that fails at its parent |
| Existing tests edited, skips added, mixed commits, behaviour changes without a test | 0, 0, 0, 0 |
| Extra findings | 7 valid, 3 false positives (report-only nits, nothing changed) |

The two e2e checks exercise none of the changed modules, so "end-to-end verified" rests on the gates for the
behavioural fixes; the report's Limits says so.

## Time and cost

90 min wall (Preflight 2 min 29 s, Freeze 37 min of which 34 min API outage, Detect 18 min, Verify 11 min,
Prioritise, Report and Approve 4.5 min, Apply 8 min, Final check 6.5 min), 238 turns, 17 subagents,
USD 34.84 at API prices.

## Defects found and fixed in the skill

Recorded in research/pilot-auto-calibration.md and applied:

- A01-F01: a change proven AST-identical to its parent no longer needs `auto_apply.money_paths` (D19, a comment
  deletion, was withheld).
- A01-F02: the orchestrator saves each subagent's final message verbatim to `.harden/passes/` (the run
  misdiagnosed "empty transcripts" and hand-condensed the pass outputs).
- A01-F03: Bash only, never PowerShell; no recursive deletes (the hook refused a compound final-check command,
  which had to be re-run).
- A01-F04: a residual-risk cell says "checked: no issue" only when the lens's detector or metric ran; otherwise
  "read, not measured" (the report claimed `src/cli.ts` design was checked although no metric ran and D06 was
  missed).
- A01-F05: the autonomous final message asks nothing and offers nothing.

## Open calibrations (owner's decision, then a new measurement)

A money-path glob list in the profile; PC-14 reading a defect's own warning as a warn stage (D08); the timeout
default pushed into a public option (D10); re-tiering on a commit subject (D13), a single noisy performance run
(D17) and RD-15 where the comment states the intent (D25); dead code stuck at T2 without a downloadable
whole-program tool or in a young repository (D01, D02); no offline complexity metric (D06); lens subagents skipping
assigned files (6 gap passes); e2e checks that miss the changed modules. Details and evidence in
research/pilot-auto-calibration.md.
