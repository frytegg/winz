# Recall, run-to-run variance and partitioning when an LLM agent audits an entire repository
> Code G202 · slug whole-repo-llm-audit · verified 2026-09-23 · counts: verified 13 / corrected 5 / downgraded 1 / dropped 0

## Summary

**Scope and method.** Every cited source was re-opened on 2026-09-23 with WebFetch, the arXiv, Crossref, OpenAlex, GitHub and HN (Firebase and Algolia) APIs, and direct PDF download plus `pdftotext` for NIST SP 800-218, the Trail of Bits report and STADS. The WebSearch budget was already used up in this session, so no new sources were found by search. Versions checked:
- NIST SSDF SP 800-218 **v1.1 (Feb 2022)**. It is still the current *final* version. SP 800-218 Rev. 1 (SSDF v1.2) is an Initial Public Draft, released 2025-12-17, with comments closed 2026-01-30 and no final version yet.
- Claude Code docs, Semgrep docs and GitHub code-scanning docs as live on 2026-09-23.
- The Claude Opus 5.5 "What's new" page.

Almost all empirical evidence concerns finding security bugs or code-review comments. No study measures whole-repo LLM recall for maintainability issues (dead code, duplication, complexity). For those issues, deterministic tools must set the coverage floor.

**What the evidence says (after verification):**

1. **A single pass has low and unstable recall.**
   - In Heelan's test, o3 found a known ksmbd bug in 8 of 100 runs on a 3.3k-LoC slice (~27k tokens) and in 1 of 100 on ~12k LoC (~100k tokens). In the small-slice runs, the other 66 were false negatives and 28 were false positives, a signal-to-noise ratio of about 1:3.5. Heelan's "~1:50 in this case" refers to the large-context run that surfaced the novel CVE-2025-37899, not to the small slice. The small slice also contained the request ingestion and dispatch code, not only the handler's callees.
   - In Semgrep's test, three identical Claude Code runs on one app (PY-APP-002) returned 3, 6 and 11 findings that "only partially overlapped". 86% of Claude Code's findings were false positives.
   - Neef et al. (2026): no model was fully consistent across 3 iterations; consistency ranged from 50% to 95%.
   - SWE-PRBench (2026, single author): frontier models detect 15–31% of human-flagged PR issues.
2. **Nondeterminism survives temperature 0** on hosted endpoints (Ouyang, TOSEM 2025; Atil 2024; Thinking Machines 2025: 80 unique completions out of 1,000). Thinking Machines shows that batch-invariant kernels remove it on self-hosted inference, but hosted APIs do not expose this. Design the audit for nondeterminism instead of trying to tune it away.
3. **Repeated independent passes raise recall, with diminishing returns.**
   - Naptime: 0.36 → 0.69 → 0.76 at 1/10/20 trajectories.
   - SWR-Bench: aggregating n=10 reviews raised recall by 118.83% and F1 by 43.67%, with diminishing returns beyond n=5 while cost grows linearly.
   - Large Language Monkeys: majority voting and reward models plateau when there is no verifier.
4. **A relevant slice beats more tokens,** but interprocedural context helps.
   - Less is better: Heelan, SWE-PRBench, CPRVul ("unstructured context frequently degrades"), LongCodeBench (29%→3%), Chroma context rot and Lost-in-the-Middle.
   - Interprocedural context helps: RepoAudit found 40 true positives vs 10 for multi-function CoT, even though that baseline was *given the functions on the buggy paths*, and 1 for single-function CoT. JitVul points the same way.
   - Heelan's novel concurrency bug appeared only in the wider-context experiment.
5. **Hybrids beat pure LLM review.**
   - IRIS: 55 vs CodeQL's 27 of 120 vulnerabilities.
   - KNighter (SOSP 2025): 92 new Linux bugs.
   - LLift: *in the 2023 arXiv preprint*, 50% precision and "appearing to have no missing bugs". The peer-reviewed OOPSLA 2024 version reports four new UBI bugs acknowledged upstream.
   - LLM false-positive filters remove 72–98% of false positives but lose some true positives (3 of 45; 3.1% of recall).
6. **Tools silently drop files.** Almanax hides `tests` directories. Semgrep's default ignore list covers `test/`, `tests/`, `*_test.go` and more, and it skips files over 1,000,000 bytes by default. Coverage must be enumerated deterministically and reconciled.

**Deliverables (unchanged except where noted):**
- **Partition unit.** Use a trust-boundary slice: an entry point plus its callees to depth ~3, kept to about 30k code tokens or less. Add a per-file sweep for code that no entry point reaches, and a cross-cutting pass for shared state, lifecycle and authorization consistency.
- **Passes.** Run 3 fresh-context passes per trust-boundary slice (5 with a cheaper model) and 1 pass elsewhere, with a hard cap of 10.
- **Merge.** Take the union and deduplicate, keeping a seen-in-k count. Never majority-vote.
- **Evidence gate.** Every finding needs a reproducer, an independently verified hop-by-hop trace, or confirmation from a static engine before anything is fixed.
- **Coverage ledger.** Build it from `git ls-files` before any LLM runs.
- **Stopping rule.** Minimum passes, plus no new verified finding, plus a species-richness estimate. Chao2 (or a jackknife estimator) is treated as a *lower bound*. With only 3 passes it will underestimate: Briand et al. warn that with too few inspectors "underestimation may be substantial".
- **Residual-risk statement.** State the passes, coverage, exclusions, defect classes checked and the published per-pass recall figures. Absence of findings is not evidence of absence.
- **Diff-scoped reviews** add no whole-repo coverage beyond the paths they actually reviewed. Claude Code `/security-review` reviews the current diff by default and other code only when given a PR, branch or path.

Most thresholds (30k tokens, 3 passes, depth 3) come from one or two experiments and are graded accordingly.

## Findings

### G202-F08 — Design for nondeterminism; do not rely on temperature 0; record every pass's configuration
- **Grade:** A · **Verdict:** VERIFIED (Ullah wording tightened: the 26% renaming result is stated for PaLM2 and GPT-4)
- **Rule:** Design for nondeterminism instead of trying to remove it. Do not rely on temperature=0, seeds or a "deterministic mode" for reproducibility. For each pass, record the model ID, effort/thinking setting, prompt hash, tool versions, date and token counts. Treat divergent reruns as expected sampling variance, not as a defect of the audit.
- **Rationale:**
  - Ullah et al. (IEEE S&P 2024) found that LLMs give non-deterministic vulnerability verdicts. Renaming functions or variables made even PaLM2 and GPT-4 give incorrect answers in 26% of cases.
  - Ouyang et al. (TOSEM 2025) found that 75.76%, 51.00% and 47.56% of tasks (CodeContests, APPS and HumanEval) had zero equal test outputs across requests. Temperature 0 reduced this but did not eliminate it.
  - Atil et al. measured accuracy variations of up to 15% under "deterministic" settings.
  - Thinking Machines found 80 unique completions out of 1,000 at temperature 0. The cause is batch-size variance on shared endpoints.
  - Anthropic's docs show that the default effort changes between model versions: Opus 5.5 defaults to `medium`, while Opus 5 defaulted to `high`. An unrecorded setting therefore changes behaviour silently.
