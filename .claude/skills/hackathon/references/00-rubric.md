# Rules and rubric

The first hour of Phase A, before any reading of the technology. Cheap, and it decides where
every later hour goes.

---

## Read the actual rules document

Not the landing page, not the Discord summary. The rulebook, in full, and note its version —
ours had two circulating versions with different presentation lengths, and the newer one
changed the run of show.

Extract, into one file:

- **The scoring rubric, with weights.** Every criterion and what it is worth.
- **The format**: presentation minutes, Q&A minutes, slide cap, demo allowed or not.
- **Which surfaces are judged at all.** Read this as its own question, separately from eligibility. Video
  only? Video plus a live pitch? Slides? Is the repository opened? At TOKEN2049 Origins the answer turned out
  to be *the video alone, no live pitch, no slides*, and we learned it at 22:40 the night before the freeze.
  Six rehearsed answers and a whole "if a judge pushes, in the room" section had been written for a room that
  did not exist. **The rubric tells you what is scored; this tells you where it is scored, and it decides
  which artefacts are worth an hour.**
  The opposite case, at XRPL NYC (October 2026): the kickoff said Implementation would be judged by the
  mentors walking the room on the Sunday morning, *"so you probably don't need to worry too much about that
  on the pitch"*, and a mentor said technical judges read the repository before the pitch. Two surfaces that
  are not the pitch, each worth preparing as such: two minutes of technical walkthrough at the table, and the
  README.
- **The submission-media rules, in full.** These are hard gates and they are usually not in the rubric:
  - **Length caps, which are enforced mechanically.** ETHGlobal auto-rejects on upload outside 2-4 minutes.
    Colosseum caps at 3. Chainlink at 5, and *no video at all makes the entry invalid*.
  - **Minimum resolution**, and whether a phone recording is allowed (ETHGlobal: it is not).
  - **Intro length.** ETHGlobal: *"Keep introductions under 20 seconds"*.
  - **Whether synthetic narration is allowed.** ETHGlobal's prohibited list names *"text to speech
    synthesizer / AI Voiceover"* outright, alongside sped-up footage and music-over-text. Other events do not
    care at all: at TOKEN2049 Origins a majority of the top main-track demos were animation with an AI voice,
    some alternating with a live presenter. **This is a per-event fact with no default. Look it up before you
    choose a narrator, not after you have recorded.**
- **The deliverables**: what is submitted, in what form, by when. Freeze time.
- **The rules about pre-existing work.** What may be brought from before the event.
- **Anything about disclosure**: security issues, private reporting obligations, and when
  they trigger. Read the exact wording; ours tied an obligation to "before any
  presentation", and a team stand-up counts as a presentation.
- **Tracks, prizes and sponsor-specific criteria.** Sponsor prizes often have their own
  rubric and it is usually easier.

---

## Derive the effort allocation, in writing

One table. Criterion, weight, what would score full marks, who owns it, how many hours.

This is the discipline that stops a team spending Saturday night on a feature worth 5 % and
nothing on a deliverable worth 40 %.

**Then add the scheduling rule that the table alone does not give you: the next hour goes to the rubric's
weakest-covered item, not to the most interesting one.** Interest and coverage are uncorrelated, and the
interesting item is usually the one already at 90 %.

At Origins we ran a full mathematical audit workflow on a seven-page LaTeX annex — real work, three real
errors found — while the price of the product never got a number, after two business judges had already said
in a rehearsal that there was no payer and no price anywhere. Two independent blind readers then came away
from the finished video unable to say who paid. The annex was at 90 % and went to 100. The pricing was at 0
and stayed there.

A criterion with **no artefact at all** outranks every criterion with a mediocre one. Sort by coverage
ascending and work down.

Our event scored developer feedback at **40 %** — the single largest criterion, larger than
the product. That is unusual. It changed what got built and when. A different event may
score it at zero.

---

## What changes with the rubric, and what does not

**Gated on the rubric:**

- The written feedback report, its length and polish
- A dedicated slide on it, and a way for judges to reach the findings from inside the pitch
- Whether upstream filings happen before the deadline or after the event
- How much time goes into the deliverable's presentation rather than its content

**Never gated on the rubric:**

