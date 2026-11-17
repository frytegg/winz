# /frontend build report

Final check of the /frontend skill build, 2026-10-12. Everything below was run from
`C:/Users/Utilisateur/.claude/skills/frontend/scripts` on Windows 11 (Node, pnpm 10.19.0, playwright-core 1.59.1
against the installed Chromium). The final checker changed no code: the suite was green on both runs, so there was
nothing to fix.

Verdict in one line: the build is complete and green, but no rule is calibrated yet, so the tells layer cannot fail a
site, and several contract and registry updates from the review are still owed (section 6).

## 1. What exists

Line counts are `wc -l` on 2026-10-12. The skill folder is untracked in the `~/.claude` repository (nothing committed).

### Top level

| file | lines |
|---|---|
| SKILL.md | 141 |
| ARCHITECTURE.md | 503 |
| HANDOFF.md | 143 |
| CHANGELOG.md | 71 |

### references/ (16 files, 3,326 lines)

| file | lines | file | lines |
|---|---|---|---|
| 00-contract.md | 193 | 08-motion.md | 235 |
| 01-brief.md | 125 | 09-recording.md | 184 |
| 02-references.md | 160 | 10-gates.md | 274 |
| 03-directions.md | 183 | 11-tells.md | 219 |
| 04-brand.md | 342 | 12-critique.md | 138 |
| 05-tokens.md | 275 | 13-stack.md | 244 |
| 06-build.md | 166 | 14-copy.md | 140 |
| 07-states-web3.md | 267 | 15-ip-provenance.md | 181 |

### assets/ (42 files)

| part | files | lines |
|---|---|---|
| schemas/ | 19 | 2,621 |
| templates/ | 14 | 724 |
| task-templates/frontend.json (FE-00 to FE-21 plus FE-09) | 1 | 699 |
| wave-fragments/ (critique.js 682, directions.js 317) | 2 | 999 |
| agents/ (frontend-critic 25, frontend-probe 23) | 2 | 48 |
| licenses/ (third-party notices, impeccable LICENSE and NOTICE) | 3 | 231 |
| sponsor-allowlist.json (ten parties) | 1 | 443 |

### scripts/: CLIs (20 files plus the contract, 37,085 lines)

| file | lines | file | lines |
|---|---|---|---|
| board.mjs | 2,149 | extract.mjs | 1,794 |
| brand-check.mjs | 1,315 | firstview.mjs | 525 |
| brand.mjs | 4,297 | frontend-check.mjs | 1,241 |
| brief.mjs | 2,089 | install-agents.mjs | 279 |
| calibrate.mjs | 1,618 | ip-check.mjs | 2,331 |
| capture-gate.mjs | 1,755 | motion-check.mjs | 1,016 |
| capture.mjs | 1,244 | qa.mjs | 3,114 |
| check-refs.mjs | 636 | recording-check.mjs | 1,459 |
| coverage.mjs | 1,269 | slop-check.mjs | 1,735 |
| critique.mjs | 2,998 | tokens.mjs | 3,464 |
| CONTRACTS.md | 757 | | |

### scripts/lib/ (13 files, 4,588 lines)

args 157, browser 215, color 495, dom 816, errors 94, fsutil 246, paths 209, profile 692, ready 130, report 176,
routes 113, serve 373, text 872.

### scripts/rules/ (22,985 lines of .mjs, plus the registry)

| part | files | lines |
|---|---|---|
| registry.json (51 rules, all tier `candidate`) | 1 | 1,835 |
| load.mjs | 1 | 872 |
| static/ detectors | 50 | 14,489 |
| runtime/ detectors | 49 | 7,624 |

### scripts/tests/ (82 test files, 849 files with fixtures, 21,336 lines of .mjs)

