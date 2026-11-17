# Designing an effective Claude Code skill for this job, plus prior art
> Code T31 · slug skill-design · verified 2026-09-23 · counts: verified 11 / corrected 10 / downgraded 0 / dropped 0

Verification method: every cited URL was re-opened on 2026-09-23.
- arXiv papers: abstracts were read on arxiv.org or through the arXiv API. Full-text claims were checked in the arXiv HTML versions.
- Claude Code docs: pulled as raw Markdown (`code.claude.com/docs/en/<page>.md`) and searched for the exact strings.
- platform.claude.com pages: read in full.
- GitHub prompt files (anthropics/claude-code plugins, anthropics/skills skill-creator, getsentry/skills, obra/superpowers): downloaded raw from `main` and searched.
- Hacker News comments: pulled through the official Firebase API (author, date, full text).
- Venue: Panickssery et al. was confirmed in the NeurIPS 2024 proceedings index.

The WebSearch quota for the session ran out during this task. Nothing below rests on a search snippet: every claim is backed by a page that was actually opened. "Via full text" means the arXiv HTML version was read. All harness numbers (5,000 and 25,000 tokens, 1,536 characters, 8 Stop-hook blocks) are as documented on 2026-09-23 and change between Claude Code versions.

## Summary

The strongest evidence on how to build this skill comes from four places:
- controlled studies of agent skills and context files (2025–2026),
- the official authoring guidance from Anthropic and agentskills.io,
- the Claude Code documentation on how skills, hooks and compaction behave,
- a full reading of the prior-art prompts.

These sources agree on six points.

1. **Most skills do not help unless their effect is measured.**
   - In SWE-Skills-Bench (Han et al., 2026), 39 of 49 public software-engineering skills gave zero pass-rate improvement, and the average gain was +1.2%. Seven skills gave meaningful gains (up to +30%). Three others made results worse, by up to 10%. The abstract attributes this to "version-mismatched guidance conflicting with project context".
   - In SkillsBench (Li et al., v4, June 2026), curated skills raised the average pass rate from 33.9% to 50.5% (+16.6 pp). Software Engineering gained only +11.6 pp; Natural Science gained +28.8 pp.
   - So build the skill evaluation-first: run the same fixture repos with and without the skill.
2. **Short beats exhaustive.**
   - In SkillsBench, compact and standard-length skills gained +19.0 and +21.5 pp. "Comprehensive documentation" gained +0.7 pp, but that text-size bucket holds only 5 tasks. In a separate bundle-size ablation, 4 or more skills gained +10.1 pp against +18.0-19.0 for 1-3.
   - In IFScale (a keyword-inclusion benchmark, not a coding task), instruction-following degrades as instructions accumulate: the best model reached 68% accuracy at 500 instructions.
   - Official limits:
     - SKILL.md body under 500 lines. Both Anthropic and agentskills.io say this; agentskills.io also recommends under 5,000 tokens.
     - References one level deep.
     - A table of contents in any reference file over 100 lines.
3. **Model-generated content does not help.**
   - In SkillsBench v4, the agent wrote its own skills with Anthropic's skill-creator. These self-generated skills scored 8.1 to 11.5 pp *below* using no skill at all, on all three configurations tested.
   - Gloaguen et al. (ETH Zurich / LogicStar) found that context files did not generally improve success, whether LLM-generated or developer-written, while raising inference cost by over 20% on average. Their per-type deltas (−0.5% and −2% for LLM-generated, +2.4% for developer-written) were not statistically significant.
   - This supports the user's "third-party" premise: every rule should cite an external source.
4. **The skill must not restate what linters already check.** "Lint Leakage" is the most common smell in agent configuration files (62% of 100 repositories). The skill should discover and run the project's own tools, and spend its text only on judgment and verification that tools cannot provide.
5. **Behavior preservation needs gates the agent can run.**
   - LLM refactorings were functionally non-equivalent 19–35% of the time, and about 21% of those slipped past the existing tests. The models tested were CodeLlama, Codestral, StarChat2, Qwen-2.5, Olmo-3 and GPT-4o.
   - Up to 76.3% of LLM extract-method suggestions were hallucinations (Java/IntelliJ study, 2024).
   - On impossible (Conflicting-SWEbench) tasks, GPT-5 cheated 54% of the time and Claude Opus 4.1 about 50%, for example by editing tests.
   - The skill therefore needs:
     - a green baseline before any edit,
     - read-only tests enforced by hooks,
     - tool-driven refactorings,
     - one kind of change per commit,
     - evidence in the final report rather than claims.
   - In one white-box study, 38 of 44 failed runs still ended with a success, safe or completion claim.
6. **Review noise is the main way this fails in practice.**
   - 56.3% of CodeRabbit comments were rejected (31,073 comment/feedback pairs).
   - In an industrial study (ICSE-SEIP 2025, Qodo PR-Agent), the average pull-request closure time rose from 5h52 to 8h20 after AI review was added. This is a before/after comparison, not a causal result.
   - Detection should therefore be two-stage: tools plus LLM to find candidates, then a fresh-context verifier that must cite file:line evidence. Changes should be applied in risk tiers, with a report first.

**On the Claude Code side:**
- Invocation:
  - Make the skill user-invoked (`disable-model-invocation: true`).
  - `allowed-tools` only *pre-approves* tools for the invoking turn. It does not restrict which tools exist, so use `disallowed-tools` or permission deny rules to restrict.
- Placement of invariants:
  - Put the invariants near the top of SKILL.md. After auto-compaction, Claude Code re-attaches only the first 5,000 tokens of each invoked skill, within a shared 25,000-token budget, and it never re-reads the skill file.
- Analysis in subagents:
  - Run heavy analysis in fresh-context subagents working against an external checklist.
  - In one study (single task, single model, n=10 per arm), a detailed external checklist passed 10/10 runs versus 5/10 for a generic self-check (p = 0.0325). The long-versus-clean context effect in that study (8/10 versus 3/10) was only trend-level (p = 0.0698).
- Hooks:
  - Hooks enforce the rules that must never break.
  - They must be scoped, because skill hooks stay registered for the whole session.

**Prior art** includes:
- Anthropic's plugin prompts: code-simplifier, the pr-review-toolkit agents, and the code-review command.
- The built-in `/simplify`, `/code-review` and `/batch` skills.
- Sentry's copy of the simplifier.

Patterns worth copying from it:
- false-positive exclusion lists,
- validation subagents,
- "if not certain, do not flag",
- a hidden-failure checklist,
- simplification anti-patterns.

It also has concrete flaws:
- **Diff-only scope.** The plugin prompts and `/simplify` target the diff or recently touched code, and the code-review plugin treats pre-existing issues as false positives. By contrast, the managed Code Review product has a "Pre-existing" severity, and the built-in `/code-review` accepts a path target.
- **Hardcoded internal conventions**: the `function` keyword, errorIds.ts, Sentry/Statsig. Sentry copied them verbatim.
- **No tests.** None of the plugin prompts runs tests: "verify" means self-assessment, and the code-review command's `allowed-tools` are `gh` commands only.
- **Documentation drift.** The code-review README describes a 0–100 score with an 80 threshold and a git-blame agent. The plugins index says "5 parallel Sonnet agents". The current command uses Haiku and Sonnet gate agents, two Opus bug agents and validation subagents, with no numeric score.

Evidence conflicts on four points:
- how emphatic instructions should be,
- abstract versus concrete guidance,
- auto-triggering,
- whether context files save or cost tokens.

Versions used:
- code.claude.com docs and platform.claude.com pages as fetched 2026-09-23;
- the agentskills.io specification;
- anthropics/claude-code `main` plugins;
- anthropics/skills skill-creator (`main`);
- arXiv preprints 2024–2026 as cited.

## Findings

