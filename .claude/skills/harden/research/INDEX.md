# Research provenance for /harden

Every rule in `references/` cites one of these dossiers (`dossier: <slug> <finding id>`) and the external source it rests on.
The dossiers are the evidence base; the reference files are the compressed, actionable form.

## How this evidence was produced (2026-09-23)

1. **Research wave.** One researcher agent per topic, web-sourced (standards, official docs, peer-reviewed studies, industry reports, practitioner forums, postmortems). Rules: nothing cited from model memory; seed leads treated as unverified; triangulate standards + empirical data + practitioner feedback; grade evidence A-D.
2. **Adversarial verification.** A separate fact-checker per topic re-opened every source, checked quotes, numbers, attribution, versions and overclaiming, and marked each finding VERIFIED / CORRECTED / DOWNGRADED / DROPPED. Only surviving findings are in the dossiers.
3. **Completeness critic, two rounds.** Found missing topics, weak areas and cross-dossier contradictions; 19 gap topics were researched and verified the same way. Two orphaned topics from an interrupted run (X01, X02) were recovered and verified.
4. **Independent citation audit.** 150 load-bearing citations (3 per dossier, grade A/B, with numbers or quotes) were re-verified from scratch by auditors who took no part in steps 1-2: **129 confirmed, 19 minor issues (rounding, preprint version, dates), 2 misrepresented, 0 not found**. The 21 non-confirmed items are in `_audit-problems.json`; the reference writers were instructed not to use the 2 misrepresented claims as written. The corrections have since been folded into the owning dossier findings, so a `dossier:` pointer leads to corrected numbers and quotes: each affected finding's Verdict line ends with `(audit correction: ...)`. `_audit-problems.json` is kept unchanged as the audit record.

Totals across 52 dossiers: 489 verified, 546 corrected, 58 downgraded findings (0 dropped at verification because unsupported findings were replaced by real sources or removed within findings).

Known systemic limits: the web-search quota was exhausted during much of the wave, so many checks used direct fetches (arXiv, OpenAlex, Crossref, HN Algolia, publisher pages); several papers were verified from abstracts only; Reddit is under-represented; much empirical software-engineering evidence is Java/C and pre-2024 models. Each dossier lists its own weak spots.

## Dossiers

