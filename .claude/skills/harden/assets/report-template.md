<!--
harden report template. Render .harden/report.md from it (references/reporting.md, steps 5 and 12).
Contents (H2 sections, in this order; references/reporting.md RP-07):
  Summary · Scope, baseline and method · Applied, review before merge · Needs your decision · Applied ·
  Not fixed or deferred ·
  Informational and nits · Open owner items · Autonomous decisions · Reverted by end-to-end verification ·
  Before/after · Limits · Residual risk · Appendix
- Replace every {{placeholder}}. Values come from .harden/findings.json, active, config.json, profile.json,
  approvals.md, progress.md, verify.json, hook_events.log, inventory.json, rank.json, gates/*.json and tools/.
  Never fill one from memory; write "not measured" instead.
- Delete every HTML comment and every example row you did not use. Never delete a section:
  an empty group says "None." and an empty Limits item says "None.".
- Order inside each group by the RP-06 key: blocking first, then severity (critical > high > medium > low),
  then confidence rung (failing_test > reproduction > tool_high_precision > needs_review > inference),
  then location (consequence band first; location_class hotspot > warm and unknown together > cold,
  since PZ-13 treats unknown as warm; rank.json rank),
  then dimension (design, functionality and concurrency, complexity, tests, naming, comments, style).
  No numeric score is introduced to rank items; ties follow the RP-06 key.
- Evidence tag per finding: [executed] for failing_test/reproduction, [tool] for tool_high_precision,
  [LLM-judgment] for needs_review/inference. Comments, commented-out code and unused imports confirmed
  through detection DT-27's deterministic path (quoted text plus an AST-identical or compiler-clean check)
  are tool_high_precision, so they carry [tool], never [LLM-judgment] (reporting.md RP-03).
- Nits: at most {{nit_cap}} in "Informational and nits"; every further reported nit goes to Appendix D,
  never only into a count (reporting.md RP-06). A nit whose fix was applied is listed under Applied.
- Scores, grades and ratings are not allowed anywhere. Every % carries its n/N.
- Phase 5 (report first): "Applied" lists the planned T0 batches and has no commits yet.
  Phase 8 (final): "Applied" lists the commits with their gate results.
- A finding whose commits landed while its headline reproduction (a repro evidence item) or another
  consequence still reproduces at HEAD has status partial, never applied: its one entry goes under
  "Not fixed or deferred", its commits stay in the Applied table marked "(partial)", and it heads
  Open owner items (reporting.md RP-07, RP-16; eval-v2-calibration E02-F02).
- A finding whose commit the end-to-end verifier reverted (.harden/verify.json, protocol-change.md PC-26) has
  status reverted: its one entry goes under "Not fixed or deferred", its commit stays in the Applied table
  marked "(reverted)", and the revert is a row of "Reverted by end-to-end verification" (reporting.md RP-16, RP-17).
-->
# Hardening report: {{project_name}}

Commit range `{{base_sha}}..{{head_sha}}` on branch `{{branch}}` · run {{generated_utc}} ({{runtime}}) · mode {{mode}} · phase {{phase}}
Tools: {{tool_versions_inline}} · config hashes: see Scope, baseline and method

<!-- Summary: the first section; with the title and header it fits on one screen. At most 8 lines, no scores
     (reporting.md RP-08; eval-v2-calibration E02-F08). The four labelled lines state the mode and the end-to-end
     verdict, and answer what changed, what needs your decision and what was not checked; the sections below
     carry the detail.
     If no finding has blocking=true, the posture sentence starts with "No blocking issues."
     Mode (user-policy-autonomy U01-F02): "autonomous (profile .harden/profile.json)", "interactive" or
     "report-only"; when an autonomous run fell back to report-only, add the reason (no valid profile, live side
     effects unconfirmed, red baseline, failed canary check). End-to-end verdict, from .harden/verify.json
     (protocol-change.md PC-26): "end-to-end verified at <sha>", "end-to-end verified after reverting <n>
     commits", "end-to-end inconclusive: <checks> not judged (red at base or flaky)", "end-to-end red: applied
     range reverted (<cause>)", "end-to-end not run: <verifier message>", "not run (report-only)", followed by
     ", gates only" when the profile lists no e2e check; Phase 5, "not run yet".
     What changed: Phase 8, "<n> commits applying <m> findings; <p> partial, not counted as fixed (see Open owner
     items); <r> reverted by end-to-end verification (see that section)"; Phase 5, the T0 batches planned for
     auto-apply and, in autonomous mode, the T1 categories the profile accepted; report-only mode, "no code
     changed (report-only)". Valid deltas only (RP-12).
     What needs your decision: the commits under Applied, review before merge (count, breaking ones named first),
     then open items = Needs your decision plus Open owner items; top 3 in the RP-06 order.
     What was not checked: tools that did not run; lenses, languages or files not covered; modules
     "not examined" in Residual risk. -->
<!-- e2e_reach_summary: "; " and the headline of .harden/tools/e2e-reach.json ("e2e executed <n> of <m> changed
     modules, <f> of <F> changed functions": a module counts only when every changed function in it ran), or
     "; e2e reach not computed (<reason>)" when e2e_reach.py did not run; empty in report-only runs and before
     Phase 8. -->
## Summary

{{posture_sentence}}
Counts (critical/high/medium/low/nit): review before merge {{counts_review}} · needs your decision {{counts_needs_decision}} · applied {{counts_applied}} · not fixed or deferred {{counts_not_fixed}} · nits in main list {{nits_listed}} of {{nits_total}} (rest in Appendix D)
Mode: {{mode_line}} · end-to-end: {{e2e_verdict}}{{e2e_reach_summary}}
What changed: {{what_changed}} · valid deltas: {{valid_deltas_one_line}}
What needs your decision: {{review_count}} commits to review before merge ({{breaking_count}} breaking); {{open_items_count}} open items; top 3: 1) {{decision_1}} 2) {{decision_2}} 3) {{decision_3}}
What was not checked: {{biggest_limits}} (see Limits)
Pattern: {{systemic_or_isolated}}

## Scope, baseline and method

### Scope
- Repository: {{repo_path}} · branch `{{branch}}` · base SHA `{{base_sha}}` · head SHA `{{head_sha}}`
- Scope: {{scope_paths}} · excluded paths: {{exclude_globs}} · generated/vendored skipped: {{generated_summary}}
- Languages (files, LOC): {{languages_summary}}
- Lenses run: {{lenses_run}} · lenses not run: listed under Limits (d)
- Models, as the transcripts show them (`ledger.py models`, .harden/tools/models.json): orchestrator {{model_id}} / {{effort}} · lens passes {{lens_models}} · verifiers {{verifier_models}} · agents: {{agents_status}} · passes per unit: {{passes_per_unit}} (DT-23: 3 per trust-boundary or hotspot unit, 5 when the lens model is cheaper than the orchestrator's, 1 elsewhere)
<!-- agents_status: "harden agents (probe passed)" or "fallback: <fallback agent> (<reason>)" from .harden/agents.json. The segments are checked role by role by `ledger.py models --check-report` (pilot-auto-calibration A01-F41). -->

### Baseline gates
<!-- From .harden/gates/baseline.json (gates.py --label baseline --repeat N). A red gate forces report-only for the whole run (PF-11); an unstable test is a PF-12 candidate and edits to the code it covers wait. A formatting or lint gate red at the probe is not in baseline.json: it runs as a ratchet from .harden/ratchet.json; list it here with verdict "ratchet (red at base)" and report its existing drift (PF-11; eval-v1-calibration E01-F02). A formatter's drift is offered as its own style commit (T0 for touched files, T1 with approval for the whole repository, PC-11). -->
| Gate | Command | Exit codes over {{baseline_repeats}} runs | Duration | Verdict |
|---|---|---|---|---|
| {{gate_name}} | `{{gate_cmd}}` | {{gate_exit_codes}} | {{gate_duration}} | {{gate_verdict}} |

### Tools
<!-- One row per tool whose output is cited as evidence. Versions must match findings.json tool_versions. -->
| Tool | Pinned version | Command | Exit code | Config file (sha256) | Raw output |
|---|---|---|---|---|---|
| {{tool_name}} | {{tool_version}} | `{{tool_cmd}}` | {{tool_exit}} | `{{config_path}}` ({{config_sha256}}) | `.harden/tools/{{tool_output}}` |

### Method and thresholds
<!-- Method-and-limits block and threshold-policy block (references/prioritization.md PZ-17, PZ-23). Keep it short. -->
- History verdict: {{history_verdict}} · window {{history_window}} · half-life {{half_life}} · fallback rungs used: {{fallback_rungs}}
- Ranking blind spots: {{ranking_blind_spots}}

| Threshold | Value | Tool and version | Variant | Source | Provenance |
|---|---|---|---|---|---|
| {{metric}} | {{threshold}} | {{metric_tool}} | {{metric_variant}} | {{threshold_source}} | {{threshold_provenance}} |

## Applied, review before merge

<!-- One row per commit of a finding that carries a review object (reporting.md RP-07; user-policy-autonomy U01-F06
     to U01-F13), in this order of kinds: breaking-api (subject with "!", BREAKING CHANGE footer), additive-api,
     contract-source, money-path, owner-judgement (T2 applied by the autonomous run), behavioural,
     whole-repo-format last; within a kind, the RP-06 order. Nothing here is merged or pushed: the branch waits for
     the owner, and each row's undo is one git revert. Option: direct (no choice), lossless-variant, record-only or
     documented-default (prioritization.md, Owner-judgement lane step 3); Alternatives: the behaviours the owner can
     still choose, also listed under Open owner items. Phase 5: the items the profile will apply that need this
     review, with no commit column filled. Report-only mode, or nothing applied: "None." -->
| # | Commit | Subject | Finding | Review kinds | Behaviour change (old -> new) | Option; alternatives | Demonstrating test or proof | Undo |
|---|---|---|---|---|---|---|---|---|
| {{review_n}} | `{{review_sha}}` | {{review_subject}} | {{review_id}} | {{review_kinds}} | {{review_behaviour_change}} | {{review_option}}; {{review_alternatives}} | `{{review_test}}` | `git revert {{review_sha}}` |

Contract sources changed on this branch: {{contracts_changed}}. Each fix takes effect only when the owner redeploys the contract; this run deployed nothing, and a deployed instance no longer matches this source, because any source change, a comment or whitespace included, changes the metadata hash in the bytecode. None changed: "None."

## Needs your decision

<!-- Blocking items first. Three kinds of decision: approve a T1 batch, judge a T2 item, answer a question. -->

### Awaiting your approval (T1 batches)
<!-- One row per category batch. Approval is per batch and is recorded in .harden/approvals.md. In autonomous
     mode, list here the T1 items the profile did not let the run apply (switch false, or an exclusion of
     user-policy-autonomy U01-F03); their reasons are under "Autonomous decisions", and an --interactive run
     can approve them. -->
| Batch | Findings | Severity (c/h/m/l/nit) | Highest fix risk | Class | Example | Your decision |
|---|---|---|---|---|---|---|
| {{batch_name}} | {{batch_ids}} | {{batch_severity_counts}} | {{batch_fix_risk}} | {{batch_class}} | {{batch_example_id}} | approve / reject / later |

**{{id}}** · {{severity}} · {{title}}
- **Where:** `{{file}}:{{line}}` · lens {{lens}} · location {{location_class}}
- **Severity:** {{severity}}, criterion: "{{severity_criterion}}" · conditions: {{conditions}} · blocking: {{blocking}} (unblocks when: {{unblock_condition}})
- **Confidence:** {{confidence}} {{evidence_tag}} · verifier: {{verifier_note}}
- **Evidence:** {{evidence_kind}} `{{evidence_ref}}`: {{evidence_detail}}
- **Rule:** {{rule_ref}} {{rule_title}} · source: {{rule_source}} · CWE: {{cwe}} ({{quality_characteristic}})
- **Proposed change:** {{proposed_change}} · tier {{tier}} · class {{class}} · fix risk {{fix_risk}}

### Report-only (T2: owner judgement)
<!-- "Proposed first step" is optional: only a warn-first mitigation (a warning log line or counter before any
     enforcement, PC-14; for a T2 fail-open flip, the staged path: a warning that names the change to come, then
     enforcement in a later release) or a safer default (for example no credential fallback) that the owner can apply.
     This pass never applies it, and no T1 category approval covers it (invariant 8; reporting.md RP-07;
     eval-v2-calibration E02-F03). Delete the line when there is none. In autonomous mode with
     auto_apply.owner_judgement true, only the T2 items the Owner-judgement lane kept report-only are listed here,
     each with its reason letter 1(a) to 1(j) in "Why report-only" (prioritization.md, Autonomous mode); the lane's
     applied items are under Applied, review before merge. -->
**{{id}}** · {{severity}} · {{title}}
- **Where:** `{{file}}:{{line}}` · lens {{lens}} · location {{location_class}}
- **Severity:** {{severity}}, criterion: "{{severity_criterion}}" · conditions: {{conditions}}
- **Confidence:** {{confidence}} {{evidence_tag}} · verifier: {{verifier_note}}
- **Evidence:** {{evidence_kind}} `{{evidence_ref}}`: {{evidence_detail}}
- **Rule:** {{rule_ref}} {{rule_title}} · source: {{rule_source}} · CWE: {{cwe}}
- **Why report-only:** {{t2_reason}} · **Owner action:** {{owner_action}}
- **Proposed first step (for the owner; not applied by this pass):** {{proposed_first_step}}

### Questions (suspected, not proven)
<!-- Critical, high or blocking suspicions without a proof rung: status deferred, confidence needs_review, "unproven" in notes (reporting.md RP-04). -->
**{{id}}** · {{severity}} (unproven) · {{title}}
- **Where:** `{{file}}:{{line}}` · **Evidence so far:** {{evidence_kind}} `{{evidence_ref}}`: {{evidence_detail}}
- **What would confirm or refute it:** {{proof_needed}} · **Question for you:** {{question}}

## Applied

<!-- Phase 5: list the T0 batches planned for auto-apply and, in autonomous mode, the T1 categories the profile
     accepted, with no commit column filled. Phase 8: one row per commit.
     "Applied" means a commit changed the flagged location (or states the causal link), every gate passed after it,
     the end-to-end verifier did not revert it, and any headline reproduction of the finding, re-run at HEAD, no
     longer shows the defect. A commit of a partial finding stays in the table with its id marked "(partial)", and
     a commit the end-to-end verifier reverted with its id marked "(reverted)"; that finding's entry is under
     "Not fixed or deferred" (reporting.md RP-16). The commit table lists every commit of the branch and marks
     "(review)" the commits whose findings are under "Applied, review before merge"; the finding entries below
     cover only findings without a review object. -->
| # | Commit | Subject | Finding ids | Kind | Gates after commit (name: exit) | diff_guard |
|---|---|---|---|---|---|---|
| {{n}} | `{{commit_sha}}` | {{commit_subject}} | {{commit_finding_ids}} | {{structural_behavioural_or_test_only}} | {{gate_results}} | exit {{diff_guard_exit}} |

**{{id}}** · {{severity}} · {{title}}
- **Where:** `{{file}}:{{line}}` · lens {{lens}} · tier {{tier}} · class {{class}}
- **Severity:** {{severity}}, criterion: "{{severity_criterion}}"
- **Confidence:** {{confidence}} {{evidence_tag}} · verifier: {{verifier_note}}
- **Evidence:** {{evidence_kind}} `{{evidence_ref}}`: {{evidence_detail}}
- **Rule:** {{rule_ref}} {{rule_title}} · source: {{rule_source}} · CWE: {{cwe}}
- **Change:** commit `{{commit}}` · verified by `{{verification_command}}` exit {{verification_exit}} · undo: `git revert {{commit}}`

Diff stat: `git diff --stat {{base_sha}}..{{head_sha}}`: {{diff_shortstat}}

### Final gates
<!-- Phase 8 only (reporting.md step 8); Phase 5 writes "not run yet". One row per run, each with its exact command and exit code(s).
     The end-to-end row reports .harden/verify.json when its head_at_end equals HEAD (protocol-change.md PC-26):
     gates and e2e checks run from fresh clones of the base and the branch, reverts made, final_status. When the
     verifier exited 2 and protocol-change step 13 ran the PF-10 fallback (label final-fresh), report that run in
     this row instead, and say so under Limits (j). -->
| Run | Command | Exit code(s) | Verdict |
|---|---|---|---|
| final (working tree, {{final_repeats}} runs) | `{{final_gates_cmd}}` | {{final_exit_codes}} | {{final_verdict}} |
| end-to-end (verify_branch.py, fresh clone of `{{branch}}`; {{e2e_checks_count}} e2e checks, {{e2e_compare_count}} compared with base) | `{{verify_cmd}}` | {{verify_exit}} | {{e2e_verdict}} |
| diff guard over `{{base_sha}}..{{head_sha}}` | `{{diff_guard_cmd}}` | {{diff_guard_final_exit}} | {{diff_guard_verdict}} |

## Not fixed or deferred

<!-- blocked (retry cap reached), reverted (name the failed gate or end-to-end check; when the end-to-end
     verifier reverted it, also the revert commit and its reason from .harden/verify.json), deferred (with
     reason), partial (name the consequence or headline reproduction still open, the re-run command and its exit
     code, and the commits that landed; reporting.md RP-16, RP-17). Each needs its reason. -->
| Id | Severity | Status | Reason | Evidence of the attempt |
|---|---|---|---|---|
| {{id}} | {{severity}} | {{status}} | {{reason}} | {{attempt_evidence}} |

## Informational and nits

<!-- At most {{nit_cap}} nits listed here, in RP-06 order; every further reported nit is listed in Appendix D
     (never only counted) and all stay in report.sarif. Nits never block. A nit whose fix was applied is listed
     under Applied instead (reporting.md RP-06). -->
Listed {{nits_listed}} of {{nits_total}} nits here; the other {{nits_overflow}} are listed in Appendix D (all are also in `.harden/report.sarif`).

| Id | Where | Rule | Note |
|---|---|---|---|
| {{id}} | `{{file}}:{{line}}` | {{rule_ref}} | {{title}} |

Reviewed with no issues: {{modules_without_findings}}

## Open owner items

<!-- What the owner still sets or decides once this pass ends (reporting.md RP-07). One line per item, ending with
     its finding id(s). These lines are references, not findings: each id keeps its one entry in a decision group
     above. Partial findings come first (reporting.md RP-16; eval-v2-calibration E02-F02). Other kinds:
     owner-tunable values (a timeout default without latency data, ER-21, CC-20; a tolerance, NM-16),
     fallbacks a surfacing fix kept for an input the caller did not name, kind 2 fixes applied with external consumers
     (release decision; prioritization, Fail-open findings), newly rejected input classes (PC-24), and other
     owner decisions a finding leaves open. Empty: write "None.". -->
| Kind | Value or decision | Where to change it | Finding ids |
|---|---|---|---|
| partial finding | {{partial_open_consequence}} still open (re-run `{{partial_repro_cmd}}`: exit {{partial_repro_exit}}) | `{{partial_where}}` | {{partial_ids}} |
| owner-tunable value | {{owner_value}} (current: {{owner_value_current}}) | `{{owner_value_location}}` | {{owner_value_ids}} |
| kept implicit-input fallback | {{fallback_item}} (surfacing fix: {{fallback_commit}}) | {{fallback_decision}} | {{fallback_ids}} |
| release decision (kind 2 fix, external consumers) | {{release_change}} (old -> new) | {{release_decision}} | {{release_ids}} |
| newly rejected input class | {{rejected_class}} | {{rejected_class_where}} | {{rejected_class_ids}} |
| other owner decision | {{owner_decision}} | {{owner_decision_where}} | {{owner_decision_ids}} |

## Autonomous decisions

<!-- What the run decided without asking (reporting.md RP-07; user-policy-autonomy U01-F01, U01-F03, U01-F04).
     Sources: .harden/profile.json, the "auto (profile)" rows of .harden/approvals.md, the "default:" lines of
     .harden/progress.md, and the lines of .harden/hook_events.log whose reason_code is "profile-forbidden".
     These lines are references, not findings: each finding id keeps its one entry in a decision group above.
     Interactive mode: replace the whole section body with "None: mode interactive; category decisions are the
     user's answers in .harden/approvals.md." Report-only: "None: mode report-only (<reason>); nothing was
     applied." Keep the subsections below in autonomous mode; an empty one says "None.". -->
Profile: `{{profile_path}}` (sha256 {{profile_sha256}}) · `validate_profile.py` exit {{profile_validate_exit}} · situation: {{profile_situation}} · network: {{profile_network}} · live side effects: {{profile_live_side_effects}} · auto_apply: {{profile_auto_apply}} · money paths: {{profile_money_paths}} · forbidden command patterns: {{profile_forbidden_count}} · budget: {{profile_budget}}

Profile origin: {{profile_origin}} (owner; or self-setup: inferred by `infer_profile.py` at base {{profile_origin_base}}, approved by the owner's `/harden` invocation, user-policy-autonomy U01-F05)

### How the profile was made
<!-- Autonomous mode with an inferred profile (origin "inferred"): one row per field of .harden/profile.json from its
     "provenance" key: gates and e2e checks one row each; forbidden_commands one row per pattern, or one row with the
     count and a pointer to .harden/profile-inference.json when there are more than 20. Then one row per candidate
     of .harden/profile-inference.json whose verdict is forbidden or excluded, with its reason and evidence
     (protocol-preflight PF-23). The money_path_hints of profile-inference.json feed the Money-path classification
     table below; an inferred profile sets no money_paths_globs. With an owner profile: "Owner profile; self-setup
     added <n> bans (forbidden_commands_inferred in .harden/active) and would not have cleared: <gates or none>." -->
| Field | Value | Source (file:line, rule, probe or review) |
|---|---|---|
| {{prov_field}} | `{{prov_value}}` | {{prov_source}} |

| Candidate not run | Verdict | Reason | Evidence |
|---|---|---|---|
| `{{cand_cmd}}` | {{cand_verdict}} | {{cand_reason}} | {{cand_evidence}} |

### Approved by the profile
| Category or finding | Switch | Count | Finding ids |
|---|---|---|---|
| {{auto_category}} | `auto_apply.{{auto_switch}}=true` | {{auto_count}} | {{auto_ids}} |

### Kept report-only in autonomous mode
<!-- One row per T0 or T1 item (or whole category) the run did not apply in autonomous mode: its switch is false;
     a behavioural item that failed a PC-14 offline-verification condition (name the condition); a dead-code item
     needing a test deletion, or a removal or modification of an existing test line (U01-F03, U01-F07; checked
     additions are applied); a live-effect
     path (U01-F12); no switch covers it (suppression line, placeholder deletion, newly rejected input class, and
     without auto_apply.owner_judgement a whole-repository format run or an additive public API change).
     T2 items keep their entries under "Applied, review before merge" or "Report-only (T2)" above and get only
     the count line below. -->
| Finding id or category | Tier · class | Reason | What would let a later run apply it |
|---|---|---|---|
| {{kept_id}} | {{kept_tier_class}} | {{kept_reason}} | {{kept_unblock}} |

T2 items: {{t2_applied_count}} applied by the Owner-judgement lane (listed under Applied, review before merge) · {{t2_report_only_count}} report-only (listed under Needs your decision), by lane reason 1(a) to 1(j): {{t2_reason_counts}} · with `--interactive` or `auto_apply.owner_judgement` false, every T2 item is report-only

### Money-path classification
<!-- How the run decided which items are on a money, order, key, signing or transaction path
     (prioritization.md Autonomous mode; pilot-auto-calibration A01-F06 to A01-F08): by the profile's
     money_paths_globs, or by judgement when the profile does not set them or one of their patterns matches no
     file of the base commit (say which). One row per item where the globs and a judgement disagree: a lens or
     verifier judged it money-like in a file no pattern matches, or the floor (code that signs, sends orders or
     transactions, or handles keys) kept it on a money path although no pattern matches. Sources: the
     "money-path:" entries of the findings' notes. With judgement, or no disagreement, the table says "None.". -->
Money paths decided by: {{money_paths_source}}

| Finding id | File | Globs | Judgement | Outcome |
|---|---|---|---|---|
| {{money_id}} | `{{money_file}}` | {{money_globs_verdict}} | {{money_judgement}} | {{money_outcome}} |

### Questions answered by a conservative default
| Question | Default taken | Rule | Logged in `.harden/progress.md` at |
|---|---|---|---|
| {{default_question}} | {{default_taken}} | {{default_rule}} | {{default_logged_utc}} |

### Commands the profile forbade
<!-- Commands the PreToolUse hook refused because a forbidden_commands pattern of the profile matched them
     (reason_code "profile-forbidden" in .harden/hook_events.log; the log keeps the command redacted and cut at
     200 characters). -->
| UTC time | Tool | Command (redacted) |
|---|---|---|
| {{forbidden_ts}} | {{forbidden_tool}} | `{{forbidden_cmd}}` |

## Reverted by end-to-end verification

<!-- From the "reverts" of .harden/verify.json (sha, subject, revert_sha, kind, check, reason; protocol-change.md
     PC-26; user-policy-autonomy U01-F02), in the order the verifier made them. kind: bisect (the first bad
     commit), candidate (one of several a bisect with skipped commits left), range (a range revert: at the cap,
     after a first bad commit that is itself a revert or a merge, or when bisect named none; one row per commit).
     Check each revert_sha against git log --oneline {{base_sha}}..HEAD. Each finding listed is reverted (or
     partial when it keeps another commit, reporting.md RP-16) and keeps its one entry under "Not fixed or
     deferred". No revert: "None." followed by the verifier line. Report-only: "Not run (report-only)."
     Phase 5: "Not run yet." -->
| # | Reverted commit | Subject | Revert commit | Kind | Failing check | Reason (output tail) | Finding ids |
|---|---|---|---|---|---|---|---|
| {{rev_n}} | `{{rev_sha}}` | {{rev_subject}} | `{{rev_revert_sha}}` | {{rev_kind}} | {{rev_check}} | {{rev_reason}} | {{rev_ids}} |

Verifier: `{{verify_cmd}}` exit {{verify_exit}} · final_status {{verify_final_status}} (green, inconclusive, red, revert-conflict, range-reverted or error) · head_at_end `{{verify_head_at_end}}` · reverts: {{verify_revert_count}} (cap {{verify_cap}}) · unjudged checks: {{verify_unjudged}} · tree equals base: {{verify_tree_equals_base}} · clones: {{verify_clones}} · undo a revert: `git revert <revert commit>`

## Before/after

<!-- Only count-based rows, each with raw n/N for both runs and a validity note (reporting.md RP-12).
     Phase 5 fills the "before" column only.
     Suppression row: PC-08's pattern plus biome-ignore and NOSONAR, run at the base and at HEAD
     (kept out of the table because its "|" would split the cells):
     git grep -cE '@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|biome-ignore|# *type: *ignore|# *noqa|# *pyright: *ignore|pragma: no cover|#[[]allow[(]|@SuppressWarnings|//[[:space:]]*nolint|NOLINT|# *nosec|NOSONAR|: any[^A-Za-z]|as any[^A-Za-z]|as unknown as' <rev> | awk -F: '{s+=$NF} END{print s+0}' -->
| Measure | Before | After | Validity note |
|---|---|---|---|
| Verified defects fixed (test fails at base, passes at head) | {{defects_before}} | {{defects_after}} | {{defects_note}} |
| Vulnerabilities closed (same pinned scanner reports them absent, plus a test or trace) | {{vulns_before}} | {{vulns_after}} | {{vulns_note}} |
| Dependencies (lockfile diff) | {{deps_before}} | {{deps_after}} | {{deps_note}} |
| Suppression markers and escape-hatch types (`git grep -cE`, PC-08 pattern plus biome-ignore and NOSONAR, reporting.md RP-12), read with the config diff | {{supp_before}} | {{supp_after}} | {{supp_note}} |
| Mutants killed on touched lines (killed/total) | not applicable | {{mutants_after}} | {{mutants_note}} |
| Tests added, each tied to a finding id | 0 | {{tests_added}} | {{tests_note}} |
| Lines deleted (raw activity count, not a quality claim) | not applicable | {{lines_deleted}} | {{lines_note}} |

### Tool warnings by fingerprint
<!-- From sarif_delta.py per tool. Exit 0 = valid; exit 1 = not valid as evidence, give the reason. Never a count difference. -->
| Tool | Version before / after | Config identical | New | Absent | Unchanged (moved) | Newly suppressed | Valid |
|---|---|---|---|---|---|---|---|
| {{tool_name}} | {{version_before}} / {{version_after}} | {{config_identical}} | {{new}} | {{absent}} | {{unchanged}} ({{moved}}) | {{newly_suppressed}} | {{valid_or_reason}} |

Not valid as improvement evidence, so not reported as deltas: Maintainability Index, density and ratio metrics (debt ratio, duplicated-lines density, weaknesses per KLOC), smell or violation totals, coverage percentage.

## Limits

- (a) Tools that failed or did not run: {{tools_failed_or_not_run}}
- (b) Languages and files no tool analysed: {{unanalysed_languages_files}}
- (c) Scope exclusions: {{scope_exclusions}}
- (d) Not considered (lenses or categories not run, with reason): {{not_considered}}
- (e) Unmapped file extensions (`unmapped_extensions` in inventory.json, with file counts; no language reference covered them): {{unmapped_extensions}}
- (f) Interim unchecked classes whose trigger is present (detection.md DT-34: streaming connection resilience, order lifecycle and exposure controls, mobile platform configuration, non-EVM contract code): {{interim_unchecked_classes}}
- (g) Undetermined severities or statuses, including unproven suspicions: {{undetermined_items}}
- (h) Blind spots of the tools and passes used: {{blind_spots}}
- (i) Mutation testing (tool results; or the PF-18 hand-seeded net check, killed/seeded; or "safety net unmeasured" with its reason): {{mutation_status}}
- (j) End-to-end coverage (the profile's e2e checks, which compare base and branch, the checks not judged, and per changed production file the e2e_reach.py status: executed (every changed function ran), partly executed (which functions ran), loaded but changed code not executed, loaded with execution not shown, no runtime change, imported only, not reached, or not shown; "gates only" when the profile lists none; "not run" with the verifier's message otherwise): {{e2e_coverage}}
- (k) Run budget (deadline and spend cap with their source, spend at the end, windows that closed, units and lenses not examined for budget, candidates left unverified, verification cycles, reproduction attempts and findings left unattempted, approved items deferred, most subagents at once against the cap): {{budget_limits}}

Absence of findings is not absence of defects: these findings are not a comprehensive list of the defects in this code.

Limits of independence: this review was produced by an LLM-based agent ({{model_id}}) whose detection passes ran on {{lens_models}}; verification used {{verifier_models}} (same provider as the author model: {{same_provider}}). It is not independent verification in the NASA IV&V sense, and the verifier may share training data and failure modes with the models that wrote the code. Removed from the verifier's context: {{stripped_context}}. Findings tagged [executed] rest on reproducible test or command output, [tool] on re-run tool output; findings tagged [LLM-judgment] and every "no issue found" statement are unverified opinions. LLM reviewers are measured to be weakest on {{blind_spot_classes}}.

## Residual risk

<!-- One table per module that holds a top-ranked file in .harden/rank.json. Every "not examined" row also appears under Limits. -->
| Module | Design | Trust boundaries and authorisation | Concurrency | Data integrity | Error handling | Tests |
|---|---|---|---|---|---|---|
| {{module}} | {{design_state}} | {{trust_state}} | {{concurrency_state}} | {{data_state}} | {{errors_state}} | {{tests_state}} |

<!-- Cell values, rendered from .harden/tools/residual.json and checked by residual_check.py (RP-10): "checked (<tool>[, <tool>]): no issue" (the lens read it and the named detector or metric ran on it; "checked (complexity.py heuristic): no issue" when only the offline heuristic metric ran), "findings: <ids>", "read, not measured (<tool> did not run)" or "not examined". -->
Open risk you still carry: {{open_risk_items}}
Actions only a human can take (for example rotating a leaked secret): {{human_actions}}

## Appendix

### A. Rejected candidates by lens
<!-- Every candidate the verifier rejected, with its reason (verifier_note). -->
| Lens | Candidate | Where | Reason |
|---|---|---|---|
| {{lens}} | {{candidate_id}} | `{{file}}:{{line}}` | {{rejection_reason}} |

### B. Tool alerts reconciliation
<!-- Raw alerts must equal reported plus dismissed-with-reason; re-check a sample of dismissals (at least 10% and at least 5). -->
| Tool | Raw alerts | Reported | Dismissed with reason | Dismissals re-checked | Re-check result |
|---|---|---|---|---|---|
| {{tool_name}} | {{raw_alerts}} | {{reported_alerts}} | {{dismissed_alerts}} | {{rechecked}} | {{recheck_result}} |

### C. Per-rule precision
| Rule or category | Hits | Sampled | True positives in sample | Decision |
|---|---|---|---|---|
| {{rule_or_category}} | {{hits}} | {{sampled}} | {{true_positives}} | {{precision_decision}} |

### D. Nit overflow (nits past the main-list cap)
<!-- Every reported nit beyond the {{nit_cap}} listed in "Informational and nits", continuing the RP-06 order.
     Each id appears here once and in no other group (reporting.md RP-06, RP-07). Empty: write "None.". -->
| Id | Where | Rule | Note |
|---|---|---|---|
| {{overflow_id}} | `{{overflow_file}}:{{overflow_line}}` | {{overflow_rule_ref}} | {{overflow_title}} |

### E. Run files
- Findings: `.harden/findings.json` (validated: `{{validate_command}}` exit {{validate_exit}})
- SARIF companion: `.harden/report.sarif`
- Gates: `.harden/gates/` · raw tool outputs: `.harden/tools/` · approvals: `.harden/approvals.md`
- Run profile: `.harden/profile.json` · end-to-end verification: `.harden/verify.json` · hook events: `.harden/hook_events.log`
