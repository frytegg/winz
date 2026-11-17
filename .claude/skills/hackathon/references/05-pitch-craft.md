# Pitch craft

The pitch is not a summary of the work. It is the only part of the work most judges will
ever see.

---

## Two sentences, or nothing

A DeFi lecturer who has won several hackathons, asked for the single most useful thing:

> *If they do not understand what you do in two sentences, it is worthless.*

Apply it twice. To the **idea**, weeks early — see the exit test in `01-find-the-gap.md`.
And to the **opening**, where it decides whether anyone listens to minute two.

The two sentences are not a tagline. They are: the thing that is broken, and what you did
about it. Ours, after several rewrites:

> A lending vault can report one euro a share while it holds eighty cents, and every
> indexer watching the ledger will tell you nothing changed. We built the thing that reads
> it correctly.

---

## The words are the speakers'

**Applies to** every script, voice-over and spoken pitch I help with.

At XRPL NYC (October 2026) the jury liked the pitch, and the owner said why: *"pas le texte IA
que tu génères à chaque fois"*. The two speakers took my script, cut it, and said it in their own
voice. *"Ça a payé"*: the jury's feedback was very good, and the project won its track.

A generated script carries machine phrasing and too many beats. Its author can say it naturally;
anyone reading it from a page cannot. So the division of labour is fixed:

- **I deliver** the facts, the beats in order, the claims to keep, the words never to say, and a
  short draft in spoken register, at most half the length I would naturally write.
- **They write the final words**, by cutting and by saying it aloud.
- **I check their version against the claims ledger only**: numbers, banned words, a promise the
  demo does not keep. I do not rewrite their phrasing back into mine.

---

## The blind read

> **The executable protocol now lives in the `prose` skill, `references/07-blind-read.md`** — three readers,
> the constraints that keep them blind, the question sets to paste, and how to read what comes back. Running
> `/prose` on a pitch or a script runs it as Phase 4. **Run it on the first complete draft**, not before the
> freeze. This section is why it works and what it has caught.

Two sentences you wrote are not two sentences a stranger reads. You cannot test them
yourself: you know what the project is, so every ambiguity resolves correctly in your head
and nowhere else.

So hand the opening to someone who knows nothing — a person, or an agent given no context
beyond those lines — and ask for one thing, in writing, **before they see anything else**:

> Read only this. In two sentences: what is this, and why would you keep reading?

Then compare their answer with what the project actually is. The gap is the finding, and it
is worth more than any amount of rereading your own prose.

Done on a bounty README at the Hedera template bounty. The reader came back with the swap
half right and two things wrong: they believed they would swap from a page with their own
wallet, and that the liquidity life cycle was part of the app. Neither shipped that way —
the wallet path was never signed through the route, and the position writes lived in a
script. The opening had promised a product one directory over from the one in the
repository, and nobody inside the project could see it, because we all knew what we meant.

Rules that make it work:

- **Fix the length first.** Fifteen lines for a document, the first thirty seconds for a
  talk. Whatever a judge sees before deciding to keep going.
- **Ask before, not after.** A reader who has seen the demo cannot un-see it. One blind
  reader is worth three informed ones.
- **Write their answer down verbatim.** "Right on the swap, wrong on two counts" is a
  finding. "They seemed to get it" is not.
- **Fix the opening, not the reader.** If they misread it, the opening is wrong. Adding a
  clarification later in the document does not repair the first fifteen lines.
- **Re-run it after the fix**, with a reader who has not seen the earlier version.

The same test catches the opposite failure: an opening so careful that a reader cannot say
what the thing *is*. If the answer to "what is this" is a slogan rather than an artefact —
"the path that knows" instead of "a project template" — you have written a tagline, not an
identification.

---

## Measure the prose, do not judge it

**Applies when** you have time for one more pass over anything a judge reads, and it is cheap: the measuring
takes minutes.