- **Evidence:**
  - [LLMs Cannot Reliably Identify and Reason About Security Vulnerabilities (Yet?)](https://arxiv.org/abs/2312.12575) — Ullah, Han, Pujar, Pearce, Coskun, Stringhini (IEEE S&P 2024), 2024 — peer_reviewed — "Our evaluation shows LLMs provide non-deterministic responses, incorrect and unfaithful reasoning, and perform poorly in real-world scenarios… by merely changing function or variable names, or by the addition of library functions in the source code, these models can yield incorrect answers in 26% and 17% of cases, respectively." (228 code scenarios, 8 LLMs) — abstract verified verbatim.
  - [An Empirical Study of the Non-Determinism of ChatGPT in Code Generation](https://arxiv.org/abs/2308.02828) — Ouyang, Zhang, Harman, Wang, ACM TOSEM 34(2), 2025 (DOI 10.1145/3697010) — peer_reviewed — "the ratio of coding tasks with zero equal test output across different requests is 75.76%, 51.00%, and 47.56%…"; "setting the temperature to 0 does not guarantee determinism in code generation, although it indeed brings less non-determinism" — verified; venue confirmed via Crossref.
  - [Non-Determinism of "Deterministic" LLM Settings](https://arxiv.org/abs/2408.04667) — Atil et al., 2024 (rev. Apr 2025) — preprint — "accuracy variations up to 15% across naturally occurring runs with a gap of best possible performance to worst possible performance up to 70%" (5 LLMs × 8 tasks × 10 runs) — verified.
  - [Defeating Nondeterminism in LLM Inference](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/) — Horace He / Thinking Machines Lab, 2025-09-10 — engineering_blog — Qwen3-235B at temperature 0: "80 unique completions, with the most common of these occurring 78 times"; "the primary reason nearly all LLM inference endpoints are nondeterministic is that the load (and thus batch-size) nondeterministically varies." — verified. With batch-invariant kernels, all 1,000 completions were identical.
  - [What's new in Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5) — Anthropic, 2026 — official_docs — "The default effort is `medium`. A request that omits `effort` runs at `medium`; on Claude Opus 5 it ran at `high`. Set `effort` explicitly and re-run your sweep" — verified live.
- **Detect:** Check the ledger schema. Every pass row must have non-null model_id, effort, prompt_sha256, tool_versions, started_at, tokens_in and tokens_out, for example `jq '.units[].passes[] | select(.model_id==null or .effort==null or .prompt_sha256==null)' ledger.json`. Flag any audit design document that claims reproducibility via temperature=0.
- **Tools:** jq, coverage ledger.
- **Applies to:** All LLM-based audits and all providers.
- **When not to apply / counterpoints:**
  - Batch-invariant kernels make self-hosted inference reproducible (Thinking Machines), but hosted APIs used by coding agents generally do not offer this.
  - Even perfectly reproducible sampling would not fix low per-pass recall.
  - The Ouyang and Ullah measurements use 2023-era models.
- **Fix risk:** low

### G202-F07 — Evidence gate before any report or fix
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** A finding may be reported, and above all fixed, only after it passes an independent check. The check is one of:
  - a reproducer (a failing test or PoC input);
  - a source→sink / hop-by-hop trace where a separate fresh-context verifier, instructed to disprove the finding, has checked every file:line hop;
  - confirmation from a deterministic engine.

  Everything else stays "unverified" and is never auto-fixed. A fix for a false positive is pure behaviour risk.
- **Rationale:**
  - Raw LLM audit output is mostly false positives: Semgrep measured 86% (Claude Code) and 82% (Codex), IRIS had an average FDR of 84.82%, and Heelan reports a signal-to-noise ratio of ~1:50 on his large-context run (about 1:3.5 on the small curated slice: 8 true, 28 false positives).
  - curl's confirmed rate for bug-bounty submissions fell below 5% in 2025 (from "north of 15%") amid AI slop, and curl ended its bounty. This stream mixes human and AI-assisted reports, so it illustrates the problem rather than measuring raw LLM precision.
  - Removing RepoAudit's validator raised false positives by 245.5%.
  - Serious deployments all gate on validation. Anthropic "validated every bug extensively". Claude Code Security runs "multi-stage verification". Google DeepMind's CodeMender patches are "reviewed by human researchers before they're submitted upstream". Naptime relies on automatic "perfect verification".
- **Evidence:**
  - [RepoAudit (arXiv 2501.18160v3)](https://arxiv.org/html/2501.18160v3) — Guo, Wang, Xu, Su, Zhang (Purdue), 2025 — preprint — without the validator, true positives were maintained but false positives rose 245.5% (to 31) — verified.
  - [Evaluating and mitigating the growing risk of LLM-discovered 0-days](https://www.anthropic.com/research/zero-days) — Anthropic, 2026-02-05 — engineering_blog — Claude Opus 4.6: "found and validated more than 500 high-severity vulnerabilities" (vendor claim); "we validated every bug extensively before reporting it"; the team focused on memory corruption because crashes and address sanitizers make validation easy — verified.
  - [Claude Code Security](https://www.anthropic.com/news/claude-code-security) — Anthropic, 2026-02-20 — official_docs (product announcement, limited research preview) — "Every finding goes through a multi-stage verification process before it reaches an analyst. Claude re-examines each result, attempting to prove or disprove its own findings and filter out false positives." — verified verbatim.
  - [The end of the curl bug-bounty](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/) — Daniel Stenberg, 2026-01-26 — practitioner_forum — "Starting 2025, the confirmed-rate plummeted to below 5%. Not even one in twenty was real."; "Previous years we have had a rate of somewhere north of 15%…" — verified.
  - [IRIS (arXiv 2405.17238v3)](https://arxiv.org/html/2405.17238v3) — Li, Dutta, Naik, 2025 — preprint — average FDR 84.82% (IRIS) vs 90.03% (CodeQL) — verified.
  - [Introducing CodeMender](https://deepmind.google/discover/blog/introducing-codemender-an-ai-agent-for-code-security/) — Google DeepMind, 2025-10-06 — engineering_blog — "All patches generated by CodeMender are reviewed by human researchers before they're submitted upstream"; 72 upstreamed security fixes — added by verifier to back the researcher's CodeMender statement.
- **Detect:** For each reported or fixed finding, the ledger must hold evidence_type ∈ {test, poc, verified_trace, static_confirm} and a verifier transcript ID that differs from every detection pass. It is a violation if a fix commit's finding has evidence_type=null. Check with a join of `git log` and the ledger. For example, require the finding ID in the commit message and a new or changed test in the same commit (`git show --stat <sha> | rg -n "test"`).
- **Tools:** coverage ledger, git, project test runner.
- **Applies to:** All findings, especially those that lead to code changes in a finished, working project.
- **When not to apply / counterpoints:**
  - LLM verifiers also reject true positives: LLM4PFA missed 3 of 45 real bugs and QASecClaw lost 3.1% of recall (see F13).
  - Some real issues, such as design flaws or missing authorization, resist a PoC. Report them as "unverified, needs human" rather than dropping them.
  - False-positive rates vary by tool: Stenberg found "remarkably few" complete false positives in the ZeroPath-assisted curl reports.
- **Fix risk:** low

### G202-F05 — Several independent fresh-context passes, union of findings
- **Grade:** B · **Verdict:** VERIFIED (SWR-Bench's diminishing-returns observation added)
- **Rule:** Run several independent passes, each in a fresh context with its own reasoning trajectory, and take the union of their findings.
  - Default: 3 passes per trust-boundary or hotspot slice (5 with a cheaper model) and 1 pass for the remaining units.
  - Extend a unit to at most 10 passes, and only while the stopping rule (F16) says discovery continues.
- **Rationale:**
  - Recall rises with independent samples, with diminishing returns. Naptime's GPT-4 Turbo advanced memory corruption score went 0.36 (1 trajectory) → 0.69 (10) → 0.76 (20).
  - SWR-Bench: aggregating n=10 reviews raised Gemini-2.5-Flash recall by 118.83% (to 30.44%) and F1 by 43.67%. Five Flash reviews beat one Pro review at lower cost. The authors observe "diminishing returns beyond n=5, while costs continue to scale linearly".
  - Large Language Monkeys: coverage on SWE-bench Lite rose from 15.9% (1 sample) to 56% (250), roughly log-linearly.
  - If passes were independent (they are not fully), Heelan's 8%-per-run bug would be caught by at least one of 3 runs ≈22% of the time and by at least one of 10 ≈57% of the time. This is derived arithmetic: 1−0.92^k.
  - Practitioners deliberately re-scan to exploit nondeterminism.
- **Evidence:**
  - [Project Naptime](https://projectzero.google/2024/06/project-naptime.html) — Glazunov & Brand, Google Project Zero, 2024-06-20 — engineering_blog — Advanced Memory Corruption, GPT-4 Turbo: @1 0.36, @10 0.69, @20 0.76; "a sampling strategy that allows models to explore multiple hypotheses through multiple independent trajectories, enabled by integrating verification within the end-to end system" — verified.
  - [SWR-Bench (arXiv 2509.01494v2)](https://arxiv.org/html/2509.01494v2) — Zeng et al. (Peking University et al.), 2025 — preprint — "Gemini-2.5-Flash with Self-Agg (n=10) achieved an F1 of 21.91% (a 43.67% increase) and a Recall of 30.44% (a 118.83% increase)"; Self-Agg (n=5) F1 20.48% > single-pass Gemini-2.5-Pro 19.38% "at a lower API cost"; "performance gains exhibit diminishing returns beyond n=5" — verified in the HTML (baseline Flash: P 16.88 / R 13.91 / F1 15.25).
  - [Large Language Monkeys](https://arxiv.org/abs/2407.21787) — Brown, Juravsky, Ehrlich, Clark, Le, Ré, Mirhoseini, 2024 — preprint — "from 15.9% with one sample to 56% with 250 samples"; coverage vs samples "is often log-linear" — verified.
  - [LLM engineer review of AI SAST tools](https://joshua.hu/llm-engineer-review-sast-security-ai-tools-pentesters) — Joshua Rogers, 2025-09-18 — practitioner_forum — "Perform a full repo scan _again_. I want to take advantage of the indeterministic nature of these systems, so scanning again and again can reveal interesting things just based on literal randomness." — verified verbatim.
- **Detect:**
  - In the ledger, check that passes_completed ≥ required_passes for each tier.
  - Check that each pass has a distinct transcript or subagent ID (fresh context) and was not a continuation of the previous pass's conversation.
  - Compute the per-unit overlap (Jaccard of finding keys) between passes. A near-1.0 overlap on every unit suggests the passes are not independent, for example because they share a cached context or prompt.
- **Tools:** coverage ledger; Claude Code subagents (fresh context per invocation).
- **Applies to:** All LLM detection passes. The pass count scales with the unit's risk tier.
- **When not to apply / counterpoints:**
  - Passes by the same model with the same prompt are correlated, so the independence arithmetic overstates union recall.
  - Varying the prompt focus (F14) or the model (SWR-Bench Multi-Agg) likely helps, but this is unmeasured for audits.
  - False positives grow with k: Heelan saw 28 false-positive reports in 100 runs even on the small slice.
  - SWR-Bench's diminishing returns beyond n=5 suggest the 10-pass cap is generous.
- **Fix risk:** low

### G202-F01 — One pass is one noisy sample, not an audit
- **Grade:** B · **Verdict:** VERIFIED (wording tightened: "effectively random" became "varies substantially run to run")
- **Rule:** Treat every single LLM/agent pass over a unit as one noisy sample, not as an audit. Never record a unit as "clean", or a repository as "audited", on the basis of one pass. Every "no findings" statement must carry the number of passes and the unit it covers.
- **Rationale:**
  - Heelan: a frontier model detected a known bug in 8/100 runs on a curated 3.3k-LoC slice and in 1/100 runs on 12k LoC.
  - Semgrep: three identical Claude Code runs on one app returned 3, 6 and 11 findings that "only partially overlapped".
  - Neef et al. 2026: no model was fully consistent across 3 iterations. Consistency ranged from 50% (Qwen self-hosted) to 95% (Gemini); Claude was at 75%.
  - SWE-PRBench: on real PRs, frontier models detect only 15–31% of human-flagged issues.
  - Per-pass recall is therefore low, and which bugs a pass finds varies substantially from run to run.
- **Evidence:**
  - [How I used o3 to find CVE-2025-37899…](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/) — Sean Heelan, 2025-05-22 — engineering_blog — "o3 finds the kerberos authentication vulnerability in the benchmark in 8 of the 100 runs. In another 66 of the runs o3 concludes there is no bug present in the code (false negatives), and the remaining 28 reports are false positives."; "o3 finds the kerberos authentication vulnerability in 1 out of 100 runs with this larger number of input tokens" — verified verbatim.
  - [Finding vulnerabilities in modern web apps using Claude Code and OpenAI Codex](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex/) — Semgrep (Gaucher, Ermilov, Gibler), 2025-09-02 — engineering_blog — PY-APP-002 with identical prompts: 3, then 6, then 11 findings; "Each run presented different findings that only partially overlapped"; "The inability to reproduce results makes it difficult to verify the AI's findings and to trust its output in a consistent, repeatable manner." — verified.
  - [Evaluating LLMs for Real-World Web Vulnerability Detection](https://arxiv.org/abs/2606.21397) — Neef, Jungnickel, Buchholz, Spence, Birke Gonzalez, 2026-06-19 — preprint — "no model achieved full reporting consistency across three experiment iterations, with some as low as 50%"; Opus 4.6 highest detection rate at 63% (4 WordPress plugins with known CVEs); Gemini 95%, Codex 85%, Claude 75%, MiniMax 75%, Qwen 50% consistency — verified in abstract and HTML.
  - [SWE-PRBench](https://arxiv.org/abs/2603.26130) — Deepak Kumar (independent, single author), 2026-03-27 — preprint — "8 frontier models detect only 15-31% of human-flagged issues on the diff-only configuration" — verified.
- **Detect:**
  - In the coverage ledger (F09), flag every unit with status=examined AND verdict=clean AND passes_completed < required_passes (3 for trust-boundary slices, 1 elsewhere).
  - In the final report, search for unqualified absence claims (`rg -n -i "no (issues|vulnerabilities|bugs) (found|detected)|codebase is (clean|secure)" report.md`). Require each one to cite the pass count and the unit IDs it covers.
- **Tools:** coverage ledger (JSON/CSV), ripgrep.
- **Applies to:** Any whole-repo LLM or agent audit, in any language, at 10k–200k LOC. The evidence is strongest for security defects.
- **When not to apply / counterpoints:**
  - Models improve quickly: Neef et al. measured 63% detection for Opus 4.6 on known WordPress-plugin vulnerabilities, and Stenberg reported high-quality AI-assisted findings on curl.
  - For low-risk code already covered by deterministic linters or SAST, one LLM pass may be an acceptable supplement if the ledger says so.
  - SWE-PRBench measures diff review, not whole-repo audit.
- **Fix risk:** low

### G202-F04 — Curate context by relevance, not volume
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Curate context by relevance, not volume.
  - Give the pass the slice's code, the definitions of the types it touches, and a short structured summary of callers and trust assumptions.
  - Do not paste whole directories or the whole repo "for context".
  - Put the code under review at the beginning or end of the prompt, not buried in the middle.
- **Rationale:**
  - Adding unrelated code lowered recall in controlled settings. Heelan's 8/100 fell to 1/100. In SWE-PRBench, a 2,000-token structured prompt beat a 2,500-token full-context prompt across all 8 models (Sonnet 4.6: 0.190 vs 0.122).
  - CPRVul: unstructured context degrades strong fine-tuned models, while structured context plus reasoning helps.
  - Chroma measured degradation with input length, and with even one distractor, across 18 models.
  - Lost-in-the-Middle shows a U-shaped position effect.
  - Relevant interprocedural context does help (RepoAudit, JitVul), so the variable to control is relevance, not size.
- **Evidence:**
  - [SWE-PRBench (v1 HTML)](https://arxiv.org/html/2603.26130v1) — Deepak Kumar, 2026 — preprint — "a structured 2,000-token diff-with-summary prompt outperforms a 2,500-token full-context prompt… across all 8 models"; Sonnet 4.6 0.190 (diff) vs 0.122 (full context) — verified.
  - [CPRVul (arXiv 2602.06751)](https://arxiv.org/abs/2602.06751) — Yikun Li … David Lo, 2026-02-06 — preprint — "unstructured context frequently degrades the performance of strong fine-tuned code models"; PrimeVul accuracy 55.17% → 67.78% — verified.
  - [Context Rot](https://www.trychroma.com/research/context-rot) — Hong, Troynikov, Huber (Chroma), July 2025 — industry_report — 18 LLMs; "Model performance degrades as input length increases, often in surprising and non-uniform ways"; "even a single distractor reduces performance relative to the baseline" — verified.
  - [Lost in the Middle](https://arxiv.org/abs/2307.03172) — Liu et al. (Stanford), TACL vol. 12 pp. 157–173, 2024 (DOI 10.1162/tacl_a_00638) — peer_reviewed — "performance is often highest when relevant information occurs at the beginning or end of the input context" — verified; venue confirmed via Crossref. Measured on QA and key-value retrieval, not on code.
  - [JitVul (arXiv 2503.03586)](https://arxiv.org/abs/2503.03586) — Yildiz, Teo, Lou, Feng, Wang, Divakaran, 2025 — preprint — "ReAct Agents, leveraging thought-action-observation and interprocedural context, perform better than LLMs in distinguishing vulnerable from benign code" — verified (abstract only; 879 CVEs, 91 types).
- **Detect:** Log each pass's prompt manifest (files and line ranges included). Compute the share of included lines that the call graph reaches from the slice root. Flag passes where under ~50% of the included code is slice-reachable, or where whole directories were concatenated. The 50% cutoff is a heuristic, not a measured value.
- **Tools:** prompt manifest in ledger; CodeQL or pyan3 call graph.
- **Applies to:** Every LLM pass. It matters most when a large context window tempts the auditor to include everything.
- **When not to apply / counterpoints:**
  - Context helps when it is the right context: RepoAudit, JitVul and SecVulEval all stress interprocedural context, and Heelan's novel bug appeared only with more code.
  - SWE-PRBench is a single-author preprint about diff review.
  - Lost-in-the-Middle's position effect is extrapolated from QA tasks to code review.
- **Fix risk:** low

### G202-F12 — Hybrid by default: deterministic analyzers set the coverage floor, the LLM adds semantics
- **Grade:** B · **Verdict:** CORRECTED. The LLift attribution was fixed: the 50% precision and "no missing bugs" figures come from the 2023 arXiv preprint "The Hitchhiker's Guide to Program Analysis". The peer-reviewed PACMPL/OOPSLA 2024 paper (DOI 10.1145/3649828) is titled "Enhancing Static Analysis for Practical Bug Detection: An LLM-Integrated Approach", and its abstract reports four previously undiscovered UBI bugs acknowledged by the Linux community. It does not restate the 50%/no-missing figures. KNighter's venue (SOSP 2025) was added.
- **Rule:** Use a hybrid as the default detection engine.
  - Deterministic analyzers provide the exhaustive coverage floor over every file: CodeQL or Semgrep for flows; linters and dead-code and duplication tools for maintainability.
  - The LLM infers project-specific specs (sources, sinks, sanitizers, bug patterns), triages analyzer alerts and reviews the slices.
  - Do not use the LLM as the only coverage mechanism.
- **Rationale:**
  - IRIS (GPT-4 inferring taint specs, CodeQL doing the flow analysis) found 55 of 120 CWE-Bench-Java vulnerabilities vs CodeQL's 27, with an FDR 5 points lower.
  - KNighter synthesized static checkers from past patches and found 92 new Linux bugs (77 confirmed, 57 fixed, 30 CVEs).
  - LLift's preprint reports 50% precision on ~1,000 UBI candidates, "appearing to have no missing bugs". The peer-reviewed version reports 4 new bugs.
  - Tencent's industrial study found that hybrids eliminate 94–98% of false positives.
  - Pure-LLM whole-repo runs showed weak inter-procedural taint tracking (Semgrep).
- **Evidence:**
  - [IRIS (arXiv 2405.17238)](https://arxiv.org/abs/2405.17238) — Ziyang Li, Saikat Dutta, Mayur Naik, 2024–2025 (v3 Apr 2025) — preprint — "IRIS with GPT-4 detects 55 (+28)" vs CodeQL 27; "improves upon CodeQL's average false discovery rate by 5% points"; F1 0.177 vs 0.076; "there are still many vulnerabilities that IRIS cannot detect" — verified.
  - [KNighter (arXiv 2503.09002)](https://arxiv.org/abs/2503.09002) — Chenyuan Yang, Zijie Zhao, Zichen Xie, Haoyu Li, Lingming Zhang, SOSP 2025 — peer_reviewed — 92 new Linux kernel bugs (avg. 4.3 years old), 77 confirmed, 57 fixed, 30 CVEs — verified.
  - [The Hitchhiker's Guide to Program Analysis (LLift preprint)](https://arxiv.org/abs/2308.00245) — Haonan Li, Yu Hao, Yizhuo Zhai, Zhiyun Qian, 2023 — preprint — "analyzing nearly a thousand potential UBI bugs… showcasing a reasonable precision (50%) and appearing to have no missing bugs. It even identified 13 previously unknown UBI bugs in the Linux kernel." — verified. **Correction:** the peer-reviewed version (PACMPL 8 OOPSLA1, 2024, DOI 10.1145/3649828, Crossref) is a differently titled paper whose abstract reports "four previously undiscovered UBI bugs in the mainstream Linux kernel". The full text was not accessible (ACM DL returned 403).
  - [Reducing False Positives in Static Bug Detection with LLMs (arXiv 2601.18844)](https://arxiv.org/abs/2601.18844) — Du, Feng, Zou, Xu, Ma, Zhang, Liu, Peng, Lou (Fudan/Tencent), 2026-01-26 — preprint — 433 alarms (328 FP, 105 TP); "hybrid techniques of LLM and static analysis eliminate 94-98% of false positives with high recall"; 2.1–109.5 s per alarm — verified.
- **Detect:** Check that the audit plan lists at least one deterministic analyzer per language in scope, and that its coverage (F09) is at or near 100% of in-scope files. Check that LLM-inferred specs (custom Semgrep rules, CodeQL models-as-data) are saved as files so the scan can be re-run deterministically. Flag audits whose only detector is the LLM.
- **Tools:** CodeQL, Semgrep, language linters, dead-code and duplication detectors.
- **Applies to:** All languages with a mature static analyzer. For maintainability findings (dead code, duplication, complexity), the deterministic tools are the primary source and the LLM judges.
- **When not to apply / counterpoints:**
  - Static engines need build and extraction to succeed. In RepoAudit's comparison, Meta Infer failed to build 2 of 15 projects and crashed on 5 more; compilation-free LLM analysis exists for this reason.
  - IRIS still had an FDR of ~85%, so hybrids need the evidence gate too.
  - LLift's strongest numbers are preprint-only.
- **Fix risk:** low

### G202-F09 — Coverage ledger built deterministically before any LLM runs
- **Grade:** B · **Verdict:** CORRECTED, in four places:
  1. `/security-review` is no longer diff-only. Current docs say "Review the current diff, or a PR number, branch, or path you pass". The researcher's quote "Check the diff for security vulnerabilities" is outdated.
  2. GitHub's file-percentage view applies "For integrated tools such as CodeQL".
  3. Semgrep's `--x-ls` / `--x-ls-long` are flags marked **[INTERNAL]**. The skipped-file list with reasons comes from `--x-ls-long`. The size cap is `--max-target-bytes`, default 1,000,000 bytes.
  4. SSDF v1.1 is still the current final version; v1.2 exists only as a Dec 2025 draft.
- **Rule:** Build a coverage ledger before any LLM runs.
  - Enumerate every in-scope unit deterministically: `git ls-files` minus an explicit, justified exclusion list, then slices per F02.
  - Record for each unit: unit_id, kind (entry-slice | file | cross-cutting), root symbol, files and line ranges, git blob SHA, LOC, estimated tokens, risk tier, defect classes checked, passes (per F08), status (examined | partial | failed | skipped-budget | excluded + reason) and findings (raw, verified, rejected, suppressed).
  - Report coverage both as examined_units/in_scope_units and as examined_LOC/in_scope_LOC.
  - A diff-scoped review adds nothing to whole-repo coverage beyond the files it actually reviewed. Claude Code `/security-review` defaults to the current diff; when it is pointed at a path, count only that path.
- **Rationale:**
  - NIST SSDF PW.7.2 requires performing code review and/or analysis and to "record and triage all discovered issues".
  - Mature tools expose per-file coverage. GitHub's tool-status page gives integrated tools such as CodeQL a percentage of files scanned per language and a per-file CSV that records extraction success. Semgrep can list skipped targets with reasons.
  - Tools also drop files silently. Semgrep's default ignore list covers test paths, and it skips files over ~1 MB. Almanax hid any `tests` directory. Corgea ignored files that looked deliberately vulnerable.
  - Professional audit reports carry explicit coverage-limitation sections.
- **Evidence:**
  - [NIST SP 800-218 SSDF Version 1.1](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf) — Souppaya, Scarfone, Dodson (NIST), Feb 2022 — standard — PW.7.2: "Perform the code review and/or code analysis based on the organization's secure coding standards, and record and triage all discovered issues and recommended remediations in the development team's workflow or issue tracking system." — verified verbatim from the PDF. Version note: SP 800-218 Rev. 1 (SSDF v1.2) is an [Initial Public Draft](https://csrc.nist.gov/pubs/sp/800/218/r1/ipd) from 2025-12-17 and not yet final.
  - [About the tool status page for code scanning](https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/about-the-tool-status-page) — GitHub Docs, live 2026 — official_docs — "For integrated tools such as CodeQL, you can see a percentage total of all the files most recently scanned in your repository, organized by programming language."; the CSV includes "Whether the file was successfully extracted" — verified.
  - [Ignore files, folders, and code](https://docs.semgrep.dev/ignoring-files-folders-code) — Semgrep Docs, live 2026 — official_docs — default `.semgrepignore` includes "# Common test paths: test/ tests/ testsuite/ *_test.go"; large files are skipped (default 1 MB); JSON `paths.skipped` — verified.
  - [Semgrep CLI reference](https://docs.semgrep.dev/cli-reference) — Semgrep Docs, live 2026 — official_docs — `--x-ls`: "[INTERNAL] List the selected target files before any rule-specific or language-specific filtering. Then exit."; `--x-ls-long`: "[INTERNAL] Show selected targets and skipped targets with reasons why they were skipped, using an unspecified output format"; `--max-target-bytes` "Defaults to 1000000 bytes" — added by verifier.
  - [LLM engineer review of AI SAST tools](https://joshua.hu/llm-engineer-review-sast-security-ai-tools-pentesters) — Joshua Rogers, 2025-09-18 — practitioner_forum — "Almanax also silently drops many files from being scanned (for example: any directory names `tests` will not even be visible in the UI…"; Corgea: "our system will ignore any files which seem to be deliberately vulnerable, being used simply to test the detection" — verified verbatim.
  - [Go Cryptographic Libraries Security Review](https://github.com/trailofbits/publications/raw/master/reviews/2025-03-google-gocryptographiclibraries-securityreview.pdf) — Trail of Bits for Google, 2025-03-27 — industry_report — "Because of the time-boxed nature of testing work, it is common to encounter coverage limitations. The following list outlines the coverage limitations of the engagement and indicates system elements that may warrant further review" — verified from the PDF.
  - [Claude Code commands reference](https://code.claude.com/docs/en/commands) — Anthropic, live 2026 — official_docs — `/security-review [effort] [--fix] [--comment] [pr#|branch|path]`: "Review the current diff, or a PR number, branch, or path you pass, for security vulnerabilities. Depending on your model and effort level, the review covers different classes of vulnerabilities." — **corrected quote**.
- **Detect:**
  1. Run `git ls-files > inscope.txt` and subtract the exclusion list. Every excluded path must appear in the ledger with a reason.
  2. Run `comm -23 <(sort inscope.txt) <(jq -r '.units[].files[].path' ledger.json | sort -u)`. Any output is an unaccounted file.
  3. For companion SAST, compare the Semgrep JSON `paths.skipped` (or `--x-ls-long`, which is internal and whose format is unspecified) or the CodeQL tool-status CSV against inscope.txt.
  4. Flag any unit whose blob SHA changed after its last pass (stale coverage).
- **Tools:** git ls-files, git hash-object, jq, comm, Semgrep JSON output (`paths.skipped`), GitHub code scanning tool-status CSV (CodeQL).
- **Applies to:** Every whole-repo sweep. The ledger is also the input to the residual-risk statement (F19).
- **When not to apply / counterpoints:**
  - "Examined" coverage measures exposure, not detection quality; a unit can be read and still missed (F01).
  - Excluding vendored or generated code is legitimate, but the exclusion must be explicit.
  - Internal Semgrep flags may change without notice.
- **Fix risk:** low

### G202-F06 — Merge by union plus deduplication, never by majority vote
- **Grade:** B · **Verdict:** CORRECTED, in two places:
  1. Heelan does not quantify how often the novel CVE appeared. He says only that it was found "in the output from the other runs" of the large-context experiment, so the "about 1%" figure was removed.
  2. SWR-Bench does not show precision holding up. The authors say the gain came mostly in recall and that improving precision "remains a key priority".
- **Rule:** Take the union and deduplicate; never use a majority vote.
  - Normalize each raw finding to a key: file, enclosing symbol, line range, defect class/CWE and a one-line root cause.
  - Cluster duplicates and keep seen_in_passes, the number of passes that reported the cluster.
  - Send every cluster to verification, including those seen once.
  - If an LLM aggregator is used for deduplication, log which raw findings it dropped.
- **Rationale:**
  - True bugs are often found by a minority of passes. Heelan's known bug appeared in 8% of small-slice runs and 1% of large-context runs, and the novel CVE surfaced in some unquantified subset of the large-context runs. A majority vote would erase exactly these.
  - Large Language Monkeys shows that majority voting and reward-model selection plateau without a verifier.
  - The gains in SWR-Bench came from LLM synthesis over the concatenated reviews, not from voting, and they were concentrated in recall.
  - seen_in_passes also feeds the stopping estimator (F16).
- **Evidence:**
  - [Large Language Monkeys](https://arxiv.org/abs/2407.21787) — Brown et al., 2024 — preprint — "majority voting and reward models plateau beyond several hundred samples and fail to fully scale with the sample budget" (domains without automatic verifiers) — verified.
  - [How I used o3 to find CVE-2025-37899](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/) — Sean Heelan, 2025 — engineering_blog — known bug 8/100 (small), 1/100 (large); "More interestingly however, in the output from the other runs I found a report for a similar, but novel, vulnerability that I did not previously know about." — verified; no rate is given for the novel bug.
  - [SWR-Bench](https://arxiv.org/html/2509.01494v2) — Zeng et al., 2025 — preprint — "all n reports are concatenated into a single input, and an LLM is prompted with a meta-instruction to synthesize them into a single, superior review"; "This larger gain in Recall indicates Multi-Review's effectiveness in identifying more true defects. However, to further boost the F1 score, enhancing Precision by reducing false positives remains a key priority" — verified.
- **Detect:** Check the merge script or log. Any filter such as count ≥ ceil(k/2), "confirmed by majority" or "appears in 2+ runs" applied before verification is a violation. Check that the ledger stores raw_finding_ids per pass and a cluster→raw mapping. Check that the number of seen_in_passes=1 clusters that reached verification equals the number produced.
- **Tools:** jq, coverage ledger.
- **Applies to:** Any multi-pass or multi-model audit.
- **When not to apply / counterpoints:** A union sends the maximum number of false positives to verification (86% false positives in Semgrep's single-pass data), so verification capacity limits k. seen_in_passes is a reasonable ranking signal for triage order, but it must not be used as a filter.
- **Fix risk:** low

### G202-F02 — Default partition unit is a trust-boundary slice
- **Grade:** B · **Verdict:** VERIFIED. Clarification added: RepoAudit's multi-function CoT baseline was *given the functions on the buggy program paths*, which is oracle context, and still found only 10 true positives. (audit correction: Heelan's winning slice also contained the ingestion and dispatch path, the code that reads data off the wire, parses the request, selects the handler and tears down the connection, not only the handler's callees; and his ~1:50 signal-to-noise ratio refers to the large-context run, while the small slice's own ratio was 8 TP to 28 FP, about 1:3.5.)
- **Rule:** The default partition unit is a trust-boundary slice: one externally reachable entry point plus the code it calls down to a call depth of about 3, plus the path that brings input to it (reading off the wire or input source, parsing, dispatch to the handler, teardown). Entry points include HTTP routes, RPC/CLI handlers, message consumers, file and network parsers, and public library APIs.
  - Keep a slice to roughly 30k code tokens or less; split handlers whose slice exceeds that.
  - Code that no entry point reaches gets a per-file or per-module sweep instead.
- **Rationale:**
  - In Heelan's 100-run experiment, a handler plus its callees to depth 3, together with the code that reads data off the wire, parses the request, selects the handler and tears down the connection (3.3k LoC, ~27k tokens), found the target bug 8× more often than all handlers together (12k LoC, ~100k tokens): 8/100 vs 1/100. The counts are small. Heelan included the ingestion and dispatch path because without it "the LLM would have to guess... and that would lead to more false positives". Token density: 27k/3.3k ≈ 8.2 and 100k/12k ≈ 8.3 tokens per LoC.
  - RepoAudit explores the call graph one function at a time. It found 40 true bugs at 78.43% precision, versus 10 for multi-function CoT given the buggy-path functions and 1 for single-function CoT.
  - Vulnhuntr likewise follows "the entire call chain from user input to server processing".
  - Long-context benchmarks show performance falling as context grows.
- **Evidence:**
  - [How I used o3 to find CVE-2025-37899](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/) — Sean Heelan, 2025 — engineering_blog — "I gave the LLM the code for the 'session setup' command handler, including the code for all functions it calls, and so on, up to a call depth of 3 (this being the depth required to include all of the code necessary to reason about the vulnerability)."; the slice also included "all of the code for the functions that read data off the wire, parses an incoming request, selects the command handler to run, and then tears down the connection", because otherwise "the LLM would have to guess... and that would lead to more false positives"; ~3.3k LoC ≈27k tokens → 8/100 (66 false negatives, 28 false positives); ~12k LoC ≈100k tokens → 1/100 — verified verbatim; the ingestion-path sentence was added by the citation audit.
  - [RepoAudit (arXiv 2501.18160v3)](https://arxiv.org/html/2501.18160v3) — Guo, Wang, Xu, Su, Zhang (Purdue), 2025 — preprint — demand-driven exploration that analyzes "one function at a time"; 40 TP / 11 FP (78.43%); CoT single-function 1 TP; CoT multi-function (given "the relevant functions covered by the buggy program paths") 10 TP; RepoAudit "limits flow analysis to a maximum of four functions", which "may cause it to miss complex bugs involving longer call chains" — verified.
  - [vulnhuntr README](https://github.com/protectai/vulnhuntr) — Protect AI, 2024 — official_docs — "It continues doing this until the entire call chain from user input to server processing is complete then gives a final analysis" — verified. Status: not archived, but the last push was 2025-02-06 (GitHub API), so it is stale as a tool and cited here only as a design reference.
  - [LongCodeBench (arXiv 2505.07897)](https://arxiv.org/abs/2505.07897) — Rando et al., 2025 — preprint — "performance drops such as from 29% to 3% for Claude 3.5 Sonnet, or from 70.2% to 40% for Qwen2.5" — verified.
- **Detect:**
  1. Enumerate entry points deterministically, for example:
     - Python: `rg -n "@(app|router|bp|api)\.(get|post|put|patch|delete|route)\("`
     - JS/TS: `rg -n "\b(app|router)\.(get|post|put|patch|delete|all|use)\("`
     - Go: `rg -n "func .*\(w http\.ResponseWriter"`
     - Also CLI mains, queue consumers and exported public API.
  2. Build callee slices with a call-graph tool (CodeQL, golang.org/x/tools/cmd/callgraph, pyan3, the TS compiler API).
  3. Estimate tokens at ≈8.2–8.3 tokens/LoC (from Heelan's C figures) or with the provider's token-counting endpoint. Flag slices above ~30k tokens for splitting.
  4. Any in-scope file that appears in no slice goes onto the per-file sweep list.
- **Tools:** ripgrep, ast-grep, CodeQL, pyan3, go callgraph, token counting API.
- **Applies to:** Services, CLIs and libraries with identifiable entry points. For pure libraries, use exported functions as roots.
- **When not to apply / counterpoints:**
  - The 30k-token and depth-3 figures come from one experiment (Heelan, on C kernel code) and one tool design (RepoAudit, whose depth limit caused misses).
  - Slicing hides cross-slice interactions: Heelan's novel concurrency CVE surfaced only in the 12k-LoC experiment (see F03).
  - Dynamic dispatch and reflection make call graphs incomplete.
- **Fix risk:** low

### G202-F13 — Measure the recall that LLM filtering costs
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** When an LLM filters or suppresses findings, whether from SAST or from other passes, measure and report the recall it costs. Keep every suppressed finding in the ledger with the verifier's reason. Never let an LLM auto-suppress a high-severity finding without a human or a deterministic check.
- **Rationale:** LLM false-positive filters are effective but lossy.
  - LLM4PFA filtered 72–96% of false positives yet missed 3 of 45 real bugs.
  - QASecClaw cut Semgrep's false positives by 88.6% (560 to 64) at the cost of a 3.1% recall reduction.

  Knowing the loss rate is what makes the residual-risk statement honest.
- **Evidence:**
  - [Minimizing False Positives in Static Bug Detection via LLM-Enhanced Path Feasibility Analysis (arXiv 2506.10322)](https://arxiv.org/abs/2506.10322) — Du, Yu, Wang, Zou, Deng, Ou, Peng, Zhang, Lou, 2025-06-12 — preprint — "LLM4PFA precisely filters out 72% to 96% false positives… only misses 3 real bugs of 45 true positives" — verified.
  - [QASecClaw (arXiv 2605.01885)](https://arxiv.org/abs/2605.01885) — Ameen, Alam, Islam, 2026-05-03 — preprint — OWASP Benchmark v1.2 (2,740 Java cases): F1 90.93% vs Semgrep 78.39%; FP 560→64 (−88.6%); recall −3.1% — verified.
- **Detect:** In the ledger, count(findings where status=suppressed_by_llm) must be reported, each with a reason and a severity. Flag any suppressed finding with severity ≥ high and no human_ack or static_confirm field. If the project has known historical bugs (fix commits), replay a sample through the filter to estimate its loss rate.
- **Tools:** coverage ledger; git log (historical fixes as seeded bugs).
- **Applies to:** Any pipeline where an LLM triages, deduplicates or verifies candidate findings.
- **When not to apply / counterpoints:** Both studies use benchmarks (OWASP Benchmark) or specific bug types. Loss rates on a real mixed codebase are unknown and could be higher. QASecClaw is a small-team 2026 preprint.
- **Fix risk:** medium

### G202-F15 — Order hotspot-first, but never filter by hotspot
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Order the sweep hotspot-first, but never filter by hotspot.
  - Rank units by trust-boundary exposure, then by relative churn × complexity, then by proximity to past fix or security commits.
  - Run variant analysis seeded by those past fixes.
  - Every in-scope unit still receives its minimum passes before the audit is called complete.
- **Rationale:**
  - Relative churn predicts defect density: Nagappan & Ball report 89.0% accuracy in discriminating fault-prone binaries.
  - Low-quality code carries 15× more defects (Tornhill & Borg, 39 codebases). This is a correlation.
  - Big Sleep's SQLite find came from variant analysis over recent commits, Anthropic's 0-day work used git history (the GhostScript example), and KNighter built checkers from past patches.
  - Order therefore matters when the budget runs out. But KNighter's bugs averaged 4.3 years old, and curl's AI-found bugs included a GSSAPI leak that had existed "for over a decade", so stable code is not clean code.
- **Evidence:**
  - [Use of Relative Code Churn Measures to Predict System Defect Density](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/) — Nagappan, Ball (Microsoft Research, ICSE 2005) — peer_reviewed — "our code churn metric suite is able to discriminate between fault and not fault-prone binaries with an accuracy of 89.0 percent" (Windows Server 2003) — verified.
  - [Code Red (arXiv 2203.04374)](https://arxiv.org/abs/2203.04374) — Tornhill, Borg, TechDebt 2022 — peer_reviewed — "low quality code contains 15 times more defects than high quality code" (39 codebases, 30,737 files) — verified.
  - [From Naptime to Big Sleep](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html) — Big Sleep team (Project Zero & DeepMind), 2024-11-01 — engineering_blog — variant analysis from recent SQLite commits; "The issue remained undiscovered after 150 CPU-hours of fuzzing"; "These are highly experimental results" — verified.
  - [KNighter (arXiv 2503.09002)](https://arxiv.org/abs/2503.09002) — Chenyuan Yang et al., SOSP 2025 — peer_reviewed — bugs averaging 4.3 years old — verified.
- **Detect:**
  - Churn: `git log --since=12.months --format= --name-only | rg -v '^$' | sort | uniq -c | sort -rn`.
  - Complexity: lizard, or the language's cyclomatic/cognitive complexity tool, per function.
  - Past fixes: `git log --oneline -i -E --grep='fix|cve|security|vuln|overflow|leak'`.
  - Write the rank into the ledger's tier field. It is a violation to declare the audit complete while units with tier=other have passes_completed=0.
- **Tools:** git log, lizard, coverage ledger.
- **Applies to:** Repos with meaningful history. For solo projects with a short history, fall back to trust-boundary exposure and complexity.
- **When not to apply / counterpoints:**
  - Churn metrics were validated on large industrial systems (Windows Server 2003), not on small solo repos.
  - Code Red's 15× figure is correlational and uses a vendor metric (CodeScene).
  - Hotspot ranking biases toward recently edited code, and old stable code demonstrably hides bugs.
- **Fix risk:** low

### G202-F18 — A binary verdict from the LLM is not evidence in either direction
- **Grade:** B (was A) · **Verdict:** DOWNGRADED, with the wording corrected. The 68.26%→3.09% F1 collapse is for "a state-of-the-art 7B model" (a fine-tuned code LM), not a frontier LLM. The evidence covers isolated-function classification by 2023–2025 models, which is only indirect evidence for 2026 agentic reviewers, so the grade was lowered to B.
- **Rule:** Do not accept an LLM's per-function or per-file binary verdict ("vulnerable"/"safe", "buggy"/"fine") as evidence, in either direction. A finding needs a concrete mechanism (input, path, state) that can be checked. A "safe" verdict marks the unit examined, never verified-correct.
- **Rationale:**
  - On realistically deduplicated, time-split data (PrimeVul, ICSE 2025), a state-of-the-art 7B code LM fell from 68.26% F1 (BigVul) to 3.09%. GPT-3.5 and GPT-4 were "akin to random guessing" in the most stringent settings.
  - Ullah et al. (S&P 2024): renaming functions or variables led PaLM2 and GPT-4 to incorrect answers in 26% of cases.
  - SecVulEval: the best model, Claude-3.7-Sonnet, reached 23.83% F1 for vulnerable statements with correct reasoning.
- **Evidence:**
  - [Vulnerability Detection with Code Language Models: How Far Are We? (PrimeVul)](https://arxiv.org/abs/2403.18624) — Ding et al., ICSE 2025 — peer_reviewed — "a state-of-the-art 7B model scored 68.26% F1 on BigVul but only 3.09% F1 on PrimeVul"; GPT-3.5/GPT-4 "akin to random guessing" in the most stringent settings — verified.
  - [LLMs Cannot Reliably Identify and Reason About Security Vulnerabilities (Yet?)](https://arxiv.org/abs/2312.12575) — Ullah et al., IEEE S&P 2024 — peer_reviewed — 228 scenarios, 8 LLMs; 26% incorrect answers after renaming (PaLM2, GPT-4) — verified.
  - [SecVulEval (arXiv 2505.19828)](https://arxiv.org/abs/2505.19828) — Ahmed, Harzevili, Shin, Pham, Wang, 2025 — preprint — Claude-3.7-Sonnet "23.83% F1-score for detecting vulnerable statements with correct reasoning" (25,440 functions, 5,867 CVEs) — verified.
- **Detect:** Check the finding schema: reject findings that lack a mechanism field (entry → path → faulty operation, with file:line). Check the ledger: a unit verdict of "safe" must not set verified=true. Manually sample 10 "no issue" units and look for rationales that only restate the code.
- **Tools:** JSON schema validation, coverage ledger.
- **Applies to:** All classification-style LLM outputs, whether per function, file or slice.
- **When not to apply / counterpoints:** These benchmarks test isolated-function classification with older or smaller models, which is weaker than agentic review with tools. Agentic systems with verification (Naptime, RepoAudit) perform far better, which is exactly why the rule requires a mechanism and a verifier.
- **Fix risk:** low

### G202-F19 — Every sweep ends with a ledger-built residual-risk statement
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:** Every sweep ends with a residual-risk statement built from the ledger. It states:
  - units and LOC examined vs in scope;
  - exclusions and why;
  - passes per tier;
  - defect classes checked and not checked;
  - deterministic tools run, and the files they skipped;
  - findings raw, verified, rejected and suppressed;
  - per-unit convergence state (the Chao2 lower bound where computed);
  - that absence of findings is not evidence of absence.

  Template: "This pass examined N of M in-scope units (X% of in-scope LOC) with k independent LLM passes on trust-boundary slices and 1 elsewhere, plus <tools>. LLM auditors are nondeterministic and low-recall per pass: in published measurements a frontier model re-found a known bug in 8 of 100 runs, and three identical runs of one agent on one app returned 3, 6 and 11 findings. Units still producing new findings at stop: <list>. Not examined or not guaranteed: <excluded paths>, <classes not checked>, cross-slice concurrency beyond the cross-cutting pass, issues needing runtime/config/deployment knowledge, third-party dependency vulnerabilities (covered only by SCA if run). No finding in a unit means that unit was examined, not that it is defect-free."
- **Rationale:**
  - STADS: failing to find a vulnerability "does not mean that none exists".
  - Professional audits publish explicit coverage limitations (Trail of Bits).
  - Measured per-pass recall is low and variable (F01).
  - Vendor "found N vulnerabilities" claims draw practitioner complaints about missing detail (see Practitioner voice).
  - Stating exclusions and convergence lets a reader judge the risk instead of inferring a guarantee.
- **Evidence:**
  - [STADS: Software Testing as Species Discovery](https://arxiv.org/pdf/1803.02130) — Marcel Böhme, ACM TOSEM 2018 — peer_reviewed — "Failing to discover a vulnerability, does not mean that none exists—even if the fuzzer was run for a week (or a year). Hence, testing provides no formal correctness guarantees." — verified.
  - [Go Cryptographic Libraries Security Review](https://github.com/trailofbits/publications/raw/master/reviews/2025-03-google-gocryptographiclibraries-securityreview.pdf) — Trail of Bits, 2025 — industry_report — "Other modules (x509, tls) that make heavy use of the crypto module were not in scope." — verified from the PDF.
  - [From Naptime to Big Sleep](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html) — Google Project Zero, 2024 — engineering_blog — "These are highly experimental results"; "it's likely that a target-specific fuzzer would be at least as effective" — verified.
  - [Finding vulnerabilities in modern web apps…](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex/) — Semgrep, 2025 — engineering_blog — 3 identical runs: 3, 6 and 11 findings — verified.
- **Detect:** Lint the report. The final report must contain in_scope_units, examined_units, examined_loc_pct, exclusions[], passes_by_tier, classes_checked[], classes_not_checked[], tools_run[] with skipped counts, findings_{raw,verified,rejected,suppressed}, unconverged_units[] and the not-guaranteed list. Fail the report if a field is missing or if it contains an unqualified absence claim (F01).
- **Tools:** coverage ledger; report template check (script).
- **Applies to:** Every whole-repo sweep, including those that find nothing.
- **When not to apply / counterpoints:** The literature recall figures come from specific bugs and models (2024–2025) and may understate newer models. Quote them as illustrations of variance, not as the recall of this run. A per-project calibration (re-finding known historical bugs) would be stronger but costs budget.
- **Fix risk:** low

### G202-F11 — One fresh subagent per partition pass, compact structured return
- **Grade:** B · **Verdict:** VERIFIED. Note added: `/batch` is designed for parallel code *changes* (each unit opens a PR). It is cited only as an example of decomposition into units, not as an audit tool.
- **Rule:** Run each partition pass in its own fresh subagent context and have it return a compact structured record (findings with keys, evidence, files read) instead of prose. Respect concurrency limits: Claude Code allows 20 concurrent subagents by default. Do not rely on the parent context to accumulate detailed results from many units.
- **Rationale:**
  - Fresh contexts keep passes independent (F05) and avoid the context-rot and compaction losses of one long session (F04, F10).
  - Claude Code docs: each subagent has an isolated context. Many subagents that return detailed results "can consume significant context". The default limit is 20 concurrent subagents.
  - Anthropic's research-agent data: token usage explains 80% of performance variance (on BrowseComp), and multi-agent runs use ~15× chat tokens. Anthropic also warns that coding has fewer parallelizable tasks. Read-only audits of disjoint slices are nonetheless parallelizable.
- **Evidence:**
  - [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic (Claude Code docs), live 2026 — official_docs — "Each subagent starts with a fresh, isolated context window."; "Running many subagents that each return detailed results can consume significant context."; the default of 20 running subagents gives "Concurrent subagent limit reached" (configurable via CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS) — verified.
  - [Claude Code commands reference (/batch)](https://code.claude.com/docs/en/commands) — Anthropic, live 2026 — official_docs — "decomposes the work into 5 to 30 independent units… spawns one background subagent per unit in an isolated git worktree" — verified.
  - [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — Anthropic, 2025-06-13 — engineering_blog — "Token usage by itself explains 80% of the variance"; ~4× (agents) and ~15× (multi-agent) chat tokens; coding has "fewer truly parallelizable tasks than research" — verified.
  - [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic, 2025-09-29 — engineering_blog — "Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens)." — verified verbatim.
- **Detect:** Check that each ledger pass row has a unique subagent or transcript ID, that the returned payload validates against the finding JSON schema, and that the parent session never ingested whole-unit source text. Flag orchestration that runs all units sequentially in one conversation.
- **Tools:** Claude Code subagents, JSON schema validation.
- **Applies to:** Agent-harness audits (Claude Code and similar). The principle applies to any orchestrator.
- **When not to apply / counterpoints:** Per-unit isolation loses cross-unit insight, which is why F03's cross-cutting pass exists. Parallel fan-out multiplies cost (~15× in Anthropic's research setting).
- **Fix risk:** low

### G202-F03 — Add at least one cross-cutting pass that slicing cannot replace
- **Grade:** C · **Verdict:** CORRECTED. The Joshua Rogers evidence, previously a fetch-tool paraphrase, was replaced with a verbatim quote. Context added: Rogers's 85% figure is for deliberately vulnerable test code.
- **Rule:** Add at least one cross-cutting pass that slicing cannot replace. Its units are:
  - shared mutable state and object lifecycles (sessions, caches, connection pools);
  - concurrency;
  - authorization consistency across all routes of the same resource;
  - configuration and initialization order.

  Feed it the set of handlers that touch the same state, not one handler.
- **Rationale:**
  - The novel ksmbd CVE-2025-37899 (a free of `sess->user` in the logoff handler while another thread still uses it) was found only in the wide 12k-LoC experiment. Heelan says understanding it "requires reasoning about concurrent connections".
  - Practitioner tests report that per-file tools struggle with cross-file flaws, and Semgrep found agents weak on inter-procedural taint.
  - IDOR was Claude Code's largest true-positive class in Semgrep's study, and it needs cross-route comparison.
- **Evidence:**
  - [How I used o3 to find CVE-2025-37899](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/) — Sean Heelan, 2025 — engineering_blog — "This vulnerability is also due to a free of `sess->user`, but this time in the session logoff handler."; "Understanding the vulnerability requires reasoning about concurrent connections to the server, and how they may share various objects in specific circumstances." — verified verbatim.
  - [Finding vulnerabilities in modern web apps…](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex/) — Semgrep, 2025 — engineering_blog — "Models struggle with inter-procedural taint flow"; Claude Code TPs: IDOR 13, XSS 12, SSRF 8, auth bypass 6 — verified.
  - [LLM engineer review of AI SAST tools](https://joshua.hu/llm-engineer-review-sast-security-ai-tools-pentesters) — Joshua Rogers, 2025-09-18 — practitioner_forum — On Almanax: "Of the deliberately vulnerable code, it detected 85% of the issues." / "It seemed to fail at finding _vulnerabilities_ across files, however, and its value was only realized in code where the vulnerabilities were restricted to a single file." — verified verbatim (corrected from a paraphrase).
- **Detect:**
  - Group handlers by shared state. Grep for module-level or global mutables and lifecycle calls (`rg -n "^(var|let) |static mut|global |\b(free|close|dispose|logout|logoff|invalidate)\("`), for locks and threads (Mutex|Lock|goroutine|Thread|async), and for per-resource route families (the same path prefix with different verbs).
  - Record each group as a ledger unit with kind=cross-cutting.
  - Manual check: for each resource, list the authorization check each route uses and look for missing or inconsistent ones.
- **Tools:** ripgrep, CodeQL, ast-grep.
- **Applies to:** Multi-threaded or async servers, web apps with many routes per resource, and anything with sessions or caches.
- **When not to apply / counterpoints:**
  - The evidence is one striking case plus practitioner reports. No study measures how much recall a dedicated cross-cutting pass adds.
  - The wide context also lowered recall on the known bug (1/100), so this pass should be narrow in topic even if it is wide in code.
- **Fix risk:** low

### G202-F10 — "Examined" only from tool evidence, never from the agent's own summary
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:** Mark a unit "examined" only from tool evidence, not from the agent's own summary. Reconcile the ledger against the transcript's actual file-read calls (paths and line ranges).
  - A unit whose files that pass did not read in full is "partial".
  - A pass that hit context compaction or summarization mid-unit is also "partial".
- **Rationale:**
  - Semgrep attributed run-to-run variance to context rot and lossy summarization: "some of the finer reasoning details like function names, paths, etc. can get lost in the summarization process".
  - Anthropic treats context as a finite resource with diminishing returns, and advises tuning compaction prompts for recall first, then precision.
  - Claude Code subagents return only a summary to the parent, so the parent cannot see what was read unless it is logged.
- **Evidence:**
  - [Finding vulnerabilities in modern web apps…](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex/) — Semgrep, 2025 — engineering_blog — "When an AI agent is tasked with analyzing an entire codebase, it's dealing with a massive amount of information: context rot leads to the inability to retrieve accurately from its own context"; "some of the finer reasoning details like function names, paths, etc. can get lost in the summarization process" — verified.
  - [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Anthropic, 2025-09-29 — engineering_blog — "Context, therefore, must be treated as a finite resource with diminishing marginal returns."; "Start by maximizing recall to ensure your compaction prompt captures every relevant piece of information from the trace, then iterate to improve precision by eliminating superfluous content." — verified verbatim.
  - [Create custom subagents](https://code.claude.com/docs/en/sub-agents) — Anthropic, live 2026 — official_docs — "…the subagent does that work in its own context and returns only the summary."; "Each subagent starts with a fresh, isolated context window." — verified.
- **Detect:** Parse each pass transcript for file-read tool calls (Read entries with file_path/offset/limit). Compute lines_read per file against the lines in the slice. Set status=partial if any slice file has less than 100% of its slice lines read, or if a compaction or summary event occurred before the pass emitted its findings. Store files_read in the pass row.
- **Tools:** transcript parser (jq over JSONL), coverage ledger.
- **Applies to:** Agentic audits where the model chooses what to read (Claude Code, Codex and similar).
- **When not to apply / counterpoints:** Reading is not reasoning: full read coverage does not guarantee a unit was analysed well. This rule is derived from vendor docs and one engineering blog, not from a measured study.
- **Fix risk:** low

### G202-F14 — Named defect-class checklist per pass, rotated across passes
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:** Give each pass a named defect-class checklist instead of an open-ended "find all bugs" prompt, for example injection/taint, authorization/IDOR, resource lifecycle and error paths, concurrency, numeric/precision, and dead code and duplication. Rotate classes across the k passes of a unit so that repeated passes differ in focus. Record classes_checked per unit.
- **Rationale:**
  - Neef et al. (2026; 6 models, 5 prompt designs) found that scoped prompts naming vulnerability types detect more than open-ended prompts.
  - Semgrep's per-class results show recall differs widely by class (IDOR 22% TPR vs SQLi 5%).
  - Big Sleep chose variant analysis because a concrete starting point "remove[s] a lot of ambiguity".
  - Vulnhuntr runs a vulnerability-specific secondary prompt.
  - Unchecked classes must appear in the residual-risk statement.
- **Evidence:**
  - [Evaluating LLMs for Real-World Web Vulnerability Detection](https://arxiv.org/html/2606.21397) — Neef et al., 2026 — preprint — "More specific prompt scoping, such as prompting an LLM to look for specific types of vulnerabilities…leads to a better detection rate compared to open-ended prompts" — verified.
  - [From Naptime to Big Sleep](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html) — Google Project Zero, 2024 — engineering_blog — "By providing a starting point – such as the details of a previously fixed vulnerability – we remove a lot of ambiguity from vulnerability research" — verified.
  - [Finding vulnerabilities in modern web apps…](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex/) — Semgrep, 2025 — engineering_blog — Claude Code TPR: IDOR 22% (13/59), XSS 16%, path traversal 13%, SSRF 12%, auth bypass 10%, SQLi 5% (2/38) — verified.
- **Detect:** In the ledger, each pass has a non-empty classes[] field, and the union over a unit's passes should cover the planned class set. Flag prompts that match open-ended patterns (`rg -n -i "find (all|any) (bugs|issues|vulnerabilities)" prompts/`) without a class list.
- **Tools:** coverage ledger, ripgrep.
- **Applies to:** All detection passes, for security and maintainability classes alike.
- **When not to apply / counterpoints:** Narrow prompts can miss out-of-class bugs; Heelan's novel CVE came from a prompt aimed at a different bug. Keep one open-ended pass per high-risk unit as an exploration slot. Neef's result comes from WordPress-plugin PHP code and 4 plugins.
- **Fix risk:** low

### G202-F16 — Per-unit stopping rule with a species-richness lower bound
- **Grade:** C · **Verdict:** CORRECTED, in three places:
  1. The Briand et al. quote was wrong. The abstract says "When the number of **inspectors** is too small, no model is sufficiently accurate and underestimation may be substantial", not "number of defects". With k=3 LLM passes as "inspectors", this warning applies directly.
  2. Briand et al. recommend a model with heterogeneous detection probabilities and "the corresponding Jackknife Estimator", which has been added as an alternative to Chao2.
  3. STADS itself leaves the empirical evaluation of Bernoulli-product (incidence) estimators "for future work".
- **Rule:** Stopping rule per unit.
  - Run at least the minimum passes (F05).
  - Continue while the latest pass produced at least one new verified finding, or while the estimated number of unseen findings is 1 or more. Estimate it with Chao2 on incidence data: Ŝ = S_obs + Q1²/(2·Q2), or S_obs + Q1(Q1−1)/2 when Q2=0 (STADS eq. 26), where Q1 and Q2 are the findings seen in exactly 1 and 2 passes. A jackknife estimator is an alternative.
  - Hard-stop at 10 passes or at the budget cap.
  - Globally, stop only when every ledger row has a terminal status.
  - Treat the estimate as a lower bound. With 3–5 passes it will likely underestimate.
- **Rationale:**
  - Capture-recapture was evaluated precisely to decide "whether the inspection can stop or whether it should continue" (Briand et al.), who warn of substantial underestimation with few inspectors.
  - Böhme's STADS (ACM TOSEM 2018) applies species-richness estimators to testing. Its Bernoulli-product (incidence) model, where one input can "expose multiple bugs", matches an LLM pass. It notes that Chao2 "provides a nonparametric lower bound".
  - The crowdtesting close-prediction work (iSENSE, including capture-recapture) detected a median of 91% of bugs with 49% of cost saved.
  - Diminishing returns are measured: Naptime gained +0.33 from 1→10 trajectories but only +0.07 from 10→20, and SWR-Bench saw diminishing returns beyond n=5.
  - Applying these estimators to LLM passes is untested, hence grade C.
- **Evidence:**
  - [STADS: Software Testing as Species Discovery](https://arxiv.org/pdf/1803.02130) — Marcel Böhme, ACM TOSEM 2018 — peer_reviewed — "The Good-Turing estimator is computed as the number of singletons divided by the number of samples"; Bernoulli product model: "a single input can … expose multiple bugs"; eq. 26 Chao2 = S(n) + Q1²/(2Q2) [Q2>0], S(n) + Q1(Q1−1)/2 [Q2=0]; "the Chao2 estimator … provides a nonparametric lower bound"; "an empirical evaluation of estimator performance is left for future work" (Poisson and Bernoulli product models) — verified from the PDF.
  - [A comprehensive evaluation of capture-recapture models for estimating software defect content](https://api.openalex.org/works/doi:10.1109/32.852741) — Briand, El Emam, Freimut, Laitenberger, IEEE TSE 26(6), 2000 — peer_reviewed — the abstract (reconstructed from OpenAlex's inverted index) says the goal is to decide "whether the inspection can stop or whether it should continue"; "When the number of inspectors is too small, no model is sufficiently accurate and underestimation may be substantial."; "we recommend using a model taking into account that defects have different probabilities of being detected and the corresponding Jackknife Estimator" — **corrected quote**; full paper not read.
  - [Crowdtesting: When is The Party Over? (iSENSE)](https://arxiv.org/abs/1805.03218) — Wang, Yang, Yu, Menzies, Wang, ICSE 2019 — peer_reviewed — 8 methods including capture-recapture, 218 tasks: "a median of 91% bugs can be detected with 49% saved cost" — verified.
  - [Project Naptime](https://projectzero.google/2024/06/project-naptime.html) — Google Project Zero, 2024 — engineering_blog — 0.36 / 0.69 / 0.76 at @1/@10/@20 — verified.
- **Detect:** After each pass, recompute per unit S_obs (distinct verified clusters), Q1, Q2 and Chao2 (or jackknife). Record them in the ledger and log the stop reason (min_passes_met_and_converged | max_passes | budget). Flag units that stopped while the latest pass had new_verified > 0 and the stop reason is neither budget nor max_passes.
- **Tools:** coverage ledger; a small script (Python/TS) computing Q1, Q2, Chao2 and jackknife.
- **Applies to:** High-risk units with at least 3 passes. With 1–2 passes the estimator is meaningless; rely on the minimum-pass rule.
- **When not to apply / counterpoints:**
  - Briand et al. show that with few inspectors (passes) estimates are inaccurate and biased low. Pool across units of the same tier where possible.
  - LLM passes violate the independence and equal-catchability assumptions.
  - Treat the estimate as a lower bound on unseen issues, never as proof of completeness.
- **Fix risk:** low

### G202-F17 — Estimate the budget and set a hard cap before starting
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:** Before starting, estimate the budget and set a hard cap in the ledger. Estimate read_tokens ≈ 8.3 × LOC per full read, multiplied by slice overlap, agent overhead and the number of passes. Reserve verification budget up front, because false positives dominate. When the cap is hit, mark the remaining units "skipped-budget" rather than silently shrinking scope.
- **Rationale:**
  - Heelan's 100 runs over ~100k tokens cost about $116 (~$1.16 per 12k-LoC run). His figures give ≈8.2–8.3 tokens per LoC.
  - RepoAudit averaged 614,626 input tokens, 1,577 s and $2.54 per project ($0.95 per true bug).
  - Semgrep's Claude Code sweep of 11 apps (>800k LOC) cost $114.
  - DARPA AIxCC systems averaged about $152 per competition task.
  - Agents use ~4× and multi-agent systems ~15× the tokens of chat.
  - Tools warn about runaway bills.
  - Verification cost scales with false positives (86% of Semgrep's raw findings).
- **Evidence:**
  - [How I used o3 to find CVE-2025-37899](https://sean.heelan.io/2025/05/22/how-i-used-o3-to-find-cve-2025-37899-a-remote-zeroday-vulnerability-in-the-linux-kernels-smb-implementation/) — Sean Heelan, 2025 — engineering_blog — "The 100 runs of the ~100k token version cost about $116."; 3.3k LoC ≈ 27k tokens; 12k LoC ≈ 100k tokens — verified.
  - [RepoAudit](https://arxiv.org/html/2501.18160v3) — Guo et al., 2025 — preprint — Claude 3.5 Sonnet: 614,625.73 input tokens, 46,153 output tokens, 1,577.22 s (0.44 h), $2.54 per project, $0.95 per bug; without caching, cost rose 3–4× on average and up to 30× — verified.
  - [Finding vulnerabilities in modern web apps…](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex/) — Semgrep, 2025 — engineering_blog — "The overall cost of Claude Code was $114, for all these vulnerabilities and all these apps (except running for non-determinism and for `/security-review` command)"; 11 apps, ~7k files, >800 kLOC — added by verifier (the researcher cited this figure without a source entry).
  - [AI Cyber Challenge results](https://www.darpa.mil/news/2025/aixcc-results) — DARPA, 2025-08-08 — industry_report — "competitors' systems discovered 54 unique synthetic vulnerabilities in the Final Competition's 63 challenges. Of those, they patched 43."; "average cost per competition task of about $152" — verified.
  - [vulnhuntr README](https://github.com/protectai/vulnhuntr) — Protect AI, 2024 — official_docs — "Always set spending limits or closely monitor costs with the LLM provider you use. This tool has the potential to rack up hefty bills…" — verified (repo stale since 2025-02).
  - [What's new in Claude Opus 5.5 (pricing)](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5) — Anthropic, live 2026 — official_docs — $4 / $20 per million input/output tokens; batch processing half price ($2 / $10); cache reads $0.20/M — verified.
- **Detect:** The ledger header must contain budget_cap_tokens, budget_cap_usd, estimate_tokens and verification_reserve. Per-pass tokens_in and tokens_out must sum to at most the cap. Flag runs whose cumulative tokens exceed the estimate by more than 2× without a logged re-plan, and flag any "complete" audit whose report does not disclose its skipped-budget units.
- **Tools:** coverage ledger, provider usage/billing API, token counting endpoint.
- **Applies to:** All paid-API audits, most of all at the 100k–200k LOC end.
- **When not to apply / counterpoints:** The tokens-per-LoC ratio comes from C kernel code and varies by language and formatting. The agent overhead factors come from a research-agent setting. The cost figures span different models and years, and prices fall quickly, so treat the envelope as an order of magnitude.
- **Fix risk:** low

## Practitioner voice

All items below were opened. Authorship was checked against the HN Firebase and Algolia APIs.

- [HN 44083068 — maintainer on slop CVEs](https://news.ycombinator.com/item?id=44083068) — **mezyt** (the researcher had attributed this to "baq", who wrote a reply). Verbatim: "as a maintainer, I've been reviewing more than a dozen false positives slop CVEs in my library and not a single one found an actual issue." The cost of triaging low-precision LLM findings lands on maintainers.
- [HN 44086533 — curated context](https://news.ycombinator.com/item?id=44086533) — tecleandor: "The author already knew the bug was there, and fed the LLM just the files related to the bug…". Heelan's recall came from expert-curated context and may not transfer to unmapped whole-repo sweeps. Caveat: the same comment wrongly says it was "only 1 out of 100 times" (it was 8/100 on the curated slice), and a reply by sweetjuly notes that a second, unknown bug was also found.
- [HN 44082887 — triage is the bottleneck](https://news.ycombinator.com/item?id=44082887) — **Retr0id** (the researcher had attributed this to "manmal"). With the ~1:50 signal-to-noise ratio, "Automating this part will be where the real wins are". Triage and verification, not detection, is the bottleneck.
- [Joshua Rogers, AI SAST review](https://joshua.hu/llm-engineer-review-sast-security-ai-tools-pentesters) — Rogers deliberately re-runs full-repo scans to exploit nondeterminism ("indeterministic, which I think is a _good_ thing"). Some products silently drop `tests` directories or ignore "deliberately vulnerable" files. He "would rather have more false positives as long as it means more true positives." Stenberg credited his AI-assisted curl findings.
- [Stenberg, "A new breed of analyzers"](https://daniel.haxx.se/blog/2025/10/10/a-new-breed-of-analyzers/) (2025-10-10) — curl "merged about 50 separately identifiable bugfixes" from Rogers's ZeroPath-based list, with "remarkably few of them complete false positives". The bugs were variable mixups, return-code confusion, small leaks and state-transition mistakes, including a GSSAPI leak present "for over a decade". Aisle also contributed.
- [Stenberg, "The end of the curl bug-bounty"](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/) (2026-01-26) — the confirmed rate fell below 5% in 2025, from "north of 15%", amid "an explosion in AI slop reports". "The never-ending slop submissions take a serious mental toll to manage".
- [HN 45142152 — PR-review bots "rarely correct"](https://news.ycombinator.com/item?id=45142152) — kogatlas, in the thread "Are LLMs better suited for PR reviews than full codebases?" ([45141995](https://news.ycombinator.com/item?id=45141995), prompted by Semgrep's study): the PR-review bots used at work for months "are rarely correct, and thus, rarely useful… summarize nonsense that wasn't even introduced in that PR… or recommend bad fixes". URL corrected to point at the comment itself.
- [HN 46922443 — context blow-up](https://news.ycombinator.com/item?id=46922443) — throwa356262, on Anthropic's 0-days post: "The context grows very quickly and the LLM gets lost and starts hallucinating", and "if you have large team of AI and security experts and an unlimited token budget things can look different." Tested with Claude 4.5, not 4.6.
- [HN 46919401 — skepticism of vendor counts](https://news.ycombinator.com/item?id=46919401) — tznoer: "Grepping for strcat() is at the 'forefront of cybersecurity'?" **Corrected context:** that thread (18 comments) contains no requests for full CVE/CVSS lists. In the parallel, larger thread on the same announcement ([46902909](https://news.ycombinator.com/item?id=46902909)), [Topfi](https://news.ycombinator.com/item?id=46903564) calls the release "very light on concrete information", and [_tk_](https://news.ycombinator.com/item?id=46903387) says the examples "could very well be cherrypicked". The submitter of 46902374 (lebovic) also calls the post "light on details" while defending Opus 4.6 as "a legitimate step up".
- [Semgrep study](https://semgrep.dev/blog/2025/finding-vulnerabilities-in-modern-web-apps-using-claude-code-and-openai-codex/) — Claude Code and Codex over 11 real Python apps: 14% and 18% true-positive rates, $114 for Claude Code, and run-to-run results of 3/6/11 findings. The authors blame context rot and lossy compaction, and weak inter-procedural taint tracking.
- [HN 46237358 — DeepSource Autofix Bot (vendor)](https://news.ycombinator.com/item?id=46237358) — Show HN claim, OpenSSF CVE Benchmark: hybrid 80.0% F1 vs Claude Code 62.99% (also Cursor Bugbot 77.42%, CodeRabbit 36.19%, Semgrep CE 38.26%). The authors also list "non-deterministic across runs, low recall on security issues" as limits of LLM-only review. This is a vendor benchmark and only a directional signal.

## Contradictions and open questions

**Contradictions**
- **More context vs relevant context.** Heelan (8/100 on 3.3k LoC vs 1/100 on 12k LoC), SWE-PRBench (full context worse across all 8 models), LongCodeBench (29%→3%) and CPRVul ("unstructured context frequently degrades") say that more code lowers recall. RepoAudit (40 TP vs 10 for oracle-context multi-function CoT), JitVul and SecVulEval say interprocedural context raises it, and Heelan's novel concurrency CVE appeared only in the wider run. The reconciliation used here is a curated relevant slice plus a separate cross-cutting pass. No study measures this head-to-head on the same repos.
- **Nondeterminism as bug vs feature.** Semgrep: irreproducibility "makes it difficult to verify the AI's findings and to trust its output". Rogers: indeterminism is "a _good_ thing", so re-scan "again and again". Both are right: nondeterminism wrecks single-pass claims and raises recall under a union.
- **Nondeterminism: inevitable or engineering choice?** Atil et al. say it is "not going away anytime soon". Thinking Machines shows that batch-invariant kernels remove it on self-hosted inference. For hosted coding agents, the first view holds in practice.
- **Aggregation.** SWR-Bench's LLM aggregation raised F1 by up to 43.67%, mostly through recall, while Large Language Monkeys finds that majority voting and reward models plateau without verifiers. A majority vote would have discarded Heelan's 8%-per-run true bug.
- **How many passes.** SWR-Bench sees diminishing returns beyond n=5, while Naptime still gained from 10→20 trajectories (+0.07). Briand et al. warn that capture-recapture estimates with few "inspectors" underestimate substantially, which is exactly the 3-pass regime.
- **False-positive rates vary by tool and setting.** Stenberg found "remarkably few" complete false positives in the ZeroPath-assisted curl reports. Semgrep measured 82–86% false positives for Codex and Claude Code, IRIS had an 84.82% FDR, Heelan saw ~1:50 signal-to-noise on the large-context run (about 1:3.5 on the curated slice), and curl's bounty stream fell below 5% confirmed in 2025.
- **Parallel agents.** Anthropic says coding has "fewer truly parallelizable tasks than research" and that multi-agent costs ~15× the tokens. Yet the Claude Code docs recommend parallel subagents for independent investigations, and read-only audit slices are parallelizable.
- **Hotspots vs old code.** Churn and low code health correlate with defects (Nagappan & Ball 89%; Tornhill & Borg 15×), but KNighter's bugs averaged 4.3 years old and curl's AI-found bugs included a decade-old leak. Hotspots can set the order but must not filter the scope.
- **Vendor claims vs verification.** Anthropic reports >500 validated high-severity vulnerabilities (Opus 4.6), and Google DeepMind's CodeMender reports 72 upstreamed fixes, all human-reviewed. HN commenters called the Anthropic post "very light on concrete information" and its examples possibly "cherrypicked". OpenAI's Aardvark recall claim was not checked (the researcher got HTTP 403; not retried here).

**Open questions**
- No published study compares partitioning strategies (per file, per module, per entry point/trust boundary, call-graph slice, hotspot-first) on recall per token over the same real repositories. The 30k-token and depth-3 defaults rest on Heelan's single experiment and RepoAudit's design.
- How correlated are repeated passes of the same model and prompt? The union-recall arithmetic 1−(1−p)^k assumes independence, which is surely false. Mixing models or rotating prompts (SWR-Bench Multi-Agg) is plausibly better but unmeasured for whole-repo audits.
- Capture-recapture, Chao2 and Good-Turing estimators are validated for inspections, crowdtesting and fuzzing (and STADS itself leaves incidence-model validation to future work), not for LLM passes. Briand shows substantial underestimation with few inspectors.
- Nearly all recall data concerns security bugs. Whole-repo LLM recall for maintainability issues (dead code, duplication, cognitive complexity, error-handling gaps) is unmeasured.
- Most measurements use 2023–2025 models (GPT-4, o3, Sonnet 3.5–4). The only 2026 web-vulnerability study found 63% detection for Opus 4.6 on 4 plugins with known vulnerabilities, with 75% run consistency. How much per-pass recall has improved on real repos is unknown.
- The recall loss from LLM false-positive filters on real mixed codebases, as opposed to OWASP Benchmark or selected bug types, is unknown. Measured losses are 3 of 45 true positives and 3.1% of recall.
- LLift's 50% precision and "no missing bugs" appear only in the preprint abstract. The peer-reviewed full text was not accessible (ACM DL 403).
- "Examined" can be proven by read logs, but no method exists to verify that the model reasoned about everything it read. Calibrating per-project recall by replaying known historical fix commits is promising but untested.

## Dropped findings

None. All 19 findings survived. Five were corrected (F03, F06, F09, F12, F16) and one was downgraded (F18). No practitioner-voice item was dropped. Two were re-attributed (44083068 → mezyt; 44082887 → Retr0id), one URL was moved to the actual comment (45142152), and one unsupported sub-claim was replaced with verified quotes from the parallel thread (46919401 context).