| Code | Slug | Topic | Verified | Corrected | Downgraded |
|---|---|---|---|---|---|
| T01 | [standards](standards.md) | Quality standards and formal models | 8 | 16 | 0 |
| T02 | [industry-review-guidelines](industry-review-guidelines.md) | Industry code review and code health guidelines | 9 | 9 | 2 |
| T03 | [complexity-metrics](complexity-metrics.md) | Complexity metrics: what the evidence says | 4 | 10 | 3 |
| T04 | [performance-review](performance-review.md) | Algorithmic and runtime performance in a hardening pass | 13 | 7 | 1 |
| T05 | [design-simplicity](design-simplicity.md) | Design complexity, abstraction and modularity (and the debates) | 9 | 6 | 2 |
| T06 | [dead-code-evidence](dead-code-evidence.md) | Dead code: evidence, definitions and safe removal | 8 | 12 | 2 |
| T07 | [dead-code-tools](dead-code-tools.md) | Dead code and unused-dependency detection tooling per language | 13 | 9 | 1 |
| T08 | [duplication](duplication.md) | Code duplication: evidence and when to deduplicate | 7 | 9 | 1 |
| T09 | [refactoring-safety](refactoring-safety.md) | Behaviour-preserving refactoring process and safety nets | 8 | 10 | 2 |
| T10 | [llm-refactoring](llm-refactoring.md) | LLM/agent-driven refactoring: empirical evidence and guardrails | 8 | 10 | 2 |
| T11 | [ai-code-quality-studies](ai-code-quality-studies.md) | Empirical studies of AI-generated code quality and security | 9 | 6 | 4 |
| T12 | [ai-code-smells-practitioners](ai-code-smells-practitioners.md) | Practitioner catalog of AI/LLM code smells | 6 | 14 | 1 |
| T13 | [test-quality](test-quality.md) | Test suite quality for a hardening pass | 14 | 5 | 0 |
| T14 | [error-handling](error-handling.md) | Error handling and reliability | 14 | 8 | 1 |
| T15 | [security-hardening](security-hardening.md) | Security hardening pass for any codebase | 10 | 13 | 0 |
| T16 | [dependency-hygiene](dependency-hygiene.md) | Dependency hygiene | 2 | 15 | 1 |
| T17 | [readability](readability.md) | Readability, naming and comments: empirical evidence | 3 | 18 | 1 |
| T18 | [types-static-analysis](types-static-analysis.md) | Type safety and static analysis rigour | 6 | 11 | 1 |
| T19 | [prioritization](prioritization.md) | Prioritising where to spend cleanup effort | 11 | 8 | 4 |
| T20 | [lang-typescript](lang-typescript.md) | TypeScript / JavaScript best practices from authoritative sources | 14 | 10 | 0 |
| T21 | [lang-python](lang-python.md) | Python best practices from authoritative sources | 9 | 15 | 1 |
| T22 | [lang-rust](lang-rust.md) | Rust best practices from authoritative sources | 11 | 13 | 0 |
| T23 | [lang-cpp](lang-cpp.md) | C++ best practices from authoritative sources | 9 | 14 | 0 |
| T24 | [lang-solidity-go](lang-solidity-go.md) | Solidity and Go best practices from authoritative sources | 9 | 15 | 1 |
| T25 | [polyglot-tooling](polyglot-tooling.md) | Language-agnostic tooling and discovering the right tools for any language | 4 | 13 | 2 |
| T26 | [architecture](architecture.md) | Architecture-level hardening: boundaries, cycles, coupling | 5 | 13 | 1 |
| T27 | [code-smells-evidence](code-smells-evidence.md) | Code smells: which ones actually matter (empirical) | 12 | 9 | 0 |
| T28 | [observability-config](observability-config.md) | Logging, observability, configuration and operational hygiene | 12 | 10 | 0 |
| T29 | [concurrency-async](concurrency-async.md) | Concurrency and async correctness | 14 | 11 | 0 |
| T30 | [cleanup-practice-forums](cleanup-practice-forums.md) | Real-world experience with cleanup and refactoring passes | 10 | 8 | 1 |
| T31 | [skill-design](skill-design.md) | Designing an effective Claude Code skill for this job, plus prior art | 11 | 10 | 0 |
| G101 | [finished-project-scope](finished-project-scope.md) | Scope of a one-shot hardening pass on a finished project: whole-codebase cleanup versus 'leave cold code alone' (contradiction resolution) | 8 | 11 | 0 |
| G102 | [dead-code-certainty](dead-code-certainty.md) | Deleting dead code on static evidence alone: detector precision, the no-telemetry case, and the test-edit policy for deletions | 10 | 10 | 1 |
| G103 | [numeric-money-time](numeric-money-time.md) | Numeric precision, money, token amounts and time correctness across TS, Python, Rust, C++ and Solidity | 11 | 10 | 0 |
| G104 | [hotspot-evidence](hotspot-evidence.md) | Independent evidence for churn × complexity hotspot ranking, and how to rank when history is thin, squashed or agent-generated | 9 | 10 | 2 |
| G105 | [agent-refactoring-engines](agent-refactoring-engines.md) | Which semantic refactoring engines an AI agent can actually drive headlessly, per language, on Windows and Git Bash | 7 | 10 | 1 |
| G106 | [docs-accuracy](docs-accuracy.md) | Documentation that matches behaviour: README and setup instructions, examples, docstrings, API docs and agent context files | 9 | 11 | 1 |
| G107 | [build-ci-infra](build-ci-infra.md) | Build, CI, container, shell-script and IaC hygiene for a finished project | 11 | 12 | 1 |
| G108 | [mutation-testing-practice](mutation-testing-practice.md) | Mutation testing as the safety-net gate of a one-shot pass: per-language tooling, cost control and survivor triage | 11 | 9 | 1 |
| G109 | [data-pipelines-notebooks](data-pipelines-notebooks.md) | Correctness of dataframe, data-pipeline and notebook code (pandas, polars, NumPy, Jupyter) | 11 | 11 | 0 |
| G110 | [frontend-react-hygiene](frontend-react-hygiene.md) | Frontend hygiene for React/Next.js (hooks and effects correctness, state and keys, client/server boundary, accessibility) | 9 | 14 | 0 |
| G201 | [reviewer-independence](reviewer-independence.md) | Can an AI agent be a genuine third-party reviewer? Self-preference, correlated blind spots, and how to make verification independent | 6 | 13 | 1 |
| G202 | [whole-repo-llm-audit](whole-repo-llm-audit.md) | Recall, run-to-run variance and partitioning when an LLM agent audits an entire repository | 13 | 5 | 1 |
| G203 | [assertions-defensive-checks](assertions-defensive-checks.md) | Assertions, invariants and defensive checks: when a hardening pass should add them, when it may remove them, and what a failed check should do | 12 | 4 | 2 |
| G204 | [final-report-and-impact](final-report-and-impact.md) | The deliverable: severity and confidence humans trust, and an honest before/after account of what the pass changed | 10 | 9 | 2 |
| G205 | [hardening-induced-regressions](hardening-induced-regressions.md) | When fixes and cleanups break production: bad-fix base rates, a hardening-induced incident corpus, and AI-agent destructive actions | 10 | 10 | 2 |
| G206 | [fuzz-property-hardening](fuzz-property-hardening.md) | Fuzzing and property-based testing as a behaviour-neutral hardening step on a finished project | 13 | 7 | 0 |
| G207 | [web3-audit-practice](web3-audit-practice.md) | Solidity and Web3 hardening beyond linters: manual audit checklist, invariant testing, severity rubrics and off-chain signer hygiene | 10 | 13 | 1 |
| G208 | [metric-thresholds](metric-thresholds.md) | Resolving the threshold contradiction: absolute limits vs benchmark-derived vs per-repository relative thresholds for complexity, length and parameters | 7 | 8 | 4 |
| G209 | [data-layer-hygiene](data-layer-hygiene.md) | Database schema, query and cross-layer constraint hygiene in a finished application | 12 | 10 | 0 |
| X01 | [behaviour-changing-fixes](behaviour-changing-fixes.md) | Policy and validation for hardening fixes that intentionally change behaviour | 7 | 11 | 1 |
| X02 | [autofix-trust](autofix-trust.md) | How far to trust tool autofixes: one apply / approve / report policy for mechanical changes | 11 | 11 | 2 |

