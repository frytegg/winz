# What does not work

Read this before importing a rule from anywhere, including from here. The field is full of confident advice
that has been measured and found to do nothing.

## A competitor's best rules measured at exactly zero

`adewale/anti-slop-writing` took the two strongest ideas from the most popular anti-slop skill on GitHub
(17 500 stars): its 35-out-of-50 quality gate and its "cut quotables" rule. It A/B tested them across three
models with 18 paired deltas.

> **Effect: 0.00. Confidence interval [0, 0]. p = 1.0. Rejected.**

Its conclusion is the rule this skill inherits:

> Before importing a surface rule, flatten it to the behaviour it asks for, and check whether an existing
> mechanism test already produces that behaviour.

That is why `references/01-mechanism-tests.md` is the centre of this skill and the word lists are at the edge.

## Detectors are not a target worth aiming at

| finding | figure | source kind |
|---|---|---|
| Seven detectors on 91 TOEFL essays by non-native speakers | **61.22 %** mean false-positive rate; 18 of 91 flagged by all seven | measured, *Patterns* 2023 |
| The same essays after a model "enhanced the word choice" | false positives fell to **11.77 %** | measured |
| US 8th-grade essays, then simplified | 5.19 % → **56.65 %** | measured |
| OpenAI's own classifier | 26 % true positives, 9 % false positives; withdrawn 20 July 2023 | measured, withdrawn by its author |
| Vanderbilt, on Turnitin's detector | disabled 16 August 2023; ~750 mislabelled papers a year extrapolated | institutional decision |

The third row is the one to sit with. **Making a text simpler made detectors eleven times more likely to call
it machine-written.** They are substantially measuring lexical sophistication. Writing to beat them would mean
writing worse.

There is also a proved ceiling. Sadasivan et al. show AUROC is bounded by ½ + TV − TV²/2, where TV is the total
variation distance between the human and machine text distributions: as the two converge, no text-only detector
can work at all. That is a bound, not a measurement, and it points the same way.

## The tells are epidemiology, not evidence

Every measured tell in the literature is a corpus-level frequency shift.

- 15 million PubMed abstracts: 454 excess words in 2024, *delves* at 28 times its baseline. The authors infer
  that at least 13.5 % of 2024 abstracts were LLM-processed. **About the corpus, not about any abstract.**
- 146 239 congressional press releases: unspaced em-dash density rose from 0.10 to 0.217 per 1 000 characters
  between 2021 and 2025. The authors state it plainly: *"a population-level marker, not a per-release
  authorship detector."*
- Tricolon appears at nearly twice the human rate in one 2026 preprint, which is unreviewed.

So a document with three em dashes is not guilty of anything. A document with 8.4 per thousand words, in a
genre where six human documents have 0.0, has a habit worth examining. The difference between those two
sentences is the whole discipline.

## Beliefs with thin evidence

- **Burstiness.** The vendor that popularised the term stopped using it in autumn 2023 and moved to a
  deep-learning architecture. It never meant sentence-length variance: it meant variance of per-sentence
  perplexity. Most advice repeating it is repeating a misreading of a retired metric.
- **Paragraph-shape uniformity.** No study measuring it as a detection feature was found. Sentence-length
  uniformity is measured; paragraph shape is folklore.
- **Hedging density.** Descriptive linguistics has a lot on hedging and almost nothing prescriptive. The
  threshold in this skill comes from the control corpus, not from a study.
- **Humanizer tools.** Effectiveness claims trace to vendor blogs. One 2026 preprint claims over 96 % bypass,
  unreplicated.

## Blanket bans this skill refuses

- **Ban all em dashes.** The measured control uses zero, which is a strong reason to write fewer, and no reason
  at all to forbid one that passes MT-03.
- **Ban all adverbs, all passive voice, all Wh- openers.** Passive voice is correct when the object is the
  topic: *the transaction was charged anyway* is about the transaction.
- **Ban the rule of three.** Three is over-represented in machine prose. Three is also how many items there
  sometimes are.
- **Score prose out of fifty.** Measured at zero effect, and it invites editing to the score.

## The honest promise

This skill cannot make a text undetectable, and anyone who says their rule-set can is selling something that
the impossibility bound and the false-positive tables both contradict. What it can do is make a text carry
what only the author could know. A reader can tell the difference. That is the audience that matters, and it is
the one that was never fooled by cadence in the first place.