Test files per folder: lib 17, brand 11, tokens 8, rules 8, assets 6, capture 4, motion 3, slop-check 3, and 1 or 2
each for board, brief, calibrate, check-refs, coverage, critique, firstview, frontend-check, install-agents, ip, qa,
recording, plus `e2e.browser.test.mjs` (258 lines) and `e2e/build-fixtures.mjs` (279). Fixtures: 21 folders, 2.0 MB,
including `fixtures/e2e/good-site` and `fixtures/e2e/bad-site`.

### Research and calibration

- research/: 23 dossiers and notes at the top level (16,880 lines), 1,042 files in all with local evidence
  (third-party material, git-ignored).
- calibration/: corpus.json (2,130 lines, 44 entries), labelling-plan.md (294 lines), 8 synthetic prompts. Nothing is
  rendered or labelled yet.
- evals/: build-progress-2026-10-01.json, six workflow scripts, and this report.

## 2. Test, typecheck and reference results

| command | exit | summary |
|---|---|---|
| `pnpm test` (run 1) | 0 | `ℹ tests 1456` `ℹ suites 178` `ℹ pass 1456` `ℹ fail 0` `ℹ cancelled 0` `ℹ skipped 0` `ℹ todo 0` `ℹ duration_ms 160979.4399` |
| `pnpm test` (run 2) | 0 | `ℹ tests 1456` `ℹ suites 178` `ℹ pass 1456` `ℹ fail 0` `ℹ cancelled 0` `ℹ skipped 0` `ℹ todo 0` `ℹ duration_ms 157862.0143` |
| `pnpm run typecheck` (`tsc --noEmit -p tsconfig.json`) | 0 | no output, no errors |
| `node check-refs.mjs` | 0 | `check-refs: 30 files, 1527 citations (1245 findings, 431 distinct; 147 dossiers; 135 sections): 0 missing, 0 dropped, 0 missing dossiers, 0 unresolved sections (warnings)` then `check-refs: ok` |
| `node --test tests/e2e.browser.test.mjs` | 0 | `ℹ tests 11` `ℹ suites 3` `ℹ pass 11` `ℹ fail 0` `ℹ cancelled 0` `ℹ skipped 0` `ℹ duration_ms 103037.2157` |

Notes:

- Both full runs gave the same count. The flakes the fix builders reported (firstview failing fixture, browser-offline
  TypeError) did not recur in either run.
- After both runs, `scripts/.frontend` does not exist: the suite no longer writes a state folder into the skill.
- check-refs warns about em dashes in prose: `SKILL.md: 9 (5.51 per 1,000 words), lines 7, 127, 128, 129, 130, 132,
  133, 134` and `ARCHITECTURE.md: 1 ... lines 48`. The ARCHITECTURE one is the quoted "WORD, dash, fragment" label,
  kept on purpose. The SKILL.md ones are open (section 6).

## 3. End to end: planted tells on bad-site

The e2e test copies both fixture sites, compiles the brief with `brief.mjs` (FE-00), then runs
`frontend-check --phase build --serve <copy>/site --out <dir> --json` exactly as a task proof does, offline.

- good-site: exit 0, every gate of the build phase ok across ten groups (a11y, brand, brief, coverage, firstview,
  ip, motion, render, tells, tokens), no confirmed tell, no detector or page error, its SL-M13 waiver valid.
- bad-site: exit 1 with no skipped gate. coverage.features, coverage.metrics, coverage.hero, coverage.placeholders
  and firstview.contract fail; ip.hotlinks and render.requests fail on the Google Fonts link, which the offline
  context aborts (`net::ERR_BLOCKED_BY_CLIENT`).

**Planted tells confirmed: 27 of 27. Missed: none. Confirmed but not planted: none.** The test's floor is 12.