Writing advice is mostly taste, and taste arguments do not converge. Measurement does. Take four or five
documents written by people whose work nobody would call generated, from your own field, and measure yours
against them: sentence length distribution, how often a dash joins two clauses, how many numbers per thousand
words, how often a superlative appears with nothing behind it.

The gaps are usually stark and always specific. Ours: half our sentences ran past 35 words against 1 to 5 % in
the control, and we used a dash between clauses 8 times per thousand words where five of six human documents
used it zero times. Neither is a rule anyone could have argued us into. Both are one line of output.

The `prose` skill holds the rules, the measured control corpus and a checker that reports candidates with
`file:line`. Use it for the README, the submission form and the video script. Two things it insists on that
matter here: a surface signal is never a verdict on its own, and no rule-set can make a text undetectable by a
machine, so the audience to write for is the reader.

## The adversarial pass on anything written

The demo gets an audit (`04-demo-audit.md`). Anything written that a judge will read —
README, docs, the submission form, the video script — earns the same treatment, and it is
cheap: one pass that only attacks, then one pass that only fixes.

Give the attacker a mandate, not a request for feedback:

- open every link and check it resolves to what the sentence claims;
- trace every number to the artefact that holds it, and flag any figure that exists only in
  prose;
- run every command the document prints, in the order it prints them, and report the real
  exit codes and durations;
- hunt overstatement: "all", "always", "any", "first", "only", a generalisation from one
  account or one day, a claim about a capability the repository does not ship;
- name every paragraph that does not earn its place.

Two rules keep it honest. **The fixer confirms each finding before acting** — an attacker's
finding is a hypothesis, and on this project the fixer refuted three of them with evidence,
including a replacement figure that was wrong by a factor of ten. And **a refuted finding is
recorded as refuted**, not silently dropped: it is how you tell a careful reviewer from a
confident one next time.

