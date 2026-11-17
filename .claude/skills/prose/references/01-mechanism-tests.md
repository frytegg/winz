# The mechanism tests

A regular expression can find a word. It cannot find a paragraph that says nothing in well-formed sentences,
and that is the defect a reader actually notices. These tests do. Each one is a **procedure with an
observable outcome**, not a matter of taste: two people applying the same test to the same sentence should
reach the same answer, and if they do not, the test is badly written and belongs here as a bug.

Apply them to every candidate the checker reports, and to every paragraph it does not.

---

## MT-01 — The horoscope test

> Could this sentence have been written by anyone, about anything, without doing the work?

Read the sentence with the subject removed. If it still parses as advice, it is horoscope prose. A README that
says "robust error handling ensures reliability" survives having its subject swapped for any other project,
which is how you know it carries nothing.

**Pass:** the sentence contains something only someone who ran the thing could know. A number, a version, a
date, a response code, a file path, a sequence of events, a cost.

**Fail, and the fix:** replace the claim with what you measured. If nothing was measured, cut the sentence and
say so in the report. Do not invent the measurement (invariant 3).

*Source: the "Horoscope Test" in `aplaceforallmystuff/the-antislop`, and Wikipedia's "Signs of AI writing"
section on vague attribution.*

---

## MT-02 — The emphasis-source test

Take any sentence carrying rhetorical shape (a contrast, an inversion, a rising tricolon, a dramatic short
sentence after a long one). Write the flattened version: same claim, cadence removed. Then judge the residue.

> **If the flattened version still names an actor, a mechanism or a limit, the idea was doing the work.**
> **If it collapses into a generic statement, the rhythm was doing the work, and the rhythm has to go.**

Example from a real pass. Original: *"This is not a wrapper. It is the path that knows."* Flattened: *"This
library checks things before sending."* The residue names no mechanism, so the antithesis was carrying the
sentence. The repair was to name the check and the failure it prevents.

*Source: `adewale/anti-slop-writing`, doctrine reference, verbatim test.*

---

## MT-03 — The syntax-relation test

When two clauses are joined by a dash, a colon, a semicolon or a bare comma, restate the relation in plain
prose with an explicit connective: **because, although, when, where, once, so that, which means**.

> **If you cannot supply the connective without inventing a relation that is not there, the punctuation was
> standing in for a thought.**

This is the test that makes the em dash rule (PR-01) honest. A dash joining two clauses whose relation is
"because" should usually be "because". A dash that survives this test is a dash that earns its place.

*Source: `adewale/anti-slop-writing`, doctrine reference, verbatim test.*

---

## MT-04 — The actor test

Find the grammatical subject of every claim about a change, a failure or a decision. Where the subject is an
abstraction (*the system*, *the process*, *a complaint*, *the integration*), name the actor instead, or name
the mechanism.

> "A complaint becomes a fix" is false agency. The complaint did nothing. Someone fixed it.

In technical documentation the actor is often a program, and that is fine: *the relay refuses*, *the token
service answers 184*, *MetaMask writes Unavailable*. What is not fine is a sentence in which nothing acts.

*Source: `hardikpandya/stop-slop`, "False Agency". Note that this repository's scoring gate and its
"cut quotables" rule both measured as having no effect; see `05-what-does-not-work.md`. This rule is kept
because it is a mechanism test, not a surface ban.*

---

## MT-05 — The limit test

Every substantive claim needs one of three things nearby: a measurement, a scope, or an admission.

- **Measurement:** "up to eight times" beats "much larger".
- **Scope:** "on one wallet, one version, one evening" beats silence about the sample.
- **Admission:** "no browser wallet has signed through this route" beats leaving the reader to discover it.

A document with no limits section is making a claim about itself that it did not measure. The control corpus
does this well: ripgrep's README carries an explicit *when not to use this* section and hedges its own
benchmarks with "a single benchmark is never enough".

**The strongest single move in this whole skill:** replace an adjective with the measurement it stands for.
Google's own technical-writing course gives the canonical pair. *"Setting this flag makes the application run
screamingly fast"* becomes *"Setting this flag makes the application run 225 to 250 % faster"*.

---

## MT-06 — The density probe, not the blocklist

Vocabulary tells are population statistics, not verdicts. In 15 million PubMed abstracts the word `delves`
appeared 28 times more often in 2024 than its pre-2023 baseline, and `underscores` 13.8 times. That is a real
signal across a corpus and says nothing about one paragraph.

> **One word from the drift list is nothing. Three or more clustered in a passage is a signal worth reading
> the passage for.**

And the list decays: `delve` dropped sharply in arXiv abstracts within months of being publicised, while
*significant* kept rising. A blocklist written today is wrong next year. The probe survives because it asks
about density, not membership.

*Sources: the PubMed excess-vocabulary study, and the follow-up measuring decay after publicity. Both in
`research/INDEX.md`.*

---

## MT-07 — The rewrite check

> **Every rewrite is judged by the same rules as the text it replaces.**

If the replacement paragraph would have been flagged on the way in, it is flagged on the way out. This sounds
obvious and is the most commonly skipped step, because the author has just solved a problem and feels finished.

Two questions close it:

1. Did this rewrite need a fact the source does not contain? If yes, did I ask, or did I invent it?
2. Does the rewrite still say what the author meant, or what I found easier to say well?

*Source: `adewale/anti-slop-writing`, "Rewrite check is mandatory".*

---

## MT-08 — The heading test

A heading names what is in the section, not what it means. *"Challenges and future prospects"*, *"Key
takeaways"* and *"Understanding the architecture"* are shapes a model reaches for when it has no specific
content to announce. The test:

> Could a reader predict, from the heading alone, one concrete thing the section contains?

*"Why a burn needs an approval the simulators do not check"* passes. *"Advanced usage"* does not.

---

## How to record the outcome

For each candidate, one line: the rule, the file and line, the test you applied, the verdict, and the action.
A refusal is a result and is written down, with its reason. A pass that reports only what it changed hides the
half of the work that mattered.