| rule | planted tell | | rule | planted tell |
|---|---|---|---|---|
| SL-T01 | purple-to-blue gradient on the hero | | SL-X01 | unsourced figures (10K+, $50M, 99.9%) |
| SL-T02 | gradient hero text | | SL-X02 | placeholder names (John Doe, Acme Corp, lorem, TODO) |
| SL-T03 | emoji headings | | SL-T17 | buzzword copy |
| SL-T04 | Inter as the only face | | SL-M09 | blurred colour blobs and glows |
| SL-T06 | glass cards | | SL-M17 | "Trusted by" headline |
| SL-T09 | a badge above the h1 | | SL-C01 | pill buttons |
| SL-T08 | three icon boxes in a row | | SL-C02 | 100vh hero |
| SL-T12 | fade-in on scroll | | SL-C03 | everything centred |
| SL-T14 | buttons that fade on hover | | SL-M08 | near-black default ground |
| SL-T16 | em dashes in the copy | | SL-T07 | low-contrast grey text on the dark ground |
| SL-M04 | an invented stats banner | | SL-MO1 | transition: all |
| SL-M05 | Acme testimonial cards | | SL-MO2 | ease-in entrances |
| SL-M12 | "Get started" and "Learn more" in a centred hero | | SL-MO3 | 800 ms reveals |
| | | | SL-MO5 | no prefers-reduced-motion handling |

Two caveats on what this proves:

