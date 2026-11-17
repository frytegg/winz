# Research provenance for /prose

Every rule in `references/` rests on something here. Each finding is graded **MEASURED** (a study or a
measurement with numbers) or **ASSERTED** (someone's judgement, however experienced). Nothing is cited from
memory. Where a popular belief has thin evidence, that is recorded as a finding in its own right, because the
most useful thing this file does is stop a rule being imported on reputation.

Produced 25 September 2026 by three parallel research agents (existing artefacts, detection mechanics,
documentation craft) plus one corpus measurement run by the author of this skill.

---

## A. Detection mechanics

| # | finding | grade | source |
|---|---|---|---|
| A1 | Detectors measure token log-probability (GLTR), log-probability curvature under perturbation (DetectGPT, 0.81 → 0.95 AUROC over the best prior zero-shot baseline), and cross-perplexity between two related models (Binoculars, >90 % TPR at 0.01 % FPR) | MEASURED | arxiv.org/abs/1906.04043, arxiv.org/abs/2301.11305, arxiv.org/abs/2401.12070 |
| A2 | Seven detectors, 91 TOEFL essays by non-native speakers: **61.22 %** mean false-positive rate, 18 of 91 flagged by all seven. Prompting a model to enhance word choice cut it to 11.77 %. Simplifying US 8th-grade essays raised theirs from 5.19 % to **56.65 %** | MEASURED | arxiv.org/pdf/2304.02819 (*Patterns*, 2023) |
| A3 | OpenAI's classifier: 26 % true positives, 9 % false positives, withdrawn 20 July 2023 for low accuracy | MEASURED (secondary corroboration; openai.com returned 403) | openai.com/index/new-ai-classifier-for-indicating-ai-written-text/ |
| A4 | Vanderbilt disabled Turnitin's detector on 16 August 2023, extrapolating ~750 mislabelled papers a year | ASSERTED (institutional extrapolation) | vanderbilt.edu/brightspace/2023/08/16/ |
| A5 | Burstiness means variance of per-sentence perplexity, not sentence length, and GPTZero stopped using perplexity and burstiness in autumn 2023 | MEASURED (vendor statement) | gptzero.me/news/perplexity-and-burstiness-what-is-it/ |
| A6 | Six LLMs against human news text: humans show more scattered sentence-length distributions, greater lexical diversity, shorter constituents | MEASURED | arxiv.org/abs/2308.09067 |
| A7 | No text-only detector can work as the distributions converge: AUROC ≤ ½ + TV − TV²/2 | MEASURED (a proof, not an experiment) | Sadasivan et al., arxiv.org/abs/2303.11156 |
| A8 | Recursive paraphrasing takes DetectGPT from 96.5 % to 25.2 % AUROC and soft watermarking from ~99 % to 9.7 %. DIPPER takes DetectGPT to 4.6 % TPR at 1 % FPR | MEASURED | arxiv.org/abs/2303.11156, arxiv.org/abs/2303.13408 |

**What A2 means for this skill.** Making a text simpler made detectors eleven times more likely to call it
machine-written. Any rule-set aimed at detectors is aimed at lexical sophistication, so following it means
writing worse. This is why `SKILL.md` promises a reader's verdict and nothing else.

## B. The tells, and their half-life

| # | finding | grade | source |
|---|---|---|---|
| B1 | 15 M PubMed abstracts, 2010–2024: 454 excess words in 2024 against 190 at the Covid peak; *delves* ×28.0, *underscores* ×13.8, *showcasing* ×10.7. Lower bound: ≥13.5 % of 2024 abstracts LLM-processed | MEASURED | arxiv.org/abs/2406.07016 (*Science Advances* 11:27, 2025) |
| B2 | Those tells decay once publicised: *delve* fell sharply in arXiv abstracts within months, while *significant* kept rising | MEASURED | arxiv.org/abs/2502.09606 |
| B3 | HC3 medical corpus: 45.8 % of ChatGPT-3.5's subject-copula-adjective constructions are *it is/it's important*, against **1.1 %** in human expert answers | MEASURED | pmc.ncbi.nlm.nih.gov/articles/PMC12111693/ (*PLoS One*, 2025) |
| B4 | Tricolon at nearly twice the human rate (Δ=0.95, strongest device-level discriminator); humans use rhetorical questions at over twice the machine rate | MEASURED, but a 2026 preprint, unreviewed | arxiv.org/abs/2604.19768 |
| B5 | 146 239 congressional press releases: unspaced em-dash density 0.10–0.12 per 1 000 characters in 2021–24, **0.217 in 2025**; share containing one, 13 % → 24.8 %. The authors call it *"a population-level marker, not a per-release authorship detector"* | MEASURED | arxiv.org/abs/2608.05889 |
| B6 | Wikipedia's community list of signs: overused vocabulary, negative parallelism, copula displacement (*serves as*), section formulas, title case, em-dash overuse, emoji headings | ASSERTED (community consensus, no measurement) | en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing |

## C. Existing artefacts

| # | finding | grade | source |
|---|---|---|---|
| C1 | `adewale/anti-slop-writing` is the only artefact with a real eval harness: adversarial cases, ablation patches, blind apply/judge separation, paired bootstrap, TOST equivalence gate. Its emphasis-source and syntax-relation tests are falsifiable procedures | ASSERTED (design), MEASURED (its evals) | github.com/adewale/anti-slop-writing |
| C2 | It A/B tested the two best rules of the most popular competitor (17.5 k stars) across three models, 18 paired deltas: **effect 0.00, CI [0,0], p = 1.0, rejected** | MEASURED | same repository, `docs/eval-null-result-literature.md` |
| C3 | `hardikpandya/stop-slop`: 8 rules, a 5-axis score out of 50, blanket bans on adverbs, passive voice, em dashes and Wh- openers. Its "False Agency" rule is a genuine mechanism test | ASSERTED | github.com/hardikpandya/stop-slop |
| C4 | `jalaalrd/anti-ai-slop-writing`: the only quantified thresholds in the field, asserted rather than measured — one em dash per 500 words, one exclamation per 1 000, never three consecutive sentences of the same length | ASSERTED | github.com/jalaalrd/anti-ai-slop-writing |
| C5 | `aplaceforallmystuff/the-antislop`: the density-probe framing, which is the correct handling of vocabulary drift, plus the Horoscope Test | ASSERTED | github.com/aplaceforallmystuff/the-antislop |
| C6 | Anthropic publishes no anti-slop or writing-style skill; all 19 skills in its repository were listed and checked | MEASURED (negative result) | github.com/anthropics/skills |
| C7 | **No existing artefact targets READMEs, technical documentation or pitches, and none ships a deterministic checker.** All scoring is model self-assessment | MEASURED (negative result, six artefacts) | the six repositories above |

C7 is why this skill exists. C2 is why it puts mechanism tests above word lists.

## D. Documentation craft

| # | finding | grade | source |
|---|---|---|---|
| D1 | Diátaxis: four kinds by what the reader is doing, with per-kind rules (*"A tutorial is not the place for explanation"*, *"Action and only action"*, *"austere and uncompromising"*) | ASSERTED (widely adopted) | diataxis.fr |
| D2 | Its documented gaps: no conceptual overview before the tutorial, and no separation of snippet from example; designed for tools, breaks on frameworks | ASSERTED (practitioner essay) | hillelwayne.com/post/problems-with-the-4doc-model/ |
| D3 | 4 226 README sections from 393 repositories, classifier F1 0.746: How 58.4 %, References 20.3 %, What 16.7 %, Who 7.6 %, When 4.3 %, Contribution 2.9 %, Why 2.7 %. *"Many README files lack information regarding the purpose and status"* | MEASURED | arxiv.org/abs/1802.06997 (EMSE 2019) |
| D4 | Incomplete or outdated documentation observed by **93 %** of respondents; 60 % of contributors rarely or never contribute to it | MEASURED (survey) | opensourcesurvey.org/2017/ |
| D5 | Five machine-detectable API documentation smells — Bloated, Excess Structural Information, Tangled, Fragmented, Lazy — over 1 000 units; 95.2 % of 21 developers said they hurt productivity | MEASURED | arxiv.org/abs/2102.08486 (SANER 2021) |
| D6 | Google: timeless documentation, with the banned time-bound word list and the date-or-version requirement; and the adjective-to-measurement pair (*screamingly fast* → *225–250 % faster*) | ASSERTED (style guide) | developers.google.com/style/timeless-documentation, developers.google.com/tech-writing/one/words |
| D7 | curl enforces documentation structure in CI: test 1173 asserts eight mandatory man-page sections in order plus an example over two lines; test 1139 asserts the man page lists exactly the source's options; proselint and aspell over ~482 pages | MEASURED (a running CI suite) | daniel.haxx.se/blog/2022/09/22/, daniel.haxx.se/blog/2021/09/04/ |
| D8 | Documentation unit tests: introspect the API surface, parse the docs, fail CI on undocumented items. The author states the limit: they cannot confirm quality | ASSERTED | simonwillison.net/2018/Jul/28/documentation-unit-tests/ |
| D9 | *"Each doc is a test suite, each procedure a test case, each step an assertion"* | ASSERTED | docsastests.com |
| D10 | Named explanation failures: unrealistic examples, meaningless jargon, no examples, explaining the wrong way without saying it is wrong. Plus: write for one specific person; address one knowledge gap at a time | ASSERTED (practitioner) | jvns.ca/blog/confusing-explanations/ |
| D11 | Non-goals are *"things that could reasonably be goals, but are explicitly chosen not to be"*; ADRs require all consequences, not only positive ones; RFC 2119 grades MUST/SHOULD/MAY | ASSERTED | industrialempathy.com/posts/design-docs-at-google/, cognitect.com/blog/2011/11/15/, rfc-editor.org/rfc/rfc2119 |
| D12 | MOS:PEACOCK and MOS:WEASEL give lift-and-use word lists | ASSERTED | en.wikipedia.org/wiki/Wikipedia:Manual_of_Style/Words_to_watch |

## E. The corpus measurement, run for this skill

Six human-written technical documents (9 418 words) against a machine-drafted corpus of 14 725 words, measured
with `scripts/prose_check.py --shape` on 25 September 2026. Full table in `references/02-measured-shape.md`.

| # | finding | grade |
|---|---|---|
| E1 | Em dashes: **0.0 per 1 000 words** in five of six human documents, 0.5 in the sixth, against **8.4** in the machine-drafted corpus | MEASURED |
| E2 | Median sentence 12 to 18 words in the control against 27 to 33; sentences of 35 words or more, **1–5 % against 31–46 %**; sentences under 9 words, 8–37 % against 2–4 % | MEASURED, after the correction in E5 |
| E3 | Hedges and numbers per 1 000 words are inside the human band in both corpora, so neither discriminates here | MEASURED (negative result) |
| E4 | The checker, tuned until silent at tier 1 on four control documents (62 candidates → 40, 10 tier-1 → **0**), then reported 203 candidates and 34 at tier 1 on the machine-drafted corpus | MEASURED |
| E5 | **A flaw in E2's first version.** Sentences were split per line while three of six control documents hard-wrap at 48 to 66 characters and the compared corpus does not wrap at all, so the tool measured line length. Joining paragraphs first corrected the control's long-sentence share from a reported 14–27 % to 1–5 %, widening the contrast | MEASURED (a correction to a measurement) |

## Known limits of this evidence base

- The control corpus is six documents from developer-tool projects. It says nothing about house styles that use
  em dashes deliberately, and nothing about prose outside software.
- Two load-bearing sources are 2026 preprints (B4, B5) and have not been peer reviewed.
- A3 could not be fetched from its origin; the figures are corroborated from secondary reports only.
- D3's classifier has F1 0.746, so its section percentages carry that error.
- The em-dash contrast (E1) is the strongest finding here and also the easiest to over-read. It is a habit
  measured across files, and `references/05-what-does-not-work.md` states what it cannot do.
- No claim in this skill has been tested against a held-out corpus. The next real improvement is an eval suite
  in the shape of `adewale`'s: blind judges, ablations, and a null hypothesis that the rules do nothing.
