# The measured shape

Every threshold in `scripts/prose_check.py` was set by measuring, not by asserting. This file records what was
measured, against what, and where each rule is wrong.

## The control corpus

Six technical documents, written by named people, each in a repository where the author's name is on the
commits. Chosen because they are widely held to be good and because nobody would call them machine-written.

| document | author | words |
|---|---|---|
| `ripgrep/README.md` | Andrew Gallant | 2 044 |
| `esbuild/docs/architecture.md` | Evan Wallace | 4 600 |
| `curl/docs/HTTP3.md` | the curl project | 1 575 |
| `rust-lang/book`, ownership chapter | the Rust book team | 4 037 |
| `svelte`, overview page | the Svelte team | 105 |
| Diátaxis, index | Daniele Procida | short |

Measured on 25 September 2026. Code fences, tables, headings and inline code are stripped before anything is
counted, because a rule about sentences must not be computed on a table of transaction hashes.

| metric | control | a machine-drafted corpus of 14 725 words |
|---|---|---|
| median sentence, words | 12 to 18 | **27 to 33** |
| sentences of 35 words or more | **1 % to 5 %** | **31 % to 46 %** |
| sentences under 9 words | 8 % to 37 % | 2 % to 4 % |
| em dashes per 1 000 words | **0.0** in five of six; 0.5 in the sixth | **8.4** |
| hedges per 1 000 words | 1.3 to 3.4 | 2.2 |
| numbers per 1 000 words | 6.1 to 35.6 | 21.7 |

Two findings carry most of the value. **Zero em dashes in 9 400 words of human technical prose**, against 8.4
per thousand in the other corpus. And the long-sentence share: six to nine times the control's, with the short
sentences missing rather than the long ones added.

**A flaw found in this measurement, and what it changed.** The first version of these numbers split sentences
per line. Three of the six control documents hard-wrap their prose at 48 to 66 characters, while the corpus
they were being compared against puts a whole paragraph on one line, so the tool was measuring the wrapping
and calling it sentence length. Joining paragraphs first moved the control's long-sentence share from a
reported 14 % to 27 % down to a measured 1 % to 5 %, which made the contrast larger rather than smaller. The
lesson generalises past this file: a corpus comparison is only as good as the thing both corpora are cut into,
and the check that catches it is measuring something you already know the answer to.

The hedge and number columns are the counter-example that keeps the rest honest. On those two the
machine-drafted corpus is inside the human band, and the rules must not fire there.

## Calibration

The checker was run over the four longest control documents and tuned until it was **silent at tier 1** on all
of them. Before tuning: 62 candidates, 10 at tier 1. After: 40 candidates, **0 at tier 1**. The same instrument
then reported 203 candidates and 34 at tier 1 on the machine-drafted corpus.

What the tuning changed, and why each was wrong:

- Four-space indented blocks were being read as prose, so curl's shell transcript produced 18 sentences opening
  with `% git clone`.
- `greatest` fired on esbuild's *"to the greatest extent possible"*, and `leading` would fire on *leading
  zeros*. Both left the praise list: a word that is also ordinary English cannot be on it.
- An adjective with no figure fired ten times in one chapter of the Rust book, on *many programmers* and *a
  fast path*. The rule now needs a comparison or a superlative in the sentence.
- Parallel openings in a list are good writing. Openings are counted in flowing prose only, and a bold label at
  the start of a line is a field name rather than a sentence.
- Four of four control documents break Google's timeless-documentation rule. That makes it a quality defect
  rather than a voice signal, so it is tier 2.

## The rules

| id | tier | what fires | its false-positive class |
|---|---|---|---|
| PR-01 | 1 | em dashes above 2.0 per 1 000 words in a file | a house style that genuinely uses them; a document quoting text that does |
| PR-02 | 1 | 25 % or more of sentences at 35 words or more (file, five times the control's worst); 12 % at tier 2; each such sentence at tier 2 | reference material, where long enumerations are the content |
| PR-03 | 1 | "not only X but Y", "it's not X, it's Y" | a genuine contrast where both sides are evidenced; apply MT-02 |
| PR-04 | 2 | "serves as", "stands as", "functions as", "represents a" | where the verb does concrete work: enumerating, locating, defining |
| PR-05 | 1 | three or more drift words within 40 lines | a domain where one of them is the technical term (*landscape* in GIS, *align* in bioinformatics) |
| PR-06 | 1 | unambiguous praise words | a quoted marketing claim being criticised |
| PR-07 | 2 | a time-bound word with no date or version in the sentence | a genuinely timeless "currently" inside a changelog entry |
| PR-08 | 2 | a comparison with no figure in the sentence | a comparison whose figure is in the next sentence or a table |
| PR-09 | 2 | hedges above 4.0 per 1 000 words in a file | writing about uncertainty, where hedges are the content |
| PR-10 | 2 | title case in a heading | a proper noun heading; a project whose style guide sets title case |
| PR-11 | 2 | four or more sentences sharing a two-word opening | deliberate anaphora; a structure the reader is meant to feel |

## Reading the output

`python scripts/prose_check.py --shape <files>` prints the shape. Compare it with the table above. A corpus
inside the human band on every row does not need this skill, and a corpus far outside it on one row has one
problem rather than a general fault.

The exit code is 1 when any tier-1 rule fires, so a project that has agreed to these thresholds can gate on it.
Agree first. A threshold imposed on a house style that never consented to it produces a fight, not better
prose.
