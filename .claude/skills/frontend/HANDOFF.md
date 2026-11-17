# /frontend: hand-off (2026-10-01, 13:10 Paris; status updated 2026-10-12)

**Status 2026-10-12 (same account, session fc5626a6 resumed on 11 Oct).** The build is finished: steps 1 and 2 of
section 4 are done. `evals/workflows/build-resume-a.js` (the 8 builders plus Reconcile) and `build-resume-b.js`
(integration, 3-lens review, fixes, final check) ran on 11-12 Oct; read `evals/build-report.md` for what exists, the
test results (1456 tests green, typecheck 0, check-refs ok, e2e bad-site 27 of 27 planted tells confirmed) and the
known limits. Sections 1 and 4 below keep the 1 Oct picture for history. Next, in order: the first real run in mode B
on the Ledger OP3N badge app, **only once the owner has framed it** (they give the brief, the branch and the scope);
then calibration (step 3), the rehearsal (4), A/B (5) and the hand-over (6). The agents are installed (step 6's
`install-agents.mjs`). Nothing is committed yet.

The first session (account 1, session fc5626a6) stopped here because the owner's weekly quota on account 1 reached
89% (reset Wed 7 Oct 04:00 Paris, 22 h into TOKEN2049 Origins; /execution keeps that remainder). The owner continues
/frontend from a second Claude account on the same machine. Everything below is on disk; nothing lives only in the old
conversation. Read this file first, then `ARCHITECTURE.md`, `scripts/CONTRACTS.md` and `SKILL.md`.

**Deadline:** the skill must be built, calibrated and rehearsed before **Sun 4 Oct 12:00 Paris** (the owner flies to
Singapore; Origins hack window Tue 6 Oct 12:00 SGT to Wed 7 Oct 23:59 SGT). Converse with the owner in French; write
files in English (memory `feedback_language_french_convo.md`).

---

## 1. What exists

| part | state | where |
|---|---|---|
| Research: 21 verified dossiers (628 findings: 323 verified, 265 corrected, 7 downgraded, 33 added), critic report | done | `research/`, `research/INDEX.md`, `research/_critic-round1.md`; local evidence in `research/evidence/`, `research/assets/` (gitignored, third-party material) |
| Architecture, approved with the owner's decisions | done | `ARCHITECTURE.md` |
| Interface contract | done, **v1.1 additions pending** (section 4 step 2) | `scripts/CONTRACTS.md` |
| SKILL.md | written by the first session, not yet reviewed | `SKILL.md` |
| Rule registry: 51 rules, all `candidate` | done | `scripts/rules/registry.json` |
| Toolchain: pinned deps installed (playwright-core 1.59.1 uses the installed Chromium 147 rev 1217) | done | `scripts/package.json`, `scripts/node_modules` |
| lib/ + rules/load.mjs (149 tests green) | done | `scripts/lib/`, `scripts/rules/load.mjs` |
| 16 reference files (310 rules, 1,277 citations) | written, **not yet reviewed** | `references/` |
| Assets: 19 schemas, task templates FE-00..FE-21 (+FE-09), wave fragments, agent templates, templates, sponsor allowlist (223 tests green) | done | `assets/`, `scripts/install-agents.mjs` |
| Calibration corpus plan: 44 entries (12 positive, 11 control, 13 exemplar, 8 synthetic), labelling plan, 8 synthetic prompts | done, nothing rendered yet | `calibration/` |
| Builders completed: slop-check (57 tests), brief/coverage/firstview (82), frontend-check/calibrate/check-refs (80), critique/board (72), tokens (99) | done, reports in `evals/build-progress-2026-10-01.json` | `scripts/*.mjs` |
| Builders INTERRUPTED (files on disk, unverified): capture-gate/capture/extract, qa, static detectors SL-T*, static detectors M/C/G/X/MO, runtime detectors SL-T*, runtime detectors M/C/G/X/MO, brand/brand-check | **to finish** | `scripts/`, `scripts/rules/static/`, `scripts/rules/runtime/` |
| Builder FAILED (files on disk, unverified): ip-check, motion-check, recording-check | **to finish** | `scripts/` |
| Integration (e2e good-site and bad-site), 3-lens review, fixes, final report | **not started** | |
| Calibration, owner labels, rehearsal, A/B evaluation | **not started** | |

Workflow scripts used so far are in `evals/workflows/` (research, gap round, build). `evals/workflows/build-resume.js`
resumes the build (section 4 step 1).

## 2. The owner's decisions (do not reopen)

1. Ready and rehearsed on a fixture before Sun 4 Oct 12:00 Paris.
2. General engine with a hackathon/event profile on top.
3. Invoked by /execution during the build (mode A) and by hand on an existing project (mode B, e.g. BNB Holdover).
4. Coordinate the interface with the session building /execution.
5. /frontend runs FROM THE START of /execution's build as task templates; /execution's simple-UI path is dropped.
6. Copying boundary: conventions and measured relationships only (pattern ledger); never a customer's pixels, logos,
   copy, imagery or licensed fonts as generation input.