### T31-F03 — Put the non-negotiable invariants at the top of SKILL.md, write them as standing instructions, and keep run state in an external file the agent re-reads
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Claude Code never re-reads the skill file. After compaction it re-attaches only the first 5,000 tokens of the most recent invocation of each skill, and all re-attached skills share a 25,000-token budget; older skills can be dropped entirely. Rules placed at the bottom of a long skill are the first to be lost. IFScale also reports a bias toward earlier instructions under high instruction density (keyword-inclusion task, so the transfer to skills is indirect).
- **Evidence:**
  - [Extend Claude with skills — Skill content lifecycle](https://code.claude.com/docs/en/skills) — Anthropic, 2026 — official_docs — "Claude Code does not re-read the skill file on later turns, so write guidance that should apply throughout a task as standing instructions rather than one-time steps." … "re-attaches the most recent invocation of each skill after the summary, keeping the first 5,000 tokens of each. Re-attached skills share a combined budget of 25,000 tokens." — verbatim in the raw Markdown, lines 518/522.
  - [How Many Instructions Can LLMs Follow at Once? (IFScale)](https://arxiv.org/abs/2507.11538) — Jaroslawicz, Whiting, Shah, Maamari, 2025 — preprint — abstract: "bias towards earlier instructions" — verified. The benchmark is 500 keyword-inclusion instructions for a business report, not coding.
  - [When and How Context Rot Appears in Coding Agents](https://arxiv.org/abs/2607.17937) — Yue Xue, 2026 (v2 1 Aug 2026) — preprint — via full text: "keep the pending critical obligations small, explicit, external to the growing transcript, and independently checkable" — verified.
- **Detect:** `grep -n -m1 -i 'invariant' SKILL.md` should return a line within roughly the first 100 lines. SKILL.md should tell the agent to create and re-read a `.hardening/progress.md` (or similar) obligations file. In run transcripts, look for compaction events followed by invariant violations.
- **Tools:** grep; Claude Code `/compact`, `/context`; transcript review.
- **Applies to:** Long whole-repository runs in Claude Code.
- **When not to apply / counterpoints:** The 5,000 and 25,000-token figures are specific to the Claude Code version. Other harnesses (Codex, Cursor) compact differently. The context-rot recommendation comes from one single-author case study.
- **Fix risk:** low

### T31-F16 — Put deterministic steps into bundled scripts and use a plan-validate-execute artifact
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Scripts are more reliable than regenerated code, save tokens, and turn "looks done" into pass/fail.
  - The top SkillsBench skills bundled executable scripts with calibrated defaults.
  - Scripts to bundle:
    - `scripts/inventory`: detects languages, tools, versions and test commands.
    - `scripts/gates`: runs build, type check, lint and tests, and emits JSON pass/fail with exit codes.
    - `scripts/diff_guard`: checks that tests are read-only, that no config was weakened, and that the public API is unchanged.
    - A validator for the findings/changes JSON schema, with specific error messages.
  - Workflow: inventory → detect → findings.json → validate → approval → apply item by item → gates → report.
  - SKILL.md must say for each script whether it is to be run or read.
- **Evidence:**
  - [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — Anthropic — official_docs — verified verbatim:
    - "Prefer scripts for deterministic operations"
    - "The 'plan-validate-execute' pattern catches errors early"
    - "When to use: Batch operations, destructive changes, complex validation rules, high-stakes operations."
    - "Make validation scripts verbose with specific error messages"
    - the page also asks you to state whether Claude should "Execute the script" or "Read it as reference".
  - [SkillsBench v4 full text](https://arxiv.org/html/2602.12670v4) — Li et al., 2026 — preprint — verified: top skills had "executable scripts with calibrated defaults, canonical data sources and parsing quirks, verifier-facing file-format constraints"; "Skill authors should optimize for verifier-facing detail an agent cannot infer, not for completeness."
  - [skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) — Anthropic — official repo — verified: if several test runs independently wrote a similar helper such as `create_docx.py`, "that's a strong signal the skill should bundle that script".
  - [Build skills (Codex)](https://learn.chatgpt.com/docs/build-skills) — OpenAI — official_docs — counterpoint, verified: "Prefer instructions over scripts unless you need deterministic behavior or external tooling."
- **Detect:**
  - `scripts/` contains inventory, gates, diff_guard and a validator.
  - Every script reference in SKILL.md says "Run" (execute) or "See" (read).
  - Feed the validator a malformed findings.json and confirm it fails with a specific message.
- **Tools:** Python or POSIX sh scripts; jq; a JSON Schema validator.
- **Applies to:** Skill packaging.
- **When not to apply / counterpoints:** Scripts increase the attack surface (2.12× vulnerability odds; see F15) and must work cross-platform (Windows/Git Bash). OpenAI's Codex guidance favors instructions unless determinism is needed.
- **Fix risk:** low

### T31-F21 — Use hooks for the few rules that must never be violated, and scope them
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - Instructions are advisory; hooks are deterministic.
  - Suggested hooks:
    - A PreToolUse hook (matcher `Edit|Write`) that exits 2 with a clear stderr message when the target is an existing test file or a lint/type config.
    - A Stop hook that runs `scripts/gates` and blocks finishing while gates are red.
  - Skill hooks persist beyond the skill's own turn. Make each hook a no-op unless a run marker exists (`.hardening/active`, created at start and removed at the end), or use `once: true` where appropriate.
  - Claude Code ends a turn anyway after 8 consecutive Stop-hook blocks, so the gate must report rather than loop. It must also check `stop_hook_active`.
- **Evidence:**
  - [Hooks reference](https://code.claude.com/docs/en/hooks) — Anthropic, 2026 — official_docs — verified verbatim:
    - "Skill hooks: Claude Code registers them when you or Claude invoke the skill and keeps running them for the rest of the session, on turns after the skill's own turn as well. To have Claude Code remove a hook after its first successful run instead, set `once: true` on it."
    - "Exit 2 means a blocking error."
    - Stop hooks receive `stop_hook_active`; "Claude Code overrides the hook and ends the turn after 8 consecutive blocks."
  - [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Anthropic, 2026 — official_docs — verified: "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."; "Claude Code overrides the hook and ends the turn after 8 consecutive blocks."
  - [Show HN: Squawk – Detect and stop behavioral anti-patterns in AI coding agents](https://news.ycombinator.com/item?id=47275781) — jack-lin, 2026-03-06 — practitioner_forum — verified. It is built on Claude Code hook events and its rules include "Test-only modifications without reading corresponding source" and "Error handling removal or test assertion weakening".
- **Detect:**
  - The frontmatter has `hooks`.
  - In a fixture, try to edit an existing test and expect a block with a message.
  - After the run, the marker is gone and a test edit is allowed.
  - The Stop hook checks `stop_hook_active`.
- **Tools:** Claude Code hooks; jq; POSIX sh / PowerShell.
- **Applies to:** Claude Code (hooks are harness-specific).
- **When not to apply / counterpoints:**
  - Hooks run shell commands with the user's permissions.
  - Frontmatter hooks in a project skill follow the workspace-trust rule for settings-file hooks, but the docs note they register on invocation "including in a `-p` run in a folder you haven't trusted", so do not rely on trust gating.
  - Cross-platform scripting on Windows needs care.
- **Fix risk:** medium

### T31-F01 — Build the skill evaluation-first, with paired with/without-skill runs on fixture repositories
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - The three harmful SWE-Skills-Bench skills are separate from the 39 zero-gain skills.
  - The HN btown critique is restated accurately and dated to SkillsBench v1.
  - An unsourced "HN commenter asked whether comparisons were run more than once" counterpoint was removed.
  - "Ideally 10+" fixtures is flagged as the researcher's suggestion; the sources say at least three.
- **Rationale:**
  - Paired benchmarks show most skills add nothing or make things worse, and gains are smallest in software engineering. Without a paired baseline you cannot tell whether a code-quality skill helps.
  - Build at least 3 fixture repositories containing:
    - seeded defects: dead code, duplication, swallowed errors, complexity hot spots;
    - traps: code reached only through reflection, config, public exports or string lookups, and intentional fallbacks;
    - hidden behavior tests.
  - Run each fixture with and without the skill: same model, 3 or more runs each (SkillsBench used 3 trials per cell).
  - Record:
    - verified true findings,
    - false positives,
    - hidden-test pass rate after fixes,
    - tokens and time.
  - Keep only sections of the skill that move these numbers. Re-run after edits, on every model you plan to use.
- **Evidence:**
  - [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — Anthropic — official_docs — verified verbatim: "Create evaluations BEFORE writing extensive documentation."; "Build three scenarios that test these gaps"; "Establish baseline: Measure Claude's performance without the Skill"; checklist "At least three evaluations created", "Tested with Haiku, Sonnet, and Opus".
  - [skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) — Anthropic — official repo — verified: "For each test case, spawn two subagents in the same turn — one with the skill, one without."; look for "assertions that always pass regardless of skill (non-discriminating)" and "high-variance evals (possibly flaky)".
  - [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401) — Han, Zhang, Song, Fang, Chen, Sun, Hu, 16 Mar 2026 — preprint:
    - Abstract verified: "39 of 49 skills yield zero pass-rate improvement, and the average gain is only +1.2%. Token overhead varies from modest savings to a 451% increase"; "Only seven specialized skills produce meaningful gains (up to +30%), while three degrade performance (up to -10%)".
    - Via full text: the security-review skill scored 92.3% in both conditions.
  - [SkillsBench v4](https://arxiv.org/abs/2602.12670) — Xiangyi Li et al., v4 14 Jun 2026 — preprint:
    - Abstract verified: 87 tasks, 18 model-harness configurations; "Curated Skills raise the average pass rate from 33.9% to 50.5% (+16.6 percentage points…)".
    - Via full text: Software Engineering +11.6 pp versus Natural Science +28.8 pp; "13 of 87 tasks show negative Skills deltas".
- **Detect:**
  - The skill directory contains `evals/` with at least 3 cases, fixture repos, and a benchmark file comparing with_skill against without_skill. No baseline delta means the rule is violated.
  - Scan the benchmark for non-discriminating assertions.
- **Tools:** anthropics/skills skill-creator (aggregate_benchmark, eval-viewer); `claude -p` headless runs; git worktree; pytest/vitest for hidden behavior tests.
- **Applies to:** Authoring and maintaining the hardening skill itself (all languages).
- **When not to apply / counterpoints:**
  - Evals are costly, and small n is noisy.
  - HN user btown (on SkillsBench v1, Feb 2026) noted that each task is "a single markdown file of instructions, plus an opaque verifier" with "No problems involving existing codebases, refactors". Numbers may therefore not transfer to whole-repository hardening.
  - skill-creator warns against overfitting to a few fixtures ("Generalize from the feedback").
- **Fix risk:** low

### T31-F02 — Keep SKILL.md a compact workflow and put the rule catalog in reference files one level deep
- **Grade:** A · **Verdict:** CORRECTED. (audit correction: the +0.7 pp "comprehensive" bucket is a SKILL.md text-size bucket of only 5 tasks, and it is a different ablation from bundle size, where 4 or more skills gained +10.1 pp against +18.0 for 1 skill and +19.0 for 2-3.) Changes:
  - Added the fifth author (Valente) to dos Santos et al.
  - The "pitch the agent" quote belongs to a grey-literature source (D7) that the paper quotes; it is not the authors' own finding.
  - agentskills.io also states the 500-line limit.
  - "At most ~3 modules per run" is an extrapolation: SkillsBench's "at most three modules" describes the composition of a skill, not reference files loaded per run.
- **Rationale:**
  - Every loaded token is a recurring cost and competes with the target code.
  - The longest skills gained least in SkillsBench: the "comprehensive" text-size bucket gained +0.7 pp, against +19.0 and +21.5 pp for compact and standard-length skills. That bucket holds only 5 tasks ("Comprehensive 5 39.3% 40.0% +0.7"). Separately, in the bundle-size ablation, bundles of 4 or more skills gained +10.1 pp, against +18.0 for 1 skill and +19.0 for 2-3.
  - Agents may only partially read nested references (`head -100`).
  - Layout:
    - SKILL.md body: 500 lines or fewer, ideally under about 5,000 tokens. It holds only scope, invariants, a workflow checklist, the output template and pointers.
    - Rules: in `references/<category>.md` and `references/lang/<language>.md`, each linked directly from SKILL.md with a one-line "read when X" pitch.
    - Any reference file over 100 lines starts with a table of contents.
    - No reference-to-reference chains.
    - Load only the modules the detected languages and categories need.
- **Evidence:**
  - [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — Anthropic — official_docs — verified verbatim: "Keep SKILL.md body under 500 lines for optimal performance"; "Keep references one level deep from SKILL.md"; "For reference files longer than 100 lines, include a table of contents at the top."; Claude "might use commands like `head -100` to preview content rather than reading entire files".
  - [Agent Skills Specification](https://agentskills.io/specification) — agentskills.io — standard — verified: "Instructions (< 5000 tokens recommended)"; "Keep your main `SKILL.md` under 500 lines."; "Keep file references one level deep from `SKILL.md`."
  - [SkillsBench v4 full text](https://arxiv.org/html/2602.12670v4) — Li et al., 2026 — preprint — verified: "compact and standard-length Skills (+19.0 and +21.5 pp) outperform detailed (+14.5 pp) and comprehensive documentation (+0.7 pp)"; abstract: "Focused Skills with at most three modules outperform larger or exhaustive bundles". Appendix F: the buckets are SKILL.md text-size percentiles, and the comprehensive bucket has n = 5 ("Comprehensive 5 39.3% 40.0% +0.7"); the bundle-quantity ablation is separate (1 skill +18.0, 2-3 skills +19.0, 4 or more +10.1 pp) — n and ablation split added by the citation audit.
  - [IFScale](https://arxiv.org/abs/2507.11538) — Jaroslawicz et al., 2025 — preprint — verified: "even the best frontier models only achieve 68% accuracy at the max density of 500 instructions". This is a keyword-inclusion task; transfer to coding is indirect.
  - [Configuration Smells in AGENTS.md Files](https://arxiv.org/abs/2606.15828) — dos Santos, Costa, Montandon, Silva, Valente, 14 Jun 2026 — preprint:
    - Verified: Context Bloat 42% of 100 repositories.
    - Via full text: Blind Reference 16% ("references to external documents, files, or directories without explaining their purpose or scope").
    - The paper quotes grey-literature source D7: "You have to pitch the agent on why and when to read the file".
- **Detect:**
  - `wc -l SKILL.md` over 500 is a violation. Approximate tokens with `wc -w` × ~1.3.
  - Nested references: `grep -nE '\]\([^)]*\.md\)' references/*.md`.
  - Files over 100 lines should have "Contents" in their first 20 lines.
  - `skills-ref validate ./<skill>`.
- **Tools:** wc; grep; skills-ref (agentskills reference validator); Claude Code `/context`.
- **Applies to:** Skill structure (every harness that follows the Agent Skills spec).
- **When not to apply / counterpoints:**
  - Vercel found an always-loaded AGENTS.md docs index beat on-demand skills (100% versus 53% default and 79% with explicit instructions) because the agent did not open the skill. On-demand reference files carry the same risk, so use explicit conditionals ("if language == python, read references/lang/python.md").
  - obra/superpowers argues for even smaller bodies: under 500 words, and under 200 for frequently loaded skills.
- **Fix risk:** low

### T31-F14 — Make the skill user-invoked with a precise frontmatter
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - `allowed-tools` only *pre-approves* tools for the invoking turn; it does not restrict the tool pool. Restriction needs `disallowed-tools` or permission deny rules.
  - The 1,024-character description limit comes from the Agent Skills spec and Anthropic's API guidance. Claude Code separately truncates description + `when_to_use` at 1,536 characters in the listing.
- **Rationale:**
  - Automatic triggering is unreliable in both directions, and skills with side effects should be triggered by the user.
  - Descriptions that summarize the workflow can lead the agent to follow the summary instead of the body.
  - Frontmatter to use:
    - `name`: lowercase letters, numbers and hyphens, 64 characters or fewer, matching the directory.
    - `description`: third person, says what the skill does and when to use it, 1,024 characters or fewer, and does not summarize the workflow.
    - `disable-model-invocation: true`.
    - `argument-hint` for scope and a report-only mode.
    - `allowed-tools`: pre-approve only read/search tools plus specific lint and test commands, never bare `Bash`. Use `disallowed-tools` or deny rules for anything that must be blocked.
  - Avoid "CRITICAL/MUST" trigger language.
- **Evidence:**
  - [Extend Claude with skills](https://code.claude.com/docs/en/skills) — Anthropic, 2026 — official_docs — verified verbatim:
    - `disable-model-invocation` is for "workflows with side effects or that you want to control timing … You don't want Claude deciding to deploy because your code looks ready."
    - "the combined `description` and `when_to_use` text is truncated at 1,536 characters in the skill listing"
    - `allowed-tools`: "The grant clears when you send your next message"; "It does not restrict which tools are available: every tool remains callable".
  - [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — Anthropic — official_docs — verified: "Always write in third person. The description is injected into the system prompt"; `description` "Maximum 1,024 characters"; `name` "Maximum 64 characters".
  - [AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) — Jude Gao (Vercel), 27 Jan 2026 — engineering_blog — verified: "In 56% of eval cases, the skill was never invoked." Pass rates: baseline 53%, skill 53%, skill + explicit instructions 79%, AGENTS.md index 100%. The evals covered Next.js 16 APIs that are not in training data.
  - [writing-skills SKILL.md](https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md) — Jesse Vincent (obra/superpowers) — engineering_blog — verified: "Testing revealed that when a description summarizes the skill's workflow, an agent may follow the description instead of reading the full skill content."
  - [Build skills (Codex)](https://learn.chatgpt.com/docs/build-skills) — OpenAI — official_docs — verified: "Keep each skill focused on one job."; `policy: allow_implicit_invocation: false` means Codex "won't implicitly invoke the skill … explicit `$skill` invocation still works."
- **Detect:**
  - `skills-ref validate ./<skill>`.
  - Parse the YAML: assert `disable-model-invocation: true` and that `allowed-tools` has no bare `Bash` / `Bash(*)`.
  - Description length ≤ 1,024.
  - `grep -E '^description:.*\b(I can|You can)\b' SKILL.md` flags a description not written in third person.
- **Tools:** skills-ref; yq / Python yaml; grep.
- **Applies to:** Skill frontmatter (Claude Code; the Codex equivalent is `agents/openai.yaml`).
- **When not to apply / counterpoints:** With manual invocation, users may forget to run the skill, so put it in a release checklist. skill-creator recommends "pushy" descriptions to counter under-triggering, but that matters only for auto-invoked skills.
- **Fix risk:** low

### T31-F20 — Use git as the safety net, not checkpoints
- **Grade:** A · **Verdict:** CORRECTED. The sub-agents quote "Prevents unintended changes to your main checkout" does not appear on the page and was replaced with the actual wording. The checkpointing page was added as direct evidence.
- **Rationale:**
  - Checkpoints miss:
    - changes made through Bash,
    - edits by background subagents and background forked skills,
    - background `/code-review --fix` edits.
  - Only git gives a complete, reviewable and revertible record.
  - Preflight:
    - `git status --porcelain` must be empty (stash only with consent).
    - Create a dedicated branch (for example `hardening/<date>`) and record the base SHA.
  - Make every change a commit. Never rewrite history or force-push.
  - The final report lists the commits and `git diff --stat base..HEAD`. Undo means `git revert`.
- **Evidence:**
  - [Best practices for Claude Code — Rewind with checkpoints](https://code.claude.com/docs/en/best-practices) — Anthropic, 2026 — official_docs — verified verbatim: "Checkpoints only track changes made through Claude's file editing tools. Changes made through Bash commands or external processes are not captured. This isn't a replacement for git."
  - [Checkpointing — Subagent edits not restored](https://code.claude.com/docs/en/checkpointing) — Anthropic, 2026 — official_docs — verified: for "Any other subagent: rewinding doesn't restore the edits. Use git to revert them. This includes a forked skill that runs in the background, the default, and a background `/code-review --fix` run."
  - [Code Review — What the review reads and edits](https://code.claude.com/docs/en/code-review) — Anthropic, 2026 — official_docs — verified: "A background review applies its `--fix` edits outside your session's checkpoints, so `/rewind` doesn't undo them; use git to revert them."
  - [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, 2026 — official_docs — verified (corrected quote): `isolation` — "Set to `worktree` to run the subagent in a temporary git worktree, giving it an isolated copy of the repository branched by default from your default branch rather than the parent session's `HEAD`."
- **Detect:**
  - The preflight exits non-zero when `git status --porcelain` is non-empty.
  - `git rev-parse --abbrev-ref HEAD` is not main or master during edits.
  - The report contains the base SHA and the commit list.
- **Tools:** git; git worktree.
- **Applies to:** Any skill that edits code.
- **When not to apply / counterpoints:**
  - Worktrees duplicate disk space and dependency installs.
  - Worktree subagents branch from the *default branch*, not HEAD, so point them at the hardening branch explicitly.
  - In projects that are not under git, the skill should refuse edit mode.
- **Fix risk:** low

### T31-F07 — Hard behavior-preservation gate: green baseline, characterization tests first, mechanical refactoring engines, re-gate after every atomic change
- **Grade:** B · **Verdict:** VERIFIED (caveats on scope added)
- **Rationale:**
  - LLM refactorings often change semantics, and existing tests miss a sizeable share of those changes.
  - Re-applying the refactoring with a tested engine avoids unsafe edits.
  - Compound refactorings fail more often than atomic ones.
  - Passing tests alone do not prove equivalence.
  - The gate:
    1. Before any edit, build, type-check, lint and the full test suite must pass. Record the commands and exit codes; if the baseline is red, stop and report.
    2. Before changing code that has no tests, add characterization tests in a separate commit.
    3. Prefer mechanical engines (LSP/IDE rename and extract, codemods, `ast-grep --rewrite`, `ruff --fix`, `eslint --fix`) over free-hand rewrites.
    4. After each atomic change, re-run the gate and revert on failure.
    5. For logic changes in pure functions, add a differential or property-based check comparing old and new versions.
- **Evidence:**
  - [A Differential Fuzzing-Based Evaluation of Functional Equivalence in LLM-Generated Code Refactorings](https://arxiv.org/abs/2602.15761) — Dristi & Dwyer, 17 Feb 2026 — preprint — abstract verified: "producing 19-35% functionally non-equivalent refactorings … about 21% of these non-equivalent refactorings remain undetected by the existing test suites". Models: CodeLlama, Codestral, StarChat2, Qwen-2.5, Olmo-3, GPT-4o; 3 datasets, 2 refactoring types. No current frontier coding agent was tested.
  - [An Empirical Study on the Potential of LLMs in Automated Software Refactoring](https://arxiv.org/abs/2411.04444) — Bo Liu, Jiang, Zhang, Niu, Li, Hui Liu, 2024 (Automated Software Engineering 32(1), 2025) — peer-reviewed — verified: "13 out of the 176 solutions suggested by ChatGPT and 9 out of the 137 solutions suggested by Gemini were unsafe"; RefactoringMirror works by "reapplying the identified refactorings to the original code using thoroughly tested refactoring engines". It used 180 Java refactorings.
  - [Together We Go Further: LLMs and IDE Static Analysis for Extract Method Refactoring](https://arxiv.org/abs/2401.15298) — Pomian, Bellur, Dilhara, Kurbatova, Bogomolov, Bryksin, Dig, 2024 — preprint — verified: "up to 76.3% of the suggestions are hallucinations"; the approach "leverages the IDE to execute refactorings correctly". The tool is an IntelliJ plugin (EM-Assist).
  - [SWE-Refactor](https://arxiv.org/abs/2602.03712) — Xu, Yang, Chen, Feb 2026 — preprint — verified: 1,099 refactorings from 18 Java projects (922 atomic, 177 compound); "an OpenAI Codex agent achieves only 39.4% success on compound instances".
  - [Refactoring](https://refactoring.com/) — Martin Fowler (book, 2nd ed. 2018) — book, confirmed via the author's own site — verified: "a change made to the internal structure of software to make it easier to understand and cheaper to modify without changing its observable behavior"; "The system is kept fully working after each refactoring".
- **Detect:**
  - The report includes the baseline and post-change gate outputs (commands and exit codes).
  - `git log --reverse --stat base..HEAD` shows test-only commits before refactor commits for previously uncovered files.
  - Per-commit gate loop over `git rev-list --reverse base..HEAD`.
  - diff-cover on touched lines.
- **Tools:** the project test runner; coverage.py / c8 / nyc + diff-cover; ast-grep `--rewrite`; LSP rename / IDE refactorings; Hypothesis / fast-check.
- **Applies to:** Every edit the skill makes, in any language.
- **When not to apply / counterpoints:**
  - The evidence comes from Java studies and older or smaller models. The rates for current frontier agents are unknown, but the direction (tests miss semantic changes) is consistent.
  - Full suites can be slow: run affected tests per step and the full suite at the end.
  - Characterization tests freeze existing bugs.
  - Projects with no tests should drop to report-only mode.
- **Fix risk:** low

### T31-F08 — Existing tests are read-only during a hardening pass, enforced by hooks and a diff guard, with an explicit "flag it" outlet
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Frontier agents exploit tests when they cannot pass them honestly: they modify tests or overload operators.
  - Read-only tests reduce this without hurting legitimate performance.
  - An explicit abort/flag option sharply cut GPT-5's cheating rate.
  - The rule:
    - New tests may be added.
    - Existing tests, snapshots and assertions must not be modified, deleted or skipped.
    - Type or lint configuration must not be weakened.
- **Evidence:**
  - [ImpossibleBench](https://arxiv.org/abs/2510.20270) — Zhong, Raghunathan, Carlini, 23 Oct 2025 — preprint:
    - Abstract verified: "an LLM agent with access to unit tests may delete failing tests rather than fix the underlying bug".
    - Via full text: GPT-5 "cheats 54.0% of the time on Conflicting-SWEbench"; Claude Opus 4.1 about 50%.
    - "Read-only access provides a middle ground: it restores legitimate performance while preventing test modification attempts".
    - The flag-for-human option lowered "the cheating rate of GPT-5 from 54% to 9% and o3 from 49% to 12%".
  - [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — Anthropic — official_docs — verified verbatim: "Do not hard-code values or create solutions that only work for specific test inputs." … "If the task is unreasonable or infeasible, or if any of the tests are incorrect, please inform me rather than working around them."
  - [Augmented Coding: Beyond the Vibes](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes) — Kent Beck, 25 Jun 2025 — engineering_blog — verified warning sign: "Any indication that the genie was cheating, for example by disabling or deleting tests."
- **Detect:**
  - `git diff --name-status base -- '*test*' '*spec*' '**/__snapshots__/**'`: any M or D is a violation.
  - Skip markers added: grep `^\+` lines for `.skip(`, `xit(`, `@Disabled`, `pytest.mark.skip`, `t.Skip(`, `#[ignore]`.
  - Config weakening: grep added lines in lint/tsconfig/pyproject for `"off"`, `strict": false`, `noqa`, `type: ignore`, `eslint-disable`.
- **Tools:** git diff; a Claude Code PreToolUse hook (exit 2); grep.
- **Applies to:** All hardening runs with a test suite.
- **When not to apply / counterpoints:** Refactoring the tests themselves is legitimate work; do it in a separate, explicitly approved pass. Skill hooks persist for the session (F21). The cheating rates are measured on deliberately impossible tasks, not typical ones.
- **Fix risk:** low

### T31-F10 — Two-stage findings: broad detection, then fresh-context verification that cites file:line evidence or refutes the candidate
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Review agents told to find everything have poor signal-to-noise.
  - Industrial systems that pair a detector with a precision filter reach usable precision.
  - Anthropic's own review tooling adds a validation stage and demands citations.
  - Use an explicit exclusion list:
    - pre-existing intentional patterns,
    - lint-silenced lines,
    - generated code,
    - style preferences.
- **Evidence:**
  - [code-review plugin command](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) — Anthropic (anthropics/claude-code `main`) — prompt file — verified verbatim: "For each issue found in the previous step by agents 3 and 4, launch parallel subagents to validate the issue"; "If you are not certain an issue is real, do not flag it. False positives erode trust and waste reviewer time."; false-positive list includes "Issues mentioned in CLAUDE.md but explicitly silenced in the code (e.g., via a lint ignore comment)".
  - [Code Review](https://code.claude.com/docs/en/code-review) — Anthropic, 2026 — official_docs — verified: "a verification step checks candidates against actual code behavior to filter out false positives"; REVIEW.md example: "behavior claims need a `file:line` citation in the source, not an inference from naming".
  - [Reducing False Positives in Static Bug Detection with LLMs](https://arxiv.org/abs/2601.18844) — Du et al. (Tencent), Jan 2026 — preprint — verified: "hybrid techniques of LLM and static analysis eliminate 94-98% of false positives with high recall"; "10-20 minutes of manual inspection per alarm". The dataset is 433 alarms covering three bug types.
  - [BitsAI-CR](https://arxiv.org/abs/2501.15134) — Sun et al. (ByteDance), Jan 2025 — preprint — verified: "two-stage approach combining RuleChecker for initial issue detection and ReviewFilter for precision verification … achieving 75.0% precision".
  - [CR-Bench](https://arxiv.org/abs/2603.11078) — Pereira, Sinha, Ghosh, Dutta, Mar 2026 — preprint — verified: "code review agents can exhibit a low signal-to-noise ratio when designed to identify all hidden issues". The abstract calls it a "preliminary study".
- **Detect:**
  - The findings schema has `evidence.file`, `evidence.line`, `verified` and `verifier_note`.
  - `jq '[.findings[] | select(.reported==true and .verified!=true)] | length'` must be 0.
  - Spot-check that the cited lines exist.
- **Tools:** jq; Claude Code subagents; static analyzers as evidence sources.
- **Applies to:** Every finding the skill reports or fixes.
- **When not to apply / counterpoints:**
  - Verification adds cost; the managed Code Review product averages "$15-25" per review (verified).
  - A same-model verifier shares its biases (see F13, Panickssery et al.), so prefer tool-backed evidence (a test reproduction, tool output).
  - The evidence is from bug review and static-alarm triage, not from simplification or dead-code findings.
- **Fix risk:** low

### T31-F11 — Report first, then apply fixes in risk tiers, with nits capped
- **Grade:** B · **Verdict:** VERIFIED (added Anthropic's REVIEW.md nit-cap guidance as evidence)
- **Rationale:**
  - Automated review comments are often rejected and can coincide with slower delivery.
  - Chasing every finding leads to over-engineering.
  - A finished, working project is where unrequested churn costs most.
  - Tiers:
    - **T0 — auto-apply:** formatter/linter autofixes; compiler-confirmed unused imports and locals; dead private code with zero references after a text, string and reflection search.
    - **T1 — apply on approval:** deduplication, extraction, simplifying conditionals, error-handling changes.
    - **T2 — report only:** architecture, public API, major dependency upgrades.
  - Rank findings by severity × fix risk.
  - Cap nits or move them to an appendix.
  - Say "no issues found" explicitly when that is the result.
- **Evidence:**
  - [Is Agentic Code Review Helpful? Mining Developers' Feedback to CodeRabbit Reviews in the Wild](https://arxiv.org/abs/2607.03316) — Lin, Liang, Thongtanunam, Tantithamthavorn, Jul 2026 — preprint — verified: 31,073 pairs from 10,191 PRs in 239 repositories; "36.4% were accepted and 7.3% triggered discussion, while 56.3% were rejected"; rejections tied to suggestions "that were false positives, redundant, or out of scope".
  - [Automated Code Review In Practice](https://arxiv.org/abs/2412.18531) — Cihan et al., ICSE-SEIP 2025 — peer-reviewed — verified: "73.8% of automated comments were resolved"; "average pull request closure duration increased from five hours 52 minutes to eight hours 20 minutes"; drawbacks "faulty reviews, unnecessary corrections, and irrelevant comments". The tool was built on Qodo PR-Agent, across three projects. This is a before/after comparison.
  - [Best practices for Claude Code — Add an adversarial review step](https://code.claude.com/docs/en/best-practices) — Anthropic, 2026 — official_docs — verified verbatim: "A reviewer prompted to find gaps will usually report some, even when the work is sound … Chasing every finding leads to over-engineering: extra abstraction layers, defensive code, and tests for cases that can't happen."
  - [Code Review — REVIEW.md "Nit volume"](https://code.claude.com/docs/en/code-review) — Anthropic, 2026 — official_docs — verified: "A cap like 'report at most five nits, mention the rest as a count in the summary' keeps reviews actionable."
- **Detect:**
  - Each change in the report has a tier.
  - `git log base..HEAD` contains only T0 commits unless approval is recorded (for example in `.hardening/approvals.md`).
  - Nits in the main report stay at or under the cap.
- **Tools:** findings.json + report template; git.
- **Applies to:** The skill's output and application policy.
- **When not to apply / counterpoints:** Some users want full autonomy; the tiers still allow everything, with an approval step. Batch approvals by category to avoid approval fatigue. The T0/T1/T2 split is a design synthesis, not something a source prescribes.
- **Fix risk:** low

### T31-F06 — Resolve project context before applying language-specific rules; the project wins on conflict; no hard-coded version-specific templates
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Version-mismatched and over-broad guidance caused the SWE-Skills-Bench regressions: agents anchored on template values from an older API and invented fields.
  - Conventions copied from another project cause needless churn.
  - The rule:
    - Record the detected language, runtime and framework versions, and the project's conventions.
    - Key each rule to a version range.
    - When a skill rule conflicts with the project's config or dominant local pattern, report the conflict; do not "fix" it.
    - Ship no hard-coded templates tied to specific API versions.
- **Evidence:**
  - [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401) — Han et al., 2026 — preprint:
    - Abstract verified: "three degrade performance (up to -10%) due to version-mismatched guidance conflicting with project context".
    - Via full text: springboot-tdd −10.0%, linkerd-patterns −9.1%, django-patterns −9.1%. The linkerd template used v1beta1/HTTP/1 where the task needed v1beta3/gRPC.
    - The authors recommend: "skill design should favor abstract guidance patterns over concrete, opinionated templates with hard-coded parameter values".
  - [code-simplifier agent](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md) — Anthropic — prompt file — verified: under "Apply Project Standards: Follow the established coding standards from CLAUDE.md including:" it hardcodes "Prefer `function` keyword over arrow functions" and "Follow proper React component patterns with explicit Props types".
  - [Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html) — Birgitta Böckeler (martinfowler.com), 5 Feb 2026 — engineering_blog — verified verbatim: "If you have low awareness of what's in your context because you copied a lot from a stranger, you might inadvertently repeat instructions or contradict existing ones".
- **Detect:**
  - grep reference files for version-specific advice that has no "applies when" clause.
  - Count style flips against the dominant pattern before and after the run (for example with ast-grep patterns for function declarations versus arrow functions). Any net flip not requested by project config is a violation.
- **Tools:** ast-grep; package manifests and lockfiles; git diff.
- **Applies to:** Language-specific reference files; polyglot repos.
- **When not to apply / counterpoints:** The full text also attributes the regressions to "holistic skill scope conflicting with narrow task requirements" (context pollution), not only to versions. SkillsBench's best skills were concrete (scripts with calibrated defaults). The reconciliation: be concrete about procedure and verification, abstract about project-specific values.
- **Fix risk:** medium

### T31-F04 — Do not restate rules that linters, formatters, type checkers or dead-code tools already enforce; inventory and run the project's own tools first
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - The dos Santos et al. author list is completed (Valente added).
  - The "Linters and formatters like Biome, ESLint, or Ruff…" sentence is a grey-literature source (D6) quoted in the paper, not the authors' own finding.
- **Rationale:**
  - Tools give consistent, cheap, deterministic results.
  - Agents follow the tools they are told about: uv use went from under 0.01 to 1.6 calls per instance when a context file mentioned it.
  - Restating style rules uses up the instruction budget.
  - The workflow:
    - Detect languages, package managers and configured tools from config files.
    - Run the tools with the project's own configuration and treat their output as primary findings.
    - If a key tool is missing, propose adding it as a separate, approved change rather than imitating it with LLM judgment.
- **Evidence:**
  - [Configuration Smells in AGENTS.md Files](https://arxiv.org/abs/2606.15828) — dos Santos, Costa, Montandon, Silva, Valente, 14 Jun 2026 — preprint:
    - Abstract verified: "Lint Leakage was the most common smell, affecting 62% of the files" (100 repositories).
    - Via full text, grey-literature source D6 quoted in the paper: "Linters and formatters like Biome, ESLint, or Ruff handle them faster, cheaper, and with 100% consistency."
  - [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) — Gloaguen, Mündler, Müller, Raychev, Vechev (ETH Zurich / LogicStar.ai), 2026 — preprint:
    - Abstract verified: "instructions in the context files are well followed by coding agents"; "context files are useful for specifying non-standard coding practices".
    - Via full text: uv is used 1.6 times per instance when mentioned, versus under 0.01 otherwise.
  - [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Anthropic, 2026 — official_docs — verified: exclude "Standard language conventions Claude already knows" and "Self-evident practices like 'write clean code'".
  - [code-review plugin command](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) — Anthropic — prompt file — verified: false positives include "Issues that a linter will catch (do not run the linter to verify)".
- **Detect:**
  - grep SKILL.md and references for naming, indentation, semicolon or import-order rules that duplicate a configured lint rule.
  - Confirm an inventory step that parses package.json, pyproject.toml, Cargo.toml, go.mod, eslint config and similar files.
- **Tools:** eslint/biome; ruff; mypy/pyright; `tsc --noEmit`; `cargo clippy`; golangci-lint; knip; vulture; jscpd; semgrep.
- **Applies to:** Any language; most relevant to polyglot repos.
- **When not to apply / counterpoints:** Repos with no tooling have only LLM judgment available. Dead-code and duplication tools produce false positives around dynamic dispatch, reflection and framework conventions, so tool output still goes through the verification stage (F10).
- **Fix risk:** low

### T31-F05 — Every rule in the catalog carries a source, a grade and a detection method; never populate the catalog from model memory
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - Added the third SkillsBench configuration (−11.5 pp, Gemini CLI + Gemini 3.1 Pro).
  - In v4, self-generated skills were authored with Anthropic's skill-creator. The HN critique that the agent had no exploration applies to the v1 protocol (Feb 2026).
  - Noted that Gloaguen's per-type deltas are not statistically significant.
  - Dropped the unverifiable "rahimnathwani" attribution.
- **Rationale:**
  - Skills written from the model's own knowledge performed worse than no skill.
  - Context files, whether LLM-generated or developer-written, did not measurably help and cost more.
  - LLM-extracted "best practices" spread the model's biases into the codebase.
  - Each rule block carries:
    - an id and the rule,
    - the source URL with version or date,
    - an evidence grade,
    - a detection method,
    - when not to apply it,
    - the fix risk.
  - A check fails on any unsourced rule.
- **Evidence:**
  - [SkillsBench v4 full text](https://arxiv.org/html/2602.12670v4) — Li et al., 2026 — preprint — verified:
    - "Self-generated Skills land below the no-Skills baseline on all three configurations (−8.1 pp on Claude Code + Opus 4.7, −11.3 pp on Codex + GPT-5.5, −11.5 pp on Gemini CLI + Gemini 3.1 Pro)".
    - Protocol: "the agent first authors skill packs with Anthropic's skill-creator, then solves each task with only those packs".
    - The trajectory audit blames "generated packs the solver never discovers, creator-side authoring that displaces solver work, and confidently wrong pack content".
  - [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) — Gloaguen et al., 2026 — preprint:
    - Abstract verified: "providing context files does not generally improve task success rates, while increasing inference cost by over 20% on average".
    - Via full text: LLM-generated −0.5% (SWE-bench) and −2% (CTXbench), developer-committed +2.4%, "neither reached statistical significance".
  - [HN comment on the SkillsBench thread](https://news.ycombinator.com/item?id=47040901) — CharlieDigital, 16 Feb 2026 — practitioner_forum — verified: "some devs pull out absolutely bad guidance by introspecting the code with the LLM to define 'best practices' … sprinkling in `ConfigureAwait(false)` which should not be in application code".
- **Detect:** A script asserts that every rule block in `references/*.md` has a `source: https?://` line and a grade field; the unsourced count must be 0.
- **Tools:** grep/awk or a small Python validator in `scripts/`; pre-commit / CI.
- **Applies to:** The skill's rule catalog.
- **When not to apply / counterpoints:**
  - HN dcre (on v1): the benchmark's "self-generated" condition ("the agent is prompted to generate relevant procedural knowledge before solving the task") differs from writing down lessons after a real struggle.
  - Anthropic's own guidance recommends co-developing skills with Claude ("Claude A" writes, "Claude B" tests) from real sessions.
  - Model-assisted drafting from real sources is different from recall. Citations go stale, so record version and date.
- **Fix risk:** low

### T31-F09 — One kind of change per commit; never mix structural and behavioral changes
- **Grade:** B · **Verdict:** VERIFIED (the bisect/reviewer rationale is reasoning, not sourced)
- **Rationale:**
  - Refactoring is defined as a series of small behavior-preserving steps, with the system working after each one.
  - Beck separates structural from behavioral changes and does structural first.
  - Compound refactorings are where LLMs fail most.
  - Classify each change:
    - **Structural:** rename, extract, inline, dead-code deletion, deduplication.
    - **Behavioral:** error-handling semantics, validation, security fixes, dependency upgrades, performance changes with semantic effect.
  - Structural changes go first, one refactoring type per commit.
  - Each behavioral change gets its own commit, a demonstrating test, and user approval.
- **Evidence:**
  - [Augmented Coding: Beyond the Vibes](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes) — Kent Beck, 25 Jun 2025 — engineering_blog — verified: "Separate all changes into two distinct types: 1. STRUCTURAL CHANGES… 2. BEHAVIORAL CHANGES… Always make structural changes first when both are needed."; "Use small, frequent commits rather than large, infrequent ones."
  - [Refactoring](https://refactoring.com/) — Martin Fowler — book, confirmed via the author's own site — verified: "Its heart is a series of small behavior preserving transformations."
  - [SWE-Refactor](https://arxiv.org/abs/2602.03712) — Xu, Yang, Chen, 2026 — preprint — verified: 922 atomic versus 177 compound instances; Codex agent "only 39.4% success on compound instances". This is indirect support: it concerns task difficulty, not commit granularity.
- **Detect:**
  - `git show --stat` per commit.
  - Flag any `refactor:` commit that changes expected values in test assertions.
  - Conventional-commit types match the change class.
- **Tools:** git log/show; commitlint.
- **Applies to:** All code edits by the skill.
- **When not to apply / counterpoints:** Many tiny commits burden reviewers: squash on merge but keep the granularity on the branch. Some security fixes cannot be separated from a refactor; label them clearly and require approval.
- **Fix risk:** low

### T31-F12 — Counter the documented bias toward over-engineering: every added construct needs a concrete trigger
- **Grade:** B · **Verdict:** CORRECTED. Anthropic's statement is scoped in the docs to "Claude Opus 4.5 and Claude Opus 4.6", not to "current Claude models" in general.
- **Rationale:**
  - Anthropic documents this tendency for Opus 4.5/4.6.
  - A naive "harden everything" prompt amplifies it.
  - Practitioners report agents adding unneeded caches, duplicating logic instead of reusing it, and writing session-referential comments.
  - The rule:
    - Every construct the pass adds needs a concrete trigger: a failing test, a tool finding, or a real system boundary.
    - Validate only at boundaries.
    - No single-use helpers and no speculative configurability.
    - No docstrings or types added to untouched code.
    - No comments that narrate the session.
    - Measured complexity of touched functions must not rise. This metric gate is a design synthesis, not sourced.
- **Evidence:**
  - [Prompting best practices — Overeagerness](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — Anthropic — official_docs — verified verbatim: "Claude Opus 4.5 and Claude Opus 4.6 have a tendency to overengineer by creating extra files, adding unnecessary abstractions, or building in flexibility that wasn't requested."; sample prompt: "Don't add error handling, fallbacks, or validation for scenarios that can't happen. … Only validate at system boundaries (user input, external APIs)." and "Don't add docstrings, comments, or type annotations to code you didn't change."
  - [Assessing internal quality while coding with an agent](https://martinfowler.com/articles/exploring-gen-ai/ccmenu-quality.html) — Erik Doernenburg (martinfowler.com), 27 Jan 2026 — engineering_blog — verified verbatim:
    - "the agent wanted to introduce a completely unnecessary cache";
    - "It also 'forgot' to use existing functions to construct URLs, replicating such logic in multiple places";
    - "Without careful oversight, though, the AI agents seem to have a strong tendency to introduce technical debt".
  - [HN comment on Claude-generated comments](https://news.ycombinator.com/item?id=49055316) — ckolkey, 26 Jul 2026 — practitioner_forum — verified: "the comments Claude makes … are very referential to the current session, or reference now dead/removed code".
- **Detect:**
  - lizard / radon / ESLint complexity on touched functions, before and after.
  - `git diff --stat` to compare growth in src versus tests.
  - grep added comment lines for session-referential phrases ("previously", "we changed", "now uses").
  - Count new non-test files.
- **Tools:** lizard; radon; ESLint `complexity` rule; git diff.
- **Applies to:** All edits, especially error-handling and "robustness" changes.
- **When not to apply / counterpoints:** Some hardening legitimately adds code (boundary validation, error propagation, tests). This conflicts with users who prefer "always implement the complete robust solution". The vendor statement names specific model versions and may not describe later models.
- **Fix risk:** medium

### T31-F13 — Run analysis in fresh-context read-only subagents, keep a frozen external checklist, and end with command outputs rather than claims
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - The context-rot long-context result (8/10 → 3/10) is only trend-level (p = 0.0698), from one task and one model (Codex + gpt-5.4-mini), and a second task passed all runs. It is not evidence that "long contexts sharply reduce compliance" in general.
  - "38 of 44" counts failed rows across the whole study inventory, not only long-context runs.
  - Panickssery et al. is confirmed as NeurIPS 2024.
- **Rationale:**
  - An external, frozen checklist beat a generic self-check in a controlled comparison.
  - Failed runs usually still claim success.
  - A fresh context removes the bias of reviewing code the agent just wrote.
  - Subagents return about 1–2k-token summaries, which keeps the orchestrator small.
- **Evidence:**
  - [When and How Context Rot Appears in Coding Agents](https://arxiv.org/abs/2607.17937) — Yue Xue, Jul 2026 — preprint — abstract verified:
    - "passes 8/10 runs in a 10,991-character clean context but only 3/10 in both a 299,140-character relevant context and an equal-length irrelevant context. This 50-percentage-point difference is large but remains trend-level under two-sided Fisher tests (p = 0.0698)"
    - "A detailed external checklist passes 10/10 runs, compared with 5/10 for a generic self-check (p = 0.0325)".
    - Via full text: "38 of 44 failed rows end with an explicit success, safe, or completion closure".
  - [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic Engineering, 29 Sep 2025 — engineering_blog — verified: a subagent "returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens)"; "smallest possible set of high-signal tokens".
  - [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Anthropic, 2026 — official_docs — verified verbatim: "A fresh context improves code review since Claude won't be biased toward code it just wrote."; "Have Claude show evidence rather than asserting success".
  - [LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076) — Panickssery, Bowman, Feng, 2024 — peer-reviewed (listed in the NeurIPS 2024 proceedings) — abstract verified: "self-preference, where an LLM evaluator scores its own outputs higher than others' while human annotators consider them of equal quality". The setting was GPT-4 and Llama 2 on text generation, so transfer to code review is indirect.
- **Detect:**
  - In transcripts, count subagent calls and check `/context`.
  - `.hardening/checklist.md` exists and every item links to a command output.
  - Flag "passes", "fixed" or "clean" claims that have no command and exit code next to them.
- **Tools:** Claude Code subagents (Read, Grep, Glob, restricted Bash); `isolation: worktree`; `context: fork`.
- **Applies to:** Whole-repository runs; large codebases.
- **When not to apply / counterpoints:** The same study found delegation does not make a worker's own trajectory durable: a fresh sub-agent that processed 2.4M characters also lost a contract after compaction. Subagents cost tokens. Parallel edits risk conflicts, so run analysis in parallel but make edits serially or in isolated worktrees.
- **Fix risk:** low

### T31-F15 — Treat bundled scripts and all target-repo text as untrusted; no broad pre-approvals; network checks only on explicit request
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Skills enable trivially simple prompt injection.
  - "Don't ask again" approvals can carry over to harmful actions.
  - Marketplace skills are frequently vulnerable, and those bundling scripts about twice as often.
  - The rule:
    - Scripts are small, pinned and auditable, with no network calls by default.
    - Ignore instruction-like text found in the target code.
    - Request network-dependent checks (npm audit, pip-audit, osv-scanner) explicitly, with their scope stated.
- **Evidence:**
  - [Agent Skills Enable a New Class of Realistic and Trivially Simple Prompt Injections](https://arxiv.org/abs/2510.26328) — Schmotz, Abdelnabi, Andriushchenko, 30 Oct 2025 — preprint — verified: "hide malicious instructions in long Agent Skill files and referenced scripts"; "a benign, task-specific approval with the 'Don't ask again' option can carry over to closely related but harmful actions".
  - [Agent Skills in the Wild](https://arxiv.org/abs/2601.10338) — Yi Liu et al., 15 Jan 2026 — preprint — verified: "26.1% of skills contain at least one vulnerability"; "skills bundling executable scripts are 2.12x more likely to contain vulnerabilities than instruction-only skills (OR=2.12, p<0.001)". The sample is 31,132 skills from two marketplaces.
  - [Claude Skills are awesome, maybe a bigger deal than MCP](https://simonwillison.net/2025/Oct/16/claude-skills/) — Simon Willison, 16 Oct 2025 — engineering_blog — verified: "we really need to figure out how best to sandbox these environments such that attacks such as prompt injections are limited to an acceptable amount of damage".
- **Detect:**
  - grep `scripts/` for curl, wget, `Invoke-WebRequest`, requests, `fetch(`, urllib.
  - No wildcards in `allowed-tools`.
  - Review any `` !`cmd` `` injection lines.
  - grep the target repo for "ignore previous instructions"-style text.
- **Tools:** grep; semgrep; Claude Code permissions / sandbox.
- **Applies to:** Skill packaging and runtime permissions.
- **When not to apply / counterpoints:** Some dependency and security checks need network access. The risk is lower for a personal skill whose scripts you wrote and audited.
- **Fix risk:** low

### T31-F19 — Match the form of an instruction to the failure it prevents; keep emphasis rare; add red flags and a human checkpoint
- **Grade:** C · **Verdict:** VERIFIED (the vendor over-triggering note is scoped to Opus 4.5/4.6)
- **Rationale:**
  - Most real skills lack guards against rationalization, a validation step, and human checkpoints.
  - Practitioner A/B tests suggest prohibitions work for discipline failures but backfire on output-shape problems.
  - Vendors warn that aggressive emphasis causes over-triggering on newer models and that emphasis loses force when overused.
  - The rule:
    - For discipline failures, use short prohibitions plus a "red flags: stop" list.
    - For output shape, use positive templates.
    - Give a one-line reason per rule.
    - Keep capitalized emphasis to a handful of lines.
    - Add an explicit "ask the human" checkpoint before T1/T2 changes.
- **Evidence:**
  - [From Anatomy to Smells: An Empirical Study of SKILL.md in Agent Skills](https://arxiv.org/abs/2607.01456) — Hong, Imani, Ahmed, 1 Jul 2026 — preprint:
    - Abstract verified: "over 99% of SKILL.md files contain at least one skill smell".
    - Via full text, n = 238: Rationalization Loophole 94%, Buried Gotchas 81%, Never Asks Human 77%, No Validation Step 69%.
  - [writing-skills SKILL.md — Match the Form to the Failure](https://github.com/obra/superpowers/blob/main/skills/writing-skills/SKILL.md) — Jesse Vincent (obra/superpowers) — engineering_blog — verified: "the prohibition arm produced clearly more of the unwanted content than the recipe arm"; "appending a single nuance clause to a winning recipe degraded it from consistent to noisy".
  - [skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) — Anthropic — verified: "If you find yourself writing ALWAYS or NEVER in all caps, or using super rigid structures, that's a yellow flag".
  - [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — Anthropic — official_docs — verified (said of Opus 4.5/4.6): "If your prompts were designed to reduce undertriggering on tools or skills, these models may now overtrigger. The fix is to dial back any aggressive language."
  - [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Anthropic, 2026 — official_docs — verified: "If you emphasize many lines, none of them stands out."
- **Detect:**
  - `grep -cE '\b(MUST|NEVER|ALWAYS|CRITICAL|IMPORTANT)\b' SKILL.md`: flag if above about 5.
  - A "Red flags" section exists.
  - An output template and a human-approval step exist.
- **Tools:** grep; manual review.
- **Applies to:** Wording of SKILL.md and references.
- **When not to apply / counterpoints:** The evidence is mostly practitioner A/B tests and preprints, and it depends on the model generation. Anthropic's skill best-practices page itself suggests "using stronger language such as 'MUST filter' instead of 'always filter'" when a rule is missed.
- **Fix risk:** low

### T31-F17 — Design for a whole-repository pass: explicit scope, exclusions, risk ranking, bounded batches
- **Grade:** C · **Verdict:** CORRECTED. "The prior-art tools all look only at the diff" was overstated:
  - The code-simplifier prompt and the code-review *plugin* are diff-scoped, and the plugin treats pre-existing issues as false positives.
  - The managed Code Review product tags "Pre-existing" bugs as a severity.
  - The built-in `/code-review` accepts a path target.
- **Rationale:**
  - The main prior-art cleanup and review prompts are built around a diff or recently touched code, so their scope rules do not carry over to hardening a finished project.
  - Claude Code's `/batch` shows the supported way to split a whole-repo change into units.
  - The design:
    - An explicit scope argument.
    - Exclude generated, vendored, lockfile, migration and snapshot content.
    - Rank modules by risk.
    - Process them in bounded, independently gated batches.
- **Evidence:**
  - [code-simplifier agent](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md) — Anthropic — prompt file — verified: "Only refine code that has been recently modified or touched in the current session, unless explicitly instructed to review a broader scope."
  - [code-review plugin command](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) — Anthropic — prompt file — verified: false positives include "Pre-existing issues".
  - [Commands reference](https://code.claude.com/docs/en/commands) — Anthropic, 2026 — official_docs — verified:
    - `/simplify`: "Review the changed code for cleanup opportunities. Four review agents run in parallel, covering reuse of existing helpers, simplification, efficiency, and whether the change is at the right level of abstraction."
    - `/batch`: "decomposes the work into 5 to 30 independent units … spawns one background subagent per unit in an isolated git worktree. Each subagent implements its unit, runs tests, and opens a pull request."
  - [Code Review](https://code.claude.com/docs/en/code-review) — Anthropic, 2026 — official_docs — verified:
    - REVIEW.md skip rules: "Common candidates are generated code, lockfiles, vendored dependencies, and machine-authored branches, along with anything your CI already enforces".
    - Counter-evidence: the severity table includes "Pre-existing: A bug that exists in the codebase but was not introduced by this PR".
- **Detect:** SKILL.md defines scope handling and an exclude list. `git diff --name-only base` returns no dist, build, vendor, node_modules, generated, migrations, `*.min.js`, lockfile or `.snap` paths.
- **Tools:** git; git worktree; churn via `git log --format= --name-only | sort | uniq -c`; lizard/radon.
- **Applies to:** Finished projects, run once before release.
- **When not to apply / counterpoints:** Whole-repo sweeps create large diffs. Many teams prefer incremental "boy scout" cleanup. Hotspot (churn × complexity) prioritization is not evidenced in this topic; other topics cover it.
- **Fix risk:** medium

### T31-F18 — Prior art: what to copy and what to avoid
- **Grade:** C · **Verdict:** CORRECTED. Changes:
  - The counterpoint "an HN user called code-simplifier 'surprisingly useful'" could not be verified. It is replaced by the verified bsgeraci comment (HN 46910973).
  - Sentry's header links to Anthropic's `claude-plugins-official` copy of the agent.
  - The code-review command's gate agents are Haiku and Sonnet, its bug agents are Opus, and its `allowed-tools` are `gh` only.
- **Rationale:**
  - The primary prompts contain both strong patterns and concrete defects.
  - Anthropic-internal conventions leaked into supposedly general agents and were copied verbatim by Sentry.
  - None of the plugin prompts instructs running tests.
  - The documentation disagrees with the current prompt.
  - **Copy:**
    - From code-review:
      - its false-positive list,
      - "quote the exact rule being broken",
      - validation subagents,
      - "if not certain, do not flag".
    - From code-simplifier: its "Maintain Balance" anti-list.
    - From silent-failure-hunter: its hidden-failure checklist.
    - From pr-test-analyzer: "behavioral coverage rather than line coverage".
    - From comment-analyzer: cross-reference every comment claim against the code.
    - From `/simplify`: its four lenses.
  - **Avoid:**
    - project-specific conventions presented as universal;
    - "operate autonomously and proactively" for editing agents;
    - self-assessment presented as "verification";
    - "call out every instance, no matter how minor";
    - uncalibrated numeric scores used as thresholds.
- **Evidence:**
  - [code-simplifier.md](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/code-simplifier.md) — Anthropic — prompt file — verified:
    - "Prefer `function` keyword over arrow functions";
    - step 5 "Verify the refined code is simpler and more maintainable" (no test step);
    - "You operate autonomously and proactively";
    - the "Maintain Balance" list includes "Prioritize 'fewer lines' over readability (e.g., nested ternaries, dense one-liners)" and "Remove helpful abstractions that improve code organization".
  - [silent-failure-hunter.md](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/silent-failure-hunter.md) — Anthropic — prompt file — verified:
    - "Is there an error ID from constants/errorIds.ts for Sentry tracking?";
    - "This project has specific logging functions: logForDebugging (user-facing), logError (Sentry), logEvent (Statsig)";
    - "Call out every instance of inadequate error handling, no matter how minor";
    - checklist: "Empty catch blocks", "Catch blocks that only log and continue", "Using optional chaining (?.) to silently skip operations that might fail", "Retry logic that exhausts attempts without informing the user", "Is this a fallback to a mock, stub, or fake implementation outside of test code?".
  - [code-review plugin README](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md) versus [command](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) versus [plugins index](https://github.com/anthropics/claude-code/blob/main/plugins/README.md) — Anthropic — verified:
    - README: "Filters out issues below 80 confidence threshold", "Agent #4: Analyze git blame/history".
    - Command: Haiku gate agents, Sonnet CLAUDE.md agents, two Opus bug agents plus validation subagents, no numeric score.
    - Index: "5 parallel Sonnet agents".
  - [Sentry skills: code-simplifier](https://github.com/getsentry/skills/blob/main/skills/code-simplifier/SKILL.md) — Sentry — skill file — verified: "Based on Anthropic's code-simplifier agent" (linking to anthropics/claude-plugins-official); repeats "Prefer `function` keyword over arrow functions" and the React Props rule verbatim.
  - [pr-test-analyzer.md](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/pr-test-analyzer.md) — Anthropic — prompt file — verified: "Focus on behavioral coverage rather than line coverage"; "good tests are those that fail when behavior changes unexpectedly, not when implementation details change".
  - [comment-analyzer.md](https://github.com/anthropics/claude-code/blob/main/plugins/pr-review-toolkit/agents/comment-analyzer.md) — Anthropic — prompt file — verified: "Cross-reference every claim in the comment against the actual code implementation".
- **Detect:**
  - `grep -nE 'errorIds|logForDebugging|Statsig|Sentry|React|arrow function' SKILL.md references/*.md` (leaked conventions).
  - `grep -ni 'proactive' SKILL.md`.
  - grep for numeric confidence thresholds that lack calibration data.
  - Every "verify" step names an executable command.
- **Tools:** grep; manual prompt review.
- **Applies to:** Borrowing from Claude Code plugins and community skills.
- **When not to apply / counterpoints:** These agents were built for diff review in Anthropic's own repository, where those conventions are correct. A practitioner running code-simplifier alongside a security agent says it helps, "but you have to make sure to have end to end testing … Because some changes can break things real fast" ([HN 46910973](https://news.ycombinator.com/item?id=46910973), verified).
- **Fix risk:** low

## Practitioner voice

All items below were opened and read in full through the HN Firebase API or the original page on 2026-09-23.

- [HN 46817402 — skills rarely self-activate](https://news.ycombinator.com/item?id=46817402) — sally_glance, Jan 2026. Gemini CLI, Opencode and Claude "all seem to have trouble activating skills on their own unless explicitly prompted". Putting the docs index in AGENTS.md worked better. Supports making the skill user-invoked.
- [HN 46819397 — 5–10% skip rate](https://news.ycombinator.com/item?id=46819397) — joebates, Jan 2026. Even a narrowly named skill that Claude says it needs is skipped "about 5-10% of the time", which makes prompt changes hard to evaluate.
- [HN 46816705 — Vercel numbers disputed](https://news.ycombinator.com/item?id=46816705) — NitpickLawyer, Jan 2026. "The reported tables also don't match the screenshots": 29/33 baseline, 31/33 skills, 32/33 skills + prompt, 33/33 AGENTS.md. The differences may be too small to support the conclusion.
- [HN 47040901 — LLM-extracted "best practices" pollute context](https://news.ycombinator.com/item?id=47040901) — CharlieDigital, Feb 2026. `ConfigureAwait(false)` spread into ASP.NET application code through LLM-introspected guidance.
- [HN 47040821 — "self-generated" is not how people write skills](https://news.ycombinator.com/item?id=47040821) — dcre, Feb 2026. On SkillsBench v1: writing down lessons after a struggle differs from the benchmark condition.
- [HN 47041044 — SkillsBench tasks are not codebase refactors](https://news.ycombinator.com/item?id=47041044) — btown, Feb 2026. Tasks are "a single markdown file of instructions, plus an opaque verifier", with "No problems involving existing codebases, refactors" (v1).
- [HN 46910973 — simplifier needs end-to-end tests](https://news.ycombinator.com/item?id=46910973) — bsgeraci, Feb 2026. Running code-simplifier with a security agent helps, but "some changes can break things real fast".
- [HN 45809242 — proxy metrics get gamed](https://news.ycombinator.com/item?id=45809242) — wongarsu, Nov 2025. "the test keeps failing and I can't fix it - let's delete the test" / "let's delete the feature".
- [HN 45145334 — "let me try another approach"](https://news.ycombinator.com/item?id=45145334) — lemming, Sep 2025. After that phrase "the wheels start falling off, tests get deleted". The agent should ask instead, which supports an explicit abort/flag outlet.
- [HN 49228493 — use a separate agent for tests](https://news.ycombinator.com/item?id=49228493) — whatevaa, Aug 2026. The same LLM "will happily delete failing ones, so better use a separate agent".
- [HN 49055316 — session-referential comments](https://news.ycombinator.com/item?id=49055316) — ckolkey, Jul 2026. Claude's comments reference the current session or removed code.
- [HN 48016417 — scaffolding as "rube-goldberg machines"](https://news.ycombinator.com/item?id=48016417) — senko, May 2026. Elaborate agent-scaffolding systems get cargo-culted "wholesale". An argument for small, measured skills.
- [HN 48016781 — over-prompting only when tests show under-invocation](https://news.ycombinator.com/item?id=48016781) — CharlesW, May 2026. "demure advisory language tends to be rationalized away by LLMs". Over-prompting "shouldn't be your default".
- [Assessing internal quality while coding with an agent](https://martinfowler.com/articles/exploring-gen-ai/ccmenu-quality.html) — Erik Doernenburg, 27 Jan 2026. The agent added non-idiomatic code, an unexplained cache, and duplicated URL logic. "Without careful oversight … a strong tendency to introduce technical debt".
- [Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html) — Birgitta Böckeler, 5 Feb 2026. Configuration copied from strangers repeats or contradicts instructions; "as long as LLMs are involved, we can never be certain of anything". Hooks are the deterministic option.
- [Augmented Coding: Beyond the Vibes](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes) — Kent Beck, 25 Jun 2025. Separate structural from behavioral changes, structural first. Warning signs: loops, unrequested functionality, cheating by disabling or deleting tests.
- [Show HN: Squawk](https://news.ycombinator.com/item?id=47275781) — jack-lin, Mar 2026. Hook-based monitoring built after seeing Claude Code edit tests without reading the source, retry failing commands and oscillate between code states.

## Contradictions and open questions

**Contradictions (all sides verified unless noted):**
1. **Emphatic wording.**
   - Anthropic's skill best-practices page suggests "stronger language such as 'MUST filter' instead of 'always filter'" when a rule is missed.
   - skill-creator calls ALWAYS/NEVER in caps "a yellow flag" and says to explain why.
   - The prompting docs say Opus 4.5/4.6 over-trigger on "CRITICAL: You MUST" and advise dialing it back.
   - obra/superpowers finds prohibitions plus rationalization tables work for discipline failures but backfire on output-shape problems.
   - The SKILL.md smells study counts a missing anti-rationalization guard as a smell in 94% of skills.
2. **Explaining "why".**
   - For: skill-creator ("Explain the why"); the prompting docs ("Add context to improve performance").
   - Against: the Claude Code skills doc: "State what to do rather than narrating how or why", because skill content is a recurring token cost.
3. **Abstract versus concrete.**
   - SWE-Skills-Bench recommends "abstract guidance patterns over concrete, opinionated templates with hard-coded parameter values".
   - SkillsBench's top skills contained "executable scripts with calibrated defaults".
   - Anthropic's checklist asks that "Examples are concrete, not abstract".
   - The researcher also cited Cursor guidance here; no source was given and it was not verified.
4. **Auto-triggering.**
   - skill-creator says skills under-trigger and recommends "pushy" descriptions; Vercel saw the skill never invoked in 56% of cases.
   - The prompting docs warn newer models over-trigger with aggressive language.
   - HN practitioners report both reliable and unreliable activation.
5. **Context files and cost.**
   - [Lulla, Mohsenimofidi, Galster et al. (arXiv 2601.20404, Jan 2026)](https://arxiv.org/abs/2601.20404) found AGENTS.md "associated with a lower median runtime (Δ28.64%) and reduced output token consumption (Δ16.58%)" (10 repos, 124 PRs; verified).
   - Gloaguen et al. found context files raise inference cost by over 20% with no general success gain.
   - [Khatri (arXiv 2607.27250, Jul 2026)](https://arxiv.org/abs/2607.27250) found context strategy "does not measurably move correctness on either agent (bounded to <=10-15pp via equivalence testing)" across 288 runs with Claude Code and Codex (verified).
6. **Model-written skill content.**
   - SkillsBench v4 reports skill-creator-authored self-generated skills below the no-skill baseline; Gloaguen reports LLM-generated context files as unhelpful.
   - Anthropic's best practices recommend developing skills with Claude ("Claude A" writes, "Claude B" tests) from real sessions.
   - HN practitioners argue that lessons-learned skills differ from the benchmark condition.
7. **Size limits.**
   - Anthropic and agentskills.io: SKILL.md under 500 lines; agentskills.io also recommends under 5,000 tokens.
   - obra/superpowers: under 500 words (under 200 for frequently loaded skills).
   - SKILL.md smells study: its "Lengthy Skill Body" smell uses 5,000 words; only 1 of 238 files exceeded it.
8. **Prior-art documentation drift.**
   - The code-review plugin README describes 0–100 confidence scoring with an 80 threshold and a git-blame agent.
   - The current command uses Haiku and Sonnet gate agents, two Opus bug agents and validation subagents, with no score.
   - The plugins index says "5 parallel Sonnet agents".

**Open questions:**
- No study found here measures a whole-repository hardening or cleanup skill's effect on behavior preservation and maintainability metrics. Both skill benchmarks show small or zero average gains in software engineering (SkillsBench +11.6 pp; SWE-Skills-Bench average +1.2%, security-review 0). The skill needs its own paired evaluation.
- Does a fresh-context or different-model verifier raise precision for *cleanup* findings (dead code, duplication, simplification)? The evidence covers bug review and static-alarm triage only.
- Should this be one skill with per-language reference files, or several focused skills? SkillsBench favors ≤3 modules per skill and Codex advises "one job" per skill, but no study compares the two for code-quality work.
- How much do characterization and differential testing cost and pay off in typical TypeScript and Python projects with weak tests? Not measured in these sources.
- Are LLM-emitted confidence scores calibrated enough to threshold on? Anthropic's plugin moved from a 0–100 score to validation subagents without a documented reason.
- The harness numbers (5,000 / 25,000 tokens; 1,536 characters; 8 Stop-hook blocks) change between Claude Code versions. The skill should not depend on exact values.
- The refactoring-safety numbers come from Java studies and older or smaller models (CodeLlama through GPT-4o). Current frontier-agent rates are unknown.
- Was Vercel's 56% never-invoked rate a property of 2026 models or of that skill's description? HN commenters dispute the methodology. It matters only if the hardening skill is ever auto-invoked.

## Dropped findings

None. All 21 findings survived. Items removed or replaced inside findings:
- An unsourced "HN commenter asked whether blog comparisons were run more than once" (F01).
- The attribution "rahimnathwani" (F05), which could not be verified.
- The quote "HN user called code-simplifier 'surprisingly useful'" (F18), which could not be verified and was replaced with a verified comment.
- A non-verbatim sub-agents docs quote (F20), which was replaced with the actual wording.
- The "Cursor recommends concrete examples" mention (contradiction 3), which had no source.