- **The tells gates do not fail bad-site as shipped.** With all 51 rules `candidate`, tells.tier1, tells.tier2 and
  tells.score are advisory oks (`tests/slop-check/tiered-bad-site.browser.test.mjs`: "with every rule a candidate,
  the three tells gates are advisory oks that judged nothing binding"). bad-site fails on coverage, first view,
  placeholders and hotlinks, not on its tells. The same test proves that once six of the planted rules are set to
  tier 1, tells.tier1 fails on the same site.
- The fixture was written by the same build that wrote the detectors, so 27 of 27 measures recall on tells the
  detectors were built for, not on real projects. Real-project precision is the calibration's job (section 7).

## 4. Review findings and how each was handled

The three-lens review raised 60 findings: 2 blocking, 24 major, 34 minor. Four fix builders (code, detectors, docs,
assets) handled them. Result: 58 fixed (several with a part left to the owner or to the registry and contract, noted
in the outcome column), 1 refuted (SL-T01), 1 deferred (the research dossier).
"Fixed" below is the builder's claim, checked by the builder against its tests; this final check confirmed the suite
is green and spot-checked the items in section 6.

### Code

| sev | where | finding | outcome |
|---|---|---|---|
| major | lib/browser.mjs | offline context let WebSockets and self-started navigations leave the machine | fixed: routeWebSocket closes foreign sockets; only origins the caller allowed pass; test covers ws, location.href, meta refresh, link and popup |
| major | frontend-check.mjs (all 20 CLIs) | isMain() false through a symlink or junction, so the CLI exits 0 having run nothing | fixed: lib/args isMainModule compares real paths; junction test |
| major | frontend-check.mjs | --start process-tree kill unchecked | fixed: tree listed before the kill, survivors polled, a survivor exits 3. A Windows Job object was not added (needs native bindings); a hard kill of frontend-check itself can still leave a tree |
| major | recording-check.mjs | g03 passed with no `data-rec-role="key"` | fixed: now fails; fixture test |
| minor | recording-check.mjs, firstview.mjs | warn-only gates counted as passes | fixed: `advisory: true` oks, counted in `counts.advisory`; CONTRACTS s4 and CHANGELOG updated |
| minor | critique.mjs | --start differed from frontend-check (ms timeout, no stale-server check, no handlers) | fixed: reuses frontend-check's startServer; seconds; handlers; allSettled close |
| minor | brand-check.mjs | fetch followed redirects off the target | fixed: manual redirects, target origin only, at most 5 |
| minor | qa.mjs | same-second reports overwrite; state written under --out | fixed: unique suffix; nothing written to state with --out |
| minor | frontend-check.mjs | --allow-skip accepted groups not in the run | fixed: usage error (exit 2) |
| blocking | rules/load.mjs | static layer read git-ignored files, venvs, submodules | fixed: git-visible files only, nested work trees dropped, more default excludes, `paths.ui` / `--ui-paths` |
| major | lib/paths.mjs | a static run wrote `.frontend` and an exclude line into the checked repo | fixed: no state folder unless --state or one exists; checkStateDir in five module CLIs. A related suite bug (critique runAccept) was found and fixed too |
| minor | slop-check.mjs | --json gave no findings on static-only runs | fixed: `--report` mode with byRule counts |
| minor | SL-T17 | Apache-2.0 notice missing for impeccable's list | fixed: assets/licenses/, diffed identical to the source |

### Detectors

| sev | rule | finding | outcome |
|---|---|---|---|
| major | slop-check tells gates | cannot fail while all rules are candidates | fixed as advisory oks plus a tiered test. Switching to `skipped` deferred to the owner: it would fail every task proof until calibration (CONTRACTS s4, CT-07) |
| blocking | SL-T16 | em-dash rate over every copy segment in the repo | fixed: UI surface only, span-local locations, regex literals masked, logger/test strings excluded. Rates now inflexion 15.86, agentfi 3.24, BNB 7.47 |
| major | 19 static rules | no test, story or fixture exclusion; two diverging NOT_SHIPPED copies | fixed: one shared NOT_SHIPPED for all 50 static rules; test moves each positive fixture under excluded folders |
| major | SL-M09, M11, MO1, MO5 | no reachability check | fixed: mounted files only |
| major | SL-T20 | grain paired with a gradient anywhere | fixed: same page entry (mountedByEntry); new negative fixture |
| major | SL-T12 | startOnView={false} exemption never took effect | fixed: prop-gated whileInView skipped when every mount sets it false; fixture ships the vendored component |
| major | SL-T17 | missed agentfi; digits in names counted as specificity; wrong header claim | fixed: stock words restored (overridable by glossary.json), claim-like numbers only, header corrected; agentfi fires, no hit on six controls listed |
| major | SL-M17 | missed the hero lead paragraph | fixed: reads the first p after the h1; verbatim agentfi fixture |
| major | SL-T05 | only side stripes; patterns (b) and (c) absent | fixed: tinted card borders and gradient borders. Registry source citation not updated (section 6) |
| major | SL-M01 | cluster from parts anywhere | fixed: page ground only, same page |
| major | SL-T11 | fired on shadcn presence even rethemed; one primitive scored three times | fixed: fires only on default or generator primaries; score folds findings already claimed by a higher rule (`score.collapsed`) |
| major | SL-T01 | edited sponsor stylesheet can never be exempted | refuted: the contract exempts by whole-file hash or by waiver, never by colour; the waiver path covers it. Hedera allowlist entry deferred (needs research and network) |
| major | SL-M13, SL-M04 | data and CLI strings counted | fixed for M13 (logger, assert, Error, render-less modules skipped); M04 only through the UI-surface cut |
| minor | SL-T13, T14, T12, motion-check | wall-clock budget returned [] as if complete | fixed for T13, T14 (now a detector error) and motion settle (unsettled phases recorded, motion.reduced skipped). T12 refuted: its verdict completes before the budget check |
| minor | SL-M02 | any uppercase tracked class counted as an eyebrow | fixed: directly above the heading, class context only, callouts skipped |
| minor | SL-X01 | blind to mapped stat arrays | fixed for mapped array literals; numbers inside longer strings left to the runtime layer |
| minor | SL-G02 | no v0.app scaffold detection | fixed: metadata, unused font binding, placeholder files |
| minor | SL-T16 | placeholder gap, WORD-dash labels in arguments, borderline flips | fixed: placeholder dash, rendered text only, borderline note |
| minor | research/internal-negative-corpus.md | FD14-F03 matrix and registry disagree on T5 callouts and T6 frosted nav | deferred: research dossier, outside the docs builder's files; must be reconciled before calibration uses that matrix |

### Docs

| sev | where | finding | outcome |
|---|---|---|---|
| minor | CONTRACTS.md | outDir vs state-file contradiction | fixed: state files only when --out is absent |
| major | 02-references.md | RF-07/RF-08 did not match capture.mjs | fixed: docs pass `--slices 1` to keep P11; whether to amend P11 or lower the code default is an open owner decision (Gap recorded) |
| major | 10-gates.md, 08-motion.md | GT-21 claimed motion.inventory fails on notes-only cases | fixed to match the code |
| major | ARCHITECTURE.md | capture policy contradicted the capture rules | fixed |
| major | 04-brand.md and others | about a dozen stale Gaps | fixed across 01 to 15 |
| major | 04-brand.md, 13-stack.md | literal tell lists and a font ban in builder files | fixed: shape-level wording, reflex faces need a written reason |
| minor | 00-contract.md | CT-16 overclaimed | fixed |
| minor | 05-tokens.md | TK-11 7:1 as requirement | fixed |
| minor | 05-tokens.md, 13-stack.md | "fined" | fixed: damages and injunction |
| minor | 10-gates.md | first-view thresholds differed from the code | fixed |
| minor | ARCHITECTURE.md | nine vs ten sponsors | fixed |
| minor | 04-brand.md and others | font licence set disagreed | fixed: OFL, Apache, UFL or MIT everywhere |
| minor | 12-critique.md and others | hard-coded `--phase build` | fixed: `--phase {mode}` |
| minor | 04-brand.md | BR-24 wrong profile field | fixed |
| minor | 00-contract.md | run_mode default | fixed: A for /execution, B for a bare block |
| minor | 08-motion.md | MO-09 cited SL-T11 wrongly | fixed |
| minor | 12-critique.md | pixelmatch step | fixed: step removed, Gap recorded |
| minor | ARCHITECTURE.md, check-refs | em dashes; check-refs scope | fixed: scope widened to CONTRACTS, assets templates, agents, task templates. SKILL.md's 9 em dashes remain |
| minor | 13-stack.md | bare citations | fixed |
| minor | 03-directions.md | DR-16/IP-04 cited findings for a tool-description rule | fixed |
| minor | 11-tells.md | TL-05 vs TL-06 | fixed: TL-06 a documented, overridable exception |
| minor | 06-build.md | two markers missing | fixed |
| minor | ARCHITECTURE.md | status and sections 14, 15 dated 1 Oct | fixed |

### Assets

| sev | where | finding | outcome |
|---|---|---|---|
| major | task-templates FE-08 | negative control could not fail | fixed: proof adds coverage.hero; test that every named gate is selected |
| major | task-templates FE-05 | small mode allowed two candidates, gate needs three | fixed |
| minor | choices.schema.json | no way to record "none" at H1 | fixed: `none` with a required reason. CONTRACTS 6.3 not updated (section 6) |
| minor | wave-fragments/critique.js | stop on no-issue-kept vs CR-11 | fixed in the doc (CR-11 names the stop); code kept |
| minor | task-templates | missing brief_refs | fixed: FE-1x and FE-21 |

## 5. Known limits

- **No rule is calibrated.** All 51 registry rules are `candidate`; tells.tier1, tells.tier2 and tells.score are
  advisory oks on every site. Until calibration, the tells layer reports and never blocks.
- **Advisory gates.** recording g02, g04, g06, g08, g09, g13 and firstview.complexity judge nothing binding. They are
  marked, not hidden, but a reader of `counts.ok` alone would overcount.
- **Detector recall is measured on our own fixture only** (27 of 27 on bad-site), and the detector builder probed the
  static layer on nine real projects for crashes, not for agreement with labels.
- **Process cleanup.** A hard kill of frontend-check or critique during `--start` can still leave the server tree
  running (no Job object).
- **SL-X01** does not see numbers embedded in longer strings in the static layer; it relies on the runtime layer.
- **SL-T01 sponsor exemption** works only for byte-identical official files or a waiver; Hedera has no allowlist
  entry.
- **Capture P11.** The docs keep two shots per page by passing `--slices 1`; capture.mjs still defaults to three
  slices per viewport.
- **recording.g16** is skipped for a pptx or key embed until `--deck` is given, so `--phase build` cannot exit 0 for
  such a profile before the deck exists (CHANGELOG v1.1, still open).
- The `.frontend/` line earlier test runs appended to `~/.claude/.git/info/exclude` is still there. Harmless; remove
  it by hand if wanted.
- Full suite takes about 160 s; the browser tests dominate.

## 6. Owed before the skill is handed to /execution

Found by spot-check on this run; none blocks the suite.

1. **CONTRACTS.md lacks the detectors area's seven notes**: no mention of `shippedSources`, `NOT_SHIPPED`,
   `mountedFiles`/`mountedByEntry`, `score.collapsed`, `<design>/glossary.json`, motion passes' `unsettled`, the
   `--registry` fallback, or SL-T13/T14 now throwing when the budget cuts them short (which changes the s5 v1.1 note).
2. **CONTRACTS.md 6.3 still says H1 `pick: "A"-"C"`**; the schema and board.mjs accept `none` with a reason.
3. **registry.json text** is stale for SL-G02 (v0 scaffolds), SL-T05 (FD14-F23 b and c), SL-T17 (glossary.json),
   SL-X01 (mapped arrays).
4. **SKILL.md has 9 em dashes** (lines 7, 127 to 134) and still needs its review against the final code (HANDOFF
   step 2).
5. **CHANGELOG** has no entry for the detectors-area changes /execution can see (score.collapsed, `--report`
   findings shape, glossary.json).
6. **research/internal-negative-corpus.md**: reconcile the FD14-F03 T5 and T6 cells with the registry exclusions.

## 7. What calibration must still settle

From ARCHITECTURE 5.2, `calibration/labelling-plan.md` and the review:

- **Tiers for all 51 rules**, from detectors firing on positives and staying silent on controls; a tier-1 rule must
  stay silent on the pre-2023 controls. Set with `calibrate.mjs --apply` only after the owner's labels.
- **The corpus has to exist first**: 8 synthetic pages to generate (the two TOKEN2049 ones held until
  2026-10-08T11:00Z, now past), 4 positives to build (Hedera, two SuiShield entries, TOKENA), 2 controls without a
  verified snapshot (primer.style/css, demo.ghost.io). Nothing is rendered yet.
- **The owner's labelling session** (about 15 minutes, three screens per site, owner's own projects and synthetic
  pages only): per screen, vibecoded or not and which tells.