What it caught on the same README, in one pass: a capability sold in the headline that did
not ship, a proof-table row that named the wrong event for a measured delay (21 seconds
before the mint, not before the account's first transaction), an "only" with nothing behind
it, and 110 words on a defect in the organisers' own tooling sitting on the first screen,
where it read as blame rather than as rigour.

---

## Structure

Open on **context and subject** before the problem. Mentors were explicit about this: a
jury that does not know what world it is in cannot evaluate a gap in it.

A shape that worked, for four minutes:

| | |
|---|---|
| Open | the mark, or one sentence. Nothing to read. They are listening, not reading. |
| Setting | the world, in the sponsor's own terms. Quote the workshop question if there was one. |
| Problem | the broken promise, with one number |
| What we built | three pillars, one line each |
| Demo | the beats, each one a finding made visible |
| Feedback | only if the rubric rewards it — see `07-contribution.md` |
| Shipped | the countable list, and the repository |

**Demo beats should be findings, not features.** Each beat says: here is something the
technology does wrong, and here is us doing it right. That is what makes a demo an argument
rather than a tour.

**A second shape, for an application, three minutes, with a criterion on market potential.** XRPL
NYC (October 2026), given in the same words by the sponsor's mentor and, independently, by a
business guest:

| | |
|---|---|
| Friction | a problem the whole room has, in one sentence |
| Idea | what we built, in one sentence; the earlier win in twenty seconds at most |
| Market | who needs it and why now |
| Demo | **one complete story between the two parties**, never one side alone: the borrower pledges, the lender reviews and signs |
| Thirty seconds | where it stands, the roadmap, and how it is paid for, without figures |
| Ask | what you want from the room |

The difference from the shape above is the kind of project. **A primitive's demo is a series of
findings. An application's demo is one story, with the finding as one of its moments.** One event,
two advisors: an observation.

---

## Name a competitor as a customer

If your project is the layer other teams depend on — see *Aim one layer down* in
`01-find-the-gap.md` — say so in the pitch, by naming one of them.

Ours, about a protocol presented at the same event that went on to place third:

> *If I want to use BSA Fund to swap my shares for another asset and get liquid, my shares
> have to carry the right net asset value with them, or the secondary market misprices
> them.*

Three things make it work, and all three are deliberate:

- **First person, as their user.** Not "they are broken" — *if I want to use theirs*. You are
  a customer describing what you need, not a rival scoring a point.
- **Generous.** Name them, say their project is worth using. The dependency does the
  argument; you do not have to.
- **Timed late.** By then the jury has watched those projects. You are not claiming a gap,
  you are pointing at one they have been looking at for an hour.

Never do this as an attack. The same sentence phrased as criticism makes you the smaller
project, because it puts you at their level rather than underneath them.

Requires listening during the event: write down what every team is building, and find the
one whose demo quietly assumes your problem is already solved.

---

## Format discipline

Hard constraints are a gift. They force the cuts you would not make.

- **Respect the slide cap.** Ours was ten and the deck reached eleven. Build the check into
  the tool so it warns when you go over — and stays silent when you do not, or it stops
  being read.
- **Respect the clock.** Time every slide, keep a cumulative column, and have the tool
  recompute it so two slides cannot share a timestamp.
- **Go over in rehearsal, then cut.** A script budgeted at six minutes for a four-minute
  slot is fine to *write*; it is not fine to walk up with. Cut beats, never the highest
  scoring slide.
- **Show one journey, and leave the rest for the questions.** At XRPL NYC the team cut the video to
  three minutes, *"straight to the point"*, and removed the beat the first script had called the
  single moment of the demo: the desk refusing a loan when the shares were worth too little. Not
  every feature was shown, and the rest came out in the questions: one juror asked about exactly
  that feature. At
  TOKEN2049 Origins, the product first appeared at 2:14 of 3:00, and we did not place. Two events
  point the same way. Write the list of what goes to the questions, each with its answer, before you
  cut.
- **One page, ten slides, four minutes** are all the same discipline: something must be
  removed for anything to be added. Our CVs were one page and adding a line pushed them to
  two; the fix was cutting elsewhere, not shrinking the font.

---

## Slides

- **One idea per slide.** An illustration that competes with the sentence has taken the job
  away from it.
- **At most one artefact per slide** — a mark, a glyph, a single image. Drawn rather than
  fetched, so nothing needs clearing.
- **Punchy lines in the presenter's mouth, evidence on the wall.** Error codes, hashes and
  finding ids belong in your pocket for the questions, not on a slide a jury will read
  instead of listening to you.
- **No timer, no chrome, no page numbers on screen.** Rehearsal aids belong with the speaker
  notes; the audience should get none of them.
- **The opening slide is the mark alone.** Thirty seconds where they look at you, not at
  text.
- **The closing slide is the one they photograph.** The name, the repository, and the
  countable list of what exists.

---

## The demo, on screen

**Decide what is on the wall for every beat, and minimise switches.**

The jury should see the product, not slides about the product. But switching per beat costs
seconds and attention. What worked: slides for the framing, **one switch** into the browser,
stay there for every demo beat, **one switch** back for the closing.

Two switches in four minutes. Not five.

Before switching, say what they are about to see and why it matters. A judge who lands on a
screen of figures with no frame spends the beat decoding instead of understanding.

**The strongest demo we have watched put the jury inside it.** At Ledger OP3N (October 2026)
the winner had the jurors take part in its demo, on a real device. The owner, in the room,
called the pitch perfect and the demo a wow. One event, so it is not a rule yet
(`10-calibration.md`). But the question costs nothing while the demo is still being designed.
Could a judge do the core action with their own hands, on the hardware in the room? If a
design choice says no (a test key, an emulator, a testnet-only path), know that this is what
you are trading, and decide it in Phase A, not in the week of the pitch.

**And the counter-sample, a week later.** At XRPL NYC the organiser allowed jurors to take part,
and the demo could have let them sign: the browser held the keys. The sponsor's mentor, who then
judged, advised against live: *"Si tu as le moindre bug [en live]…"*. The jury saw a three-minute
recorded video, no juror touched anything, and it won. One win each way: jury participation is a
question to ask the sponsor's people early — *how do you want to see it: on video, live, or in your
hands?* — not a gate.

---

## The run of show

One file, minute by minute, written before rehearsal and updated after the audit.

For each beat: the time, the duration, **what is on the screen**, the exact words with
pauses marked, and the physical gesture — which tab, which scroll, which click.

The gestures are what fail under pressure. Write them as movements, not intentions:
*"Facility tab first, then the picker, then scroll to the third exhibit"* — not *"show the
conduct exhibit"*.

Rehearse from the run of show with the timer running, on the machine you will present from.

---

## When the video is the submission

**Applies when** there is no stage: the entry is a recorded video and whatever a judge chooses to open after
it. Increasingly the default, and it was the case at TOKEN2049 Origins — a fact we learned at 22:40 the night
before the freeze.

**Two consequences, immediately.**

1. **Everything rehearsed for a room has no venue.** Q&A answers, the objection list, the ask at the close.
   They do not disappear; they move, in writing, into the README, as a section a judge meets after the film
   ends. A three-minute voice-over is roughly 420 words and cannot carry them.
2. **The repository stops being documentation and becomes the second half of the pitch.** Budget it as such.

**The organisers' own rules, which are hard gates** — look up your event's, these are the pattern:

| | |
|---|---|
| Length | ETHGlobal **2-4 min**, auto-rejected on upload outside it. Colosseum **≤3 min**. Chainlink **<5 min**, and no video means the entry is invalid |
| Intro | ETHGlobal: *"Keep introductions under 20 seconds"* |
| Content | *"Show your project in action… skip any unnecessary waiting"*; at most 4 bullets a slide; 720p minimum |
| Banned at ETHGlobal | sped-up footage, music over on-screen text instead of narration, phone recordings, and **"text to speech synthesizer / AI Voiceover"** |

**On synthetic narration there is no default, and the question is per-event.** ETHGlobal bans it outright. At
TOKEN2049 Origins a majority of the top main-track demos were animation with an AI voice, some alternating
with a live presenter, and the winners' own videos show webcam insets over a screen share. So: **read the
rule, and whichever way it falls, put a human in the frame.** Ten seconds of a face, outside the scripted
word budget, costs nothing and syncs to nothing.

**What the winners' videos had in common**, counted at Origins across the five announced: all under three
minutes (2:45, 2:24, 2:07 for the three with visible timers), a live clickable URL, a face on camera, and the
product's own interface early and often. One of them showed an **error state** — a wallet without enough
balance, handled gracefully in a chat UI — which answers *"could it be used by its target audience today?"*
in a single frame.

And the thing that is easy to over-invest in: Colosseum's guidance, from an organiser running one of the
largest hackathons in the space, is that *"a clear and well-structured narrative is more valuable than
professional video editing."* Narrative clarity is measured by the blind read. Production quality is not
measured by anything.

---

## The backup video

Record it **last**, once the demo is audited and stable, following the run of show.

- Activate the operating system first, or frame to exclude the watermark.
- Record the demo path only, not the slides.
- Watch it back once, at speed, looking for anything the audit missed.

A recorded demo is also the honest answer when the venue's network is hostile. It is not a
failure to use it.

---

## Speaker notes carry the truth

The notes are where the precision lives that the slide cannot hold:

- The exact result code, if asked.
- Which word to use and which to avoid, and why. *"Say closed-ended vaults, not XLS-66: the
  phase rules are a different standard."*
- The caveat a judge may spot, with its prepared answer.
- The line to cut if you are over time, decided in advance rather than in the moment.

Write them as instructions to a nervous person, because that is who reads them.

---

## Questions

- **Stop when you finish.** Do not summarise. Take the questions.
- Have the hard-questions file from `04-demo-audit.md` in your head.
- For a question you cannot answer honestly in public — a security issue under disclosure,
  a design question you have raised privately — have a prepared sentence that neither
  confirms nor denies, then stop talking. Deciding this in advance is what stops you
  improvising something you regret.
- **"I do not know, and here is how I would find out"** scores better than a guess, in front
  of engineers.