7. Owner review of directions (H1) and logo (H2) on a private Claude Design canvas published by the orchestrator.
8. Full v1 with calibration and A/B evaluation (now on the second account's quota).
Defaults in ARCHITECTURE.md section 14 item 5 stand unless the owner objects.

## 3. Agreements with /execution (its session ran on account 1, name "documents-d2")

Recorded on its side in `C:/Users/Utilisateur/.claude/skills/execution/contract/FRONTEND.md` (sections 1-14, read
it) and its ARCHITECTURE.md section 19. **Cross-session messages do not cross accounts**: coordinate through files and
the owner. Write every shape change of `assets/task-templates/frontend.json` or of a gate into `CHANGELOG.md` in this
folder (create it) and tell the owner, who relays.
- Template ids FE-xx are instantiated as T-ids with `template: "frontend:FE-xx"`; dependencies resolve at instantiation
  (params `references: on|off`; FE-07 always after FE-06; `decision:project-name`; FE-1x per feature group with
  `covers`); /execution adapts frontend.json through an adapter and pins a copy: tell them about shape changes.
- FE-21 (owner sign-off H3) is phase deliverable, after the /harden review task.
- Proof = `frontend-check --json ...`, exit 0 iff every requested gate is ok; a requested skipped gate exits 1.
- `--gates <groups or ids> --features FR-003,FR-007`; `data-feature` carries the spec's requirement id.
- Profile: /execution's `profile.json` `frontend` block (or a bare block in mode B); top-level `prework` authoritative;
  `phase_b.claims_ledger` is the ledger; `workspace.private_dir` for captures; absolute paths outside the repo.
- Never-show file: JSON `{version, entries:[{id, class, pattern, regex, case_sensitive, until_utc, scope, note,
  source}]}` shared by both skills. Folding: NFKC then `toLowerCase()` (never casefold); regex entries get the `i` flag
  when case_sensitive is false; regex subset: no lookbehind, backreferences, named groups or inline flags (Q-F9).
- Feature catalogue (generated by /execution): `[{id, group, title, priority, status_expected?}]`.
- frontend-check never builds; proofs chain the build; `--start "<cmd>" --url` for server apps.
- Wave fragments `assets/wave-fragments/critique.js` and `directions.js`, plain JS, no imports, no Date.now or
  Math.random, script steps as agent() calls; they must NOT dictate commit messages (Q-F15).
- Agents frontend-critic and frontend-probe: read-only, the same disallowedTools as /execution's agents.
- Review board published by the orchestrator only; one answer channel (Notion decision field or Remote Control reply).
- `--state <dir>` override for pre-T0 runs into `<private_dir>/frontend/`, imported at T0.
- Pending on our side: Q-F14 (`--out` given: write only there, never the state dir), Q-F11 (`canvas_url`,
  `type_release`, `published_at` in choices.schema.json), Q-FX-5 (unknown sponsor id = no marks to exempt, not an
  error), Q-F3 (FE-08/FE-20 writes exclude the UI manifest; /execution installs it in its contract wave).
- Shared fixture "Queue Clock" (ETA of liquid-staking withdrawals; sponsor Lido; candidate customers Aave, Morpho,
  EigenLayer, Spark, Euler, Curve) at `C:/Users/Utilisateur/.claude/skills/execution/evals/fixture/` (not written yet on
  13:10, 1 Oct); instantiate with `python C:/Users/Utilisateur/.claude/skills/execution/scripts/exec.py fixture new --out
  <dir> --frontend-mode full` when it exists, or copy the folder and set `profile.frontend.mode` to `full` by hand.

## 4. What to do next, in order

1. **Finish the build.** Launch `Workflow({scriptPath: "C:/Users/Utilisateur/.claude/skills/frontend/evals/workflows/build-resume.js"})`.
   It re-runs the 8 unfinished builders (they read and complete the files already on disk), then a Reconcile step that
   writes every reported contract extension into CONTRACTS.md and applies the /execution agreements (Q-F14, Q-F11,
   Q-F15, Q-F9, Q-FX-5, `--phase small`, the FE-09 template, a `paths.mjs` guard, the `test:fast` script), then
   integration (e2e good-site and bad-site fixtures), a 3-lens adversarial review (code, detectors, docs), fixes and a
   final report in `evals/build-report.md`. About 17 agents. Read the result and the report; fix what remains.
2. **Review SKILL.md** against the final code and references (it was written before them): gate ids, commands, setup,
   small mode. Keep it under 500 lines with the invariants in the first 5,000 tokens. Run `node scripts/check-refs.mjs`.
3. **Calibrate** (ARCHITECTURE section 5.2, `calibration/corpus.json`, `calibration/labelling-plan.md`):
   generate the 8 synthetic pages from `calibration/synthetic/prompts/` with fresh agents that have NO skill loaded;
   render the ready entries (owner deployments, the static builds listed, Wayback controls; build the needs-build
   entries only if disk allows, about 9 GB free); run `node scripts/calibrate.mjs`; review its proposal; then the
   owner's 15-minute labelling session: a private artifact page usable on a phone showing ONLY the owner's own projects
   and synthetic pages (never third-party captures), storing labels the session reads back; set tiers with
   `calibrate.mjs --apply` only after the owner's labels and your review. A tier-1 rule must stay silent on the
   pre-2023 controls.
4. **Rehearse** on an instance of the shared fixture in mode B, full mode, end to end (P0-P8), answering H1, H2 and H3
   with the owner on the phone once; record time and tokens.
5. **A/B**: 2 runs per arm on fresh fixture instances: arm A = a plain Claude Code build of the same brief with no
   skill; arm B = /frontend mode B with automated H1/H2 picks (first direction, first logo) recorded as such. Measure:
   frontend-check results (biased toward the skill: say so), blind pairwise judgements by fresh agents (which page lets
   a jury understand faster, which looks less generated), blind first-viewport probe accuracy, time and tokens. Write
   `evals/ab-2026-10.md`.
6. **Install and hand over**: `node scripts/install-agents.mjs`; update `CHANGELOG.md` and tell the owner what changed
   for /execution; update the memory file `project_frontend_skill.md`; ask the owner before committing
   `skills/frontend/` to the `~/.claude` repo (local commit, conventional message, NO AI attribution line, never push
   without asking).

## 5. Constraints and gotchas

- Windows + Git Bash: write files UTF-8 LF; never put regexes or backslashes in heredocs (they get mangled): write a
  file with the Write tool and run it. Python file writes need `newline='\n'`.
- Disk: about 9 GB free. Never clone whole repos; no browser download (playwright-core 1.59.1 matches Chromium 1217);
  never run `npm install` or `pnpm install` from a folder without its own package.json (it resolves to the home
  folder's package.json).
- Quota: the second account has its own limits; `~/.claude/usage-snapshot.json` is written by whichever session renders
  a status line, so on this machine it may show the other account. Pace workflows; never launch big fan-outs blindly.
- Never read or open the owner's own Claude Design canvases (a read creates new versions of them); reading the Design
  TYPE's files (`Artifact read url=<type url> path=SKILL.md`) is fine.
- Never send the owner's email or personal data to any service (a research agent once did; reported to the owner).
- Captures of third-party sites go through `scripts/capture-gate.mjs` only: robots.txt, no user-agent swap, stop on a
  bot wall. Three earlier extractions in `research/evidence/tool-awesome-design-md/live-extraction/*_ua.json` were
  made with a user-agent swap that the policy now forbids: ask the owner whether to delete them.
- The skills `/harden` and `/prose` exist: /frontend's output must pass harden's frontend lens later; UI copy goes to
  /prose through `ui-copy.md`.

## 6. Open questions for the owner (ask when relevant, not all at once)

- Delete the three `*_ua.json` captures (above)?
- Ask the Origins organisers whether a logo or token file made before kickoff counts as a design, and whether
  ".ppt or .keynote" accepts .pptx and .key (a 97-2003 .ppt turns embedded video into a still).
- Tell defaults: is Inter a hard ban or "needs a reason"? Serif italic outside display text? One-shot reveals that
  explain the mechanism? The sponsor's own purple? Definition of "inconsistent spacing"?
- Which past frontends count as vibecoded (teammates' work, Figma Make exports, the Hedera template)? The labelling
  session settles most of it.
- Added 2026-10-12 by the build review (`evals/build-report.md` sections 5 to 7):
  - Uncalibrated tells gates: keep them as advisory oks (today) or make them `skipped`, which fails every task proof
    until calibration (a contract change with /execution)?
  - Capture policy P11 (two shots per page) against capture.mjs's default of 3 slices per viewport: amend P11 or
    lower the code default? The docs pass `--slices 1` meanwhile.
  - recording.g16 (deck video embed) blocks `--phase build` until `--deck` exists: move it into the deck task or keep
    it?
  - A Hedera entry in `assets/sponsor-allowlist.json` (needs FD21-style research and a network fetch) or a waiver
    convention for sponsor templates?
  - FD14-F03's manual matrix counts T5 callouts and T6 frosted navbars that the registry excludes: settle the policy
    before calibration uses the matrix.

Already told to the owner on 1 Oct (no action needed from you): the BNB board at holdover.fly.dev shows findings the
BNB memory holds until 11 Oct 12:00 UTC; the public Orma repo ships IBM Plex subsets that keep the reserved name
"Plex"; the research incidents (an email sent to Unpaywall, new versions on two Design canvases, a stray home-folder
node_modules removed).
