# Writing what you lived through

Developer-experience reports, survey answers, retrospectives, conversations with a mentor or a judge, the
paragraph that begins *"at the event, I…"*. This register is different from documentation in three ways, and
each one changes what the pass does.

**It is the only register where the missing fact is a person.** Everywhere else, inventing a number is bad
because the number is wrong. Here, inventing a detail puts words in someone's mouth. That person may read it,
may be at the next event, and may be judging the next submission.

**Its tells are inverted.** Documentation prose fails by being too long and too smooth. First-person prose
fails by being too *tidy*: the event arrives pre-digested, with a lesson at the end and no mess in the middle.

**It is often read by the people it describes.** A survey answer goes to the organisers whose tool you are
describing. Write it as if they will read it, because they will.

---

## FP-01 — The provenance rule

Every statement about what happened is one of three things, and the sentence has to make clear which:

| kind | how it reads |
|---|---|
| **what you saw** | "the install failed on the third step" |
| **what you were told** | "a mentor said the gate runs on Linux only" |
| **what you inferred** | "so I assumed the flag was ignored" |

A first-person account that mixes the three reads as invented even when every word is true, because a reader
cannot tell which parts you could be wrong about. Separating them costs four words and buys the whole
paragraph.

## FP-02 — Quote or paraphrase, never in between

> **If it is in quotation marks, it is what was said. If you are not sure it is what was said, it is not in
> quotation marks.**

A reconstructed quote is the single most common fabrication in this register, and the most damaging, because a
quote is exactly the part a reader trusts without checking. When you have the gist and not the words, say you
have the gist: *"the answer, as I understood it, was that…"*.

Where the exact words matter and you have them in writing (a Discord message, an email, a form reply), quote
them and say where they came from. Where you do not, this is an occasion to ask rather than to reconstruct.

## FP-03 — Name the day, the place and the version

The same discipline as documentation, applied to an event. *"At the hackathon"* is horoscope prose. *"In the
Discord channel on 24 September, the organiser posted…"* is an account.

Anything time-bound in this register needs its date for a second reason beyond accuracy: a report about a tool
is about the tool **on the day you used it**, and the maintainers reading it will know whether that version is
still current. Without the date, a fair report reads as an unfair one six weeks later.

## FP-04 — Keep the part where you were wrong

A retrospective in which the author was right throughout is a press release. The specific, checkable rule:

> **The account must contain at least one thing you believed at the time and that turned out to be false, or
> one thing you tried that did not work, with what it cost.**

This is not humility for its own sake. It is the strongest available evidence that the account is real, and it
is the part other people actually learn from. The same move works in a survey answer: *"I spent two hours on
this before finding the flag in the source"* tells a maintainer more than any adjective.

## FP-05 — No feelings you did not verify

Write what people did and said. Do not write what they felt, wanted or thought, unless they told you.

- **Wrong:** "the mentor seemed excited about our approach"
- **Right:** "the mentor asked twice how the gas rule was derived, and told us to put the figure in the README"

The second is more useful *and* is the one you can defend if they read it. Attributing enthusiasm to a judge is
also the fastest way to make a report sound like marketing.

## FP-06 — Criticism lands on the artefact, never on the person

In a developer-experience report you are usually describing something that failed. Aim at the thing:

- **Wrong:** "whoever wrote the setup guide did not test it"
- **Right:** "the setup guide's first command fails on Node 20.18.3 with `EUNKNOWNCONFIG`; the same command with `--legacy-peer-deps` succeeds"

The second is actionable, unfalsifiable-proof-free of insult, and it survives being forwarded to the person who
wrote the guide. Give the exact error string, the version, and what you did next. That paragraph is worth more
to a maintainer than a page of impressions.

## FP-07 — One story, not a summary of several

The temptation in a survey box is to compress five days into a paragraph of themes. Themes are where
generic prose comes from. Pick the single sharpest instance, tell it with its numbers, and let the theme be
obvious rather than stated.

> "Documentation could be clearer" is a theme.
>
> "The brief's own install command has a typo that makes it fail, and I lost 40 minutes to it on day one
> before finding the corrected form in a Discord reply" is a story, and it gets fixed.

## FP-08 — The register's own vocabulary check

The checker's drift list is tuned for documentation. In first-person writing, watch four more shapes, none of
which a regular expression catches well:

- **The tidy arc.** Problem, struggle, insight, lesson, in that order, every time. Real events rarely resolve.
- **The lesson sentence.** A paragraph that ends by telling the reader what to take from it. Delete it: if the
  account earned the lesson, the reader has it already.
- **The plural you.** *"We often find that…"* in an account of one week by one person.
- **Borrowed drama.** "A race against the clock", "down to the wire". If the deadline mattered, give the time
  you submitted and the deadline.

## How this interacts with the rest of the skill

Everything in `01-mechanism-tests.md` still applies, with one change of emphasis. The horoscope test (MT-01)
is the strongest tool here, because a first-person account that could be about anyone's week is the defect this
register produces. The limit test (MT-05) becomes the provenance rule above. And invariant 3, never invent a
fact to fix a sentence, is not a style rule in this register. It is the whole of it.