- **Finding the gap.** This is Phase A and it is how you get an idea at all. It is not a
  feedback activity, it is a positioning activity. See `01-find-the-gap.md`.
- **The findings log.** It is the ledger that lets you prove things later, whether or not
  anyone scores it.
- **Verification discipline.** Unscored work still has to be true.

A useful way to hold both: the rubric decides *what you publish*. It never decides *what you
find out*.

---

## The removal test, for tracks and sponsors

**Applies when** the event has several tracks or sponsor prizes and you are deciding how many to be eligible
for.

Chasing every track produces visibly incoherent projects, and judges see it immediately. But the winner of
TOKEN2049 Origins overall, CoinGraph, combined three sponsors — NOWNodes, Masumi and Chainlink CRE. So the
rule is not "stay in one track". It is this:

> **Delete each sponsor technology in turn. Does the one-sentence description of the product change?**
>
> If yes, it is load-bearing, and the extra eligibility is free.
> If no, it is a screw, and you are paying credibility for a lottery ticket.

CoinGraph passes on all three: NOWNodes reads the chain data, Chainlink CRE attests every answer — which *is*
the product, *"every number sourced and fingerprinted"* — and x402 on Cardano is how agents pay per call.
Remove any one and the sentence loses a limb.

**The secondary tell: can you say all of them in one sentence with no "and also"?** CoinGraph can — *"verified
intelligence for agents, paid per call on Cardano, attested by Chainlink."* A project that needs "and we also
used X" has a screw.

**The direction of design is the whole thing.** You design the product, you find that it needs a data source,
a proof and a way to get paid, and *then* you pick each sponsor's technology for a slot you already had. The
failure mode runs the other way: here are four sponsors, what can I bolt on.

### Reopen the map after any pivot

A pivot invalidates the rubric table, the prize map and the effort allocation. Redo all three on the spot, in
fifteen minutes.

Our Phase A idea at Origins was multi-sponsor with every piece load-bearing: x402 for origination, Chainlink
CRE for pricing. The pivot to a single escrow contract collapsed it to one sponsor, and **nobody reopened the
prize map.** We went from three eligible slots to one without ever deciding to.

---

## Questions to ask the organisers early

Ask on day one, in writing, in the public channel. Answers change plans and the answers are
usually not in the rulebook.

- Does contributed work to the sponsor's own repositories count toward the feedback or
  community criterion?
- Is the presentation N minutes including or excluding Q&A? Is there a hard slide cap?
- May we use work started before the event, and if so must we declare it?
- Which network or environment is authoritative for judging, and will it be reset?
- Is a live demo expected, or is a recording acceptable?
- May a juror take part in the demo? At XRPL NYC the organiser answered yes, in writing, before the event.
- Who scores the implementation, and where: in the pitch, at the table, or in the repository?

Write the answers into the same file as the rubric. On the day, nobody remembers who said
what in a thread.

---

## An unanswered question is a finding, not a failure

**Applies when** the organisers take questions at all, in any channel.

Ask early, ask in writing, and ask in the most public place the programme allows. Then record what happens,
because the silence is data:

- **A written answer** closes the question and helps everyone, including you.
- **A deferral to a call** tells you the answer is not settled internally. Prepare the call, and ask again there
  for the written version.
- **No answer at all**, especially to a question several people have asked, is a defect in the programme. It
  belongs in the feedback survey if there is one, phrased as what it cost you rather than as a complaint.

Four questions we sent about a stage-one gate were deferred to a call and never answered in writing, after an
explicit request that a written answer would help every participant. That is worth exactly one line in the
survey and no resentment at all: the people running these programmes are usually two people doing it beside
their real job.

**Ask anyway, and early.** The questions you send in week one get answered. The ones you send in the last
week compete with everyone else's panic.

## Watch for the rubric's own gaps

Two things routinely score and are never in the rubric:

- **Whether the judges can verify your claims themselves.** No rubric line says "we will try
  to reproduce your number", but a jury of engineers does it in their heads, and a number
  they can recompute from the screen buys more credit than a number they cannot.
- **Honesty under pressure.** Retracting your own claim in front of the people who own the
  code is not a scored criterion anywhere. It was, in our event, part of what the mentors
  named afterwards.

Neither is gameable. Both are consequences of doing the rest of this skill properly.