- **tells.score**: `score_max` is null; it needs a calibrated threshold before it can fail.
- **Whether uncalibrated tells gates stay advisory or become `skipped`**, a cross-skill contract change with
  /execution.
- **Thresholds the detector builder chose by hand** and that calibration must confirm: SL-T16's 2.0 dashes per
  1,000 words (agentfi 3.24, BNB 7.47 and inflexion 15.86 now all fire), SL-T17's stock-hit floor and the restored
  stock words, SL-T05(b)'s two-card and 0.06-chroma limits, SL-T11's generator-primary list, the score fold.
- **The firstview.complexity band** (provisional 38.1 to 119.7 KiB) and the H1 and sentence-length ranges.
- **Policy conflicts in the manual matrix** (T5 callouts, T6 frosted nav), or the agreement figures will show
  false misses and false alarms that are really policy.
- **Owner tell defaults** from HANDOFF section 6: Inter as ban or "needs a reason", serif italic outside display,
  one-shot explanatory reveals, the sponsor's own purple, what "inconsistent spacing" means, and which past frontends
  count as vibecoded.
- **Sponsor exemptions**: a Hedera allowlist entry (research plus a network fetch) or a waiver convention.

After calibration, HANDOFF still lists the rehearsal on the shared Queue Clock fixture, the A/B evaluation
(`evals/ab-2026-10.md`), `install-agents.mjs`, and a commit to the `~/.claude` repo with the owner's approval.
