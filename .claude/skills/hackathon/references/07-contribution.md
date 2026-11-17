# The contribution track

The feedback **deliverable** — the written report, the upstream filings, the dedicated
slide. This is the part that is gated on the rubric.

It is not the same thing as finding the gap. That is `01-find-the-gap.md`, it happens before
the event, and it happens at any weighting because it is how you get an idea. This file is
only about what you *publish*.

---

## How much to invest

| Rubric weight | What to produce |
|---|---|
| **High (25 %+)** | A written report as a first-class deliverable. Filings before the deadline. A slide, and a way to reach the findings from inside the pitch. |
| **Some (5-20 %)** | A short report or a well-organised register. Filings when convenient. One line in the closing slide. |
| **Zero** | Keep the findings log. File upstream **after** the event. No slide, no report. |

The zero row still files. Not for points — a maintainer who merges your fix knows your name
the next time you apply for something, and the filing costs an hour once the work is done.

---

## The journal, written as it happens

**Open `assets/dx-journal.md` on day one and add a row the moment anything goes wrong.** Not at the
end of the day, not at the end of the event: at the moment, with the verbatim error text pasted in.

This is the step the rest of this file silently assumed. "Rewrite it at the end from what actually
happened" only works if what actually happened was written down while it was happening. Three weeks
later you remember that an endpoint was awkward. You do not remember that it answered
`HTTP 200 {"code":40304,"msg":"Service not available due to compliance restriction"}` from one network
and `200 code=0` from another, which is the difference between a sentence and a finding.

It leaks in a specific way, so watch for it. On the BNB hackathon the journal reached fifty-seven rows
and the practice looked solid — then a page of the submission claimed an endpoint change "is in the
Developer Experience Report" when nothing had been written down at all. The row was reconstructed, but
only because someone asked. **The failure is never "I decided not to record this". It is finishing the
fix, feeling the relief, and moving on.** So:

- Write the row **before** you fix the thing, not after. The fix is the reward; take the row first.
- A finding you mention in a doc, a commit message or a chat is not recorded. Only the journal counts.
- When you catch a gap, do not just fill it — ask what made it possible, because the next one will
  arrive the same way.

The journal is not the report. It is long, ugly, dated, and nobody reads it end to end. The report is
three pages built from it, and the journal ships beside it as the evidence register.

---

## The report

Ours was **three pages**, and staying three pages was a decision defended repeatedly. It is
read end to end by someone who did not ask for it; length is what stops that happening.

- **Written from the build, not from reconnaissance.** A report assembled before any code
  existed cannot honestly claim "our experience". Rewrite it at the end from what actually
  happened.
- **Three headline friction points**, chosen for time cost times likelihood another
  developer hits them — picked from the journal by sorting it, not by recalling the worst.
- **Every claim evidenced** — transaction hash, file and line, verbatim error string.
- **Signed**, with the environment pinned: network, build version, library versions, dates.
- **Show your corrections.** Ours ends by naming the things it got wrong and withdrew. A
  report you cannot catch being wrong is worth less than one that shows its own audit.

Keep the long evidence register as a **separate document**. Binding thirty-three pages of
tables behind a three-page letter produced a thirty-six page thing that was neither. Two
documents, the letter citing the register by name.

Build both from source with one command, and make the build refuse quietly-broken states —
ours prints a warning if the report ever exceeds three pages.

---

## Filing upstream

The highest-value hour after the event, and the one with the most ways to embarrass
yourself.

### Before you file, check the world has not moved

Re-verify everything, the same day you file:

- **Is the defect still there?** Read the current source, not your notes.
- **Has someone already fixed it, or filed it?** Search open and closed issues and pull
  requests with the specific identifiers.
- **Has the target moved?** We drafted a tutorial fix and, thirteen hours later, the
  maintainer pushed commits carrying four of its five fixes. Filing it unchanged would have
  put a near-duplicate in front of the person who wrote the original — with a sentence
  asserting their work did not touch those files.
- **Are your hashes still resolving?** The report we were correcting had died of being
  unreproducible.
- **Does the repository have contribution rules, a template, a CLA?** Read them.

### Choose the right shape

- **A comment on an open pull request** beats a competing pull request, when the PR already
  touches the section you want changed.
- **A new issue that links the old one** beats commenting on a closed six-month-old issue —
  then add a short courtesy comment on the old one pointing at the new.
- **Adding evidence to an existing issue** beats opening a second one for the same thing.

### Order matters

If one filing references another, file in dependency order and put the sentences in the past
tense once they are true. Ours had two: a cross-reference saying "raised on #587" had to go
second, and an issue saying "the hashes are posted there" needed the comment filed first.

### Tone

A developer reporting what happened, with the reproduction. Not a pitch, not a complaint, no
mention of a competition or a prize. Never call documented behaviour a bug — say what is
**missing**.

Do not narrate another person's state of mind. We had a sentence inferring, from timestamps,
how long another developer had struggled with the same problem. He would be notified by the
cross-reference. It was cut.

### What good looks like

Our headline issue was filed to the server repository arguing: the behaviour is intended,
the implementation is correct, and what is missing is one paragraph of documentation.

Within six hours a maintainer at the sponsor transferred it to the documentation repository
and renamed it *"Add clarification to docs on PreviousFields metadata rules"*.

That is acceptance. The issue was framed so that agreeing with it was easy, and the action
to take was already named.

---

## Putting it in the pitch

If the rubric rewards it, the mistake is a slide that lists findings. It reads as a separate
achievement bolted to the end of a demo.

**Say what the findings did to the product.** Ours became:

> We did not set out to write a feedback report. Every demo you just watched started as
> something that broke.

Each demo beat is then a finding made visible, and the feedback slide collects rather than
argues. The finding identifiers stay in the speaker notes. Put a code on the slide that
takes a judge straight to the document.

---

## Automated capture

Some events ship a tool that captures your session and asks for periodic analyses. If so:

- **Report honestly, including empty periods.** Several of ours held no work worth
  reporting and nothing was submitted. That is a better signal than padding.
- **Correct your earlier submissions** when you find you were wrong. One of ours retracted
  its own previously top-ranked finding.
- **Watch what the tool counts.** Ours reported "events" that were text matches in prose —
  a transaction type mentioned in a paper counted the same as one submitted to the network.
  Knowing that stops you trusting its numbers, and is itself worth reporting to the
  organisers.
