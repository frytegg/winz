---
name: prose
description: Write and revise READMEs, technical documentation, pitches and first-person accounts (developer-experience reports, survey answers, retrospectives) so they read as written by the person who did the work. Rules are measured against a named corpus of human-written technical prose, and a deterministic checker reports candidates with file:line. Use before publishing a README or a docs set, before a hackathon or grant submission, and after any pass where a model drafted prose a human will judge.
argument-hint: "[paths...] [--check-only] [--shape]"
---

# /prose — make the writing read as the work

This skill has one job: take documentation or a pitch that is **already true** and make it read as though the
person who ran the thing wrote it. It does not check whether the docs are correct. That is the job of the
`harden` skill's readability-docs lens, which owns drift, dead links, stale commands and unverified claims. Run
that first. A page that reads beautifully and lies is worse than one that reads flatly and is true.

## What this is not

It is not a detector evader. No text-only detector is reliable in either direction: seven detectors produced a
**61.22 % false-positive rate** on 91 essays written by non-native English speakers, OpenAI withdrew its own
classifier after measuring 26 % true positives, and Vanderbilt disabled Turnitin's. Worse for anyone trying to
target them: asking a model to "enhance the word choice" of those same essays dropped the false-positive rate to
11.77 %, which means the detectors are substantially measuring lexical sophistication rather than authorship.
`references/05-what-does-not-work.md` has the figures and the sources.

So the goal here is a **human reader's verdict**, not a machine's. The properties that earn it (a named actor, a
measured number, a stated limit, a sentence that varies in length because the thought did) are the same
properties that move statistical signals in the right direction. That is a side effect, and it is the only
honest thing to promise.

## The one-sentence theory

> Machine prose is fluent about things it did not do. The cure is not better sentences. It is putting the work
> into the sentences: what you ran, what it answered, what it cost, and what you still do not know.

## Invariants

1. **Never edit by taste or by score.** Every change cites a rule id from `references/`. A finding with no rule
   is a preference, and a preference is the author's to keep. This mirrors the `harden` skill's RD-01.
2. **Candidates, not verdicts.** `scripts/prose_check.py` reports surface signals with `file:line`. A surface
   signal is evidence of nothing on its own. Apply the mechanism tests in `references/01-mechanism-tests.md` to
   each candidate before touching a word, and record the ones you refuse.
3. **Never invent a fact to fix a sentence.** When a rewrite needs a number, a name, a version or a date that
   the source does not contain, ask the author or cut the claim. Fabricated specificity is the one defect worse
   than vagueness, because it survives review and ships.
4. **Preserve the author's voice.** The target is their prose without the tells, not this skill's prose. If a
   rewrite could have been written by anyone about anything, it fails its own test.
5. **Measure before and after.** Run `--shape` on the corpus first and last, and put both in the report. A pass
   that cannot show what moved did not happen.
6. **The skill obeys its own rules.** Before shipping any change to this skill, run the checker over
   `SKILL.md` and `references/`.

## The pass

**Phase 0, scope and baseline.** List the files. Run `python scripts/prose_check.py --shape <files>` and keep
the output. Read `references/03-readme-docs.md` for a README or a docs set, `references/04-pitch.md` for a
pitch, `references/06-first-person.md` for anything written as "I" about something that happened. Know which
one you are writing: the four documentation kinds do not mix, and the most common structural
defect is a reference page with a tutorial inside it.

**Phase 1, mechanical candidates.** Run the checker. It reports eleven rules, tiered. Tier 1 is a habit the
control corpus does not have; tier 2 is worth a second look. Never fix by running a find-and-replace over the
tier-1 list: the rules are probes, and each one has a false-positive class documented beside it.

**Phase 2, mechanism tests.** For each candidate, and for every paragraph the checker did not flag, apply the
tests in `references/01-mechanism-tests.md`: the emphasis-source test, the syntax-relation test, the horoscope
test, the actor test, the limit test. These are the judgement half, and they find what no regular expression
can: a paragraph that says nothing in well-formed sentences.

**Phase 3, the rewrite, one defect at a time.** Fix the defect the rule names and nothing else. Do not improve
the sentence while you are there. Every rewrite is re-checked against the same rules, because a rewrite that
would have been flagged on the way in is still flagged on the way out.

Two things decide whether a long document actually moves, both measured on 1 October 2026 (`evals/`):

- **Ask for a rate, not a range.** Roughly **one edit per 120 words**. A reviewer given "15 to 40" returns 40,
  which lands a 3,500-word README inside the band and leaves a 9,700-word document outside it.
- **Never put two editors on overlapping prose.** Give each a region bounded by headings that exist in the file
  and say the regions do not touch, or run them in sequence on the file as the previous one left it. Two agents
  on two halves of one document lost 16 edits of 99 where their halves met.

Apply what comes back with `scripts/apply_edits.py`, which refuses an edit whose replacement does not carry the
same numbers, links, hashes and backticked identifiers as the text it replaces. Invariant 3 is a promise about
the editor's own work; this is the only thing that checks it.

**Phase 4, the blind read.** Everything above measures the text. This measures a reader, and it is the only
phase that can tell you the prose is clear and still wrong about what it transmits. **It is part of the pass,
not an optional extra**: running this skill on a pitch, a video script or a README opening runs the blind
read.

Three readers who never see each other's work, spawned fresh with no context: one gets the opening only, one
gets the whole text at full care, one gets the whole text while told it is tired and on its nineteenth item.
The last two bracket the answer — the careful reader is the comprehension ceiling, the skimming one is closer
to a real judge on a review pile. A finding named independently by two of them is real; one reader's
confusion is that reader's habit.

`references/07-blind-read.md` has the protocol: the constraints that keep them blind (no tools, no filesystem,
no identifying the product), the question sets to paste, what each answer shape means, and a worked example.

**Run it on the first complete draft**, and again after every rewrite that touches the opening or the
load-bearing explanation. Run late it is a report, not a test: on one submission it ran the morning of the
freeze, found that the single load-bearing sentence did not land and that no reader could say who paid, and
neither could be fixed because the audio was already cut.

**Phase 5, report.** The shape before and after, every rule that fired with its file and line, every candidate
refused and why, and what you could not fix without a fact you do not have.

## Files

- `references/01-mechanism-tests.md` — the judgement tests. The most valuable file here.
- `references/02-measured-shape.md` — the eleven checker rules, what each was measured against, and its
  false-positive class.
- `references/03-readme-docs.md` — structure for READMEs and documentation sets, with the empirical work.
- `references/04-pitch.md` — a pitch, a submission form, a video script.
- `references/05-what-does-not-work.md` — the null results. Read this before importing a rule from anywhere.
- `references/07-blind-read.md` — Phase 4. Three blind readers, the constraints, the questions, and how to
  read what comes back. The only test here that measures comprehension rather than the text.
- `references/06-first-person.md` — accounts of what you lived through: developer-experience reports, survey
  answers, retrospectives, a conversation with a mentor or a judge. The register where an invented fact is a
  person rather than a number.
- `research/INDEX.md` — every source, graded measured or asserted, with what it actually says.
- `scripts/prose_check.py` — the checker. `--shape` for the numbers, `--json` for a machine, exit 1 on tier 1.