X01 findings use the prefix G102 and X02 findings use G105; a finding id is unique only together with its dossier slug, so every pointer names the slug. (These prefixes are shared with dead-code-certainty and agent-refactoring-engines: `behaviour-changing-fixes G102-F03` and `dead-code-certainty G102-F03` are different findings.)
| E01 | [eval-v1-calibration](eval-v1-calibration.md) | Evaluation v1 calibration findings (own measurement, n=2 per cell) | 12 | - | - |
| E02 | [eval-v2-calibration](eval-v2-calibration.md) | Evaluation v2 calibration findings (own measurement, n=3 per cell) | 8 | - | - |
| U01 | [user-policy-autonomy](user-policy-autonomy.md) | Owner decisions: autonomous default mode, profile consent, end-to-end verifier (2026-09-24); self-setup profile, full scope on the branch, existing tests gain checked additions only, command classification, money-path proof (2026-09-25) | 14 | - | - |
| A01 | [pilot-auto-calibration](pilot-auto-calibration.md) | Autonomous pilot calibration findings (own measurement, three autonomous pilots, 2026-09-25; calibration round approved 2026-09-25) | 60 | - | - |
| E03 | [eval-v3-calibration](eval-v3-calibration.md) | Evaluation v3 calibration findings (own measurement, n=3 per cell) | 6 | - | - |

## Calibration dossiers (E01, E02, E03)

E01, E02 and E03 record the skill's own paired evaluations (evals/results-v1.md, results-v2.md, results-v3.md). They
calibrate how externally sourced rules are tiered and applied; they never replace the external evidence a rule
cites. Their counts column gives the number of calibration findings. From E03, and in A01 from A01-F06, each
calibration finding also cites the external sources its calibration rests on, verified when it was written.

U01 records the owner's own policy decisions, not external evidence; its findings cite the verified dossiers the autonomous design relies on, and U01-F07 to U01-F14 also quote the external documentation their checks rest on, fetched and checked on 2026-09-25.

A01 records the first autonomous pilot (evals/pilot-auto-2026-09-25.md). Like E01 and E02 it calibrates how rules are applied, never the external evidence they cite. A01-F06 onward and E03 record the calibration round the owner approved on 2026-09-25 ("oui lance la cali[b]ration et le second pilote"), applied and unmeasured until the second autonomous pilot; the open questions A01 still lists are not applied. A01-F23 to A01-F40 record the second autonomous pilot's lessons (self-setup, the full-scope lane, and its scale and bookkeeping defects: capture, ingest, bundles, run budget, concurrency, gate reuse), taken from its record, grade and transcripts. A01-F41 to A01-F49 record round 3: the skill's own pass agents, models and reads read from transcripts, detector cards, characterization pins, per-function e2e reach and checked Residual risk cells. A01-F50 to A01-F60 record round 4, from the third autonomous pilot: windows that reflow into verify/apply cycles for deferred candidates, a verification order by expected fixes per minute and one time-boxed reproduction before demoting (A01-F50 to A01-F52); test globs taken for gate configurations, notes quoting a forbidden command refused as commands, verifier reports with a preface, and a Windows link that hung the run and that a worktree removal would have followed (A01-F53 to A01-F56); offline e2e subcommands for self-setup, Residual risk cells that list every open finding, a scripted final message, and validating run-file scripts (A01-F57 to A01-F60).
