---
name: hackathon
description: Win a hackathon by finding the gap in the sponsor's technology before the event starts, then building and pitching only what can be proven. Use from the moment a hackathon is on the calendar, through the sprint, to the upstream filings afterwards. Covers idea-finding, verification discipline, demo auditing, pitch craft and stage operations.
---

# Hackathon

Written after winning the De Vinci Blockchain XRPL Lending Protocol hackathon (Paris,
12-13 September 2026) with Orma, team BuzzBallz, and extended during a remote template
bounty in September 2026. Every rule here is attached to something that actually happened,
and several are attached to mistakes.

**Two sources, two levels of proof.** The rules from the XRPL event come from a hackathon
that was won. The rules added during the bounty come from a submission **that was not
selected** (October 2026): they are good practice, drawn from measurement and from reading what
the organisers actually rewarded, and they are not evidence about winning. Where a rule comes
from that source it says so. What the loss taught is in `references/09-previous-rounds.md`
§ A second round by the same organiser.

**A third source, October 2026: a podium.** Ledger OP3N, third of thirteen, with the gap play
the organisers' brief asked for and a demo that could only run on the emulator. What it taught
is in `references/10-calibration.md`, sorted into what one result licenses now and what waits
for a second event.

**A fourth source, October 2026: a second win.** XRPL NYC, Lending track, first of twelve, with
the same product line as the Paris win and the same sponsor's people in the room. Built after a
full dry run of the build (`references/12-dry-run.md`). What it confirmed, what it overturned and
what it only suggests is in `references/10-calibration.md` § A second win.

**Every rule carries the shape of event it came from, and events differ.** A two-day event in
a room and a three-week remote bounty share a method and almost no logistics. So each section
of the references opens with the condition under which it applies, and several say plainly
when they do not apply at all: verifying the judge's build path means nothing when the judge
is a person in front of you, and a visibility calendar means nothing when everything is
public from the first commit. **Read the applicability line before the rule.** If your event
is a shape neither source covers, take the principle and throw the implementation away.

The named examples are XRPL and Hedera because that is where the evidence comes from.
**Nothing in the method is chain-specific.** Read "amendment" as "the sponsor's technology",
"ledger" as "the running system", "transactor" as "the implementation".

---

## The one-sentence theory

> You do not win by building well. You win by building the thing that is **missing**, and
> the way to find what is missing is to understand the sponsor's technology deeply enough
> that its gaps become visible to you and not to the other teams.

The mentor's words at the end of the event were: *impressed by your work, your feedback,
and the market gap you fill*. Those are three things and the third is the one that decides
placement.

And the strongest form of that gap: **the layer every other project assumes is already
solved.** At our event most teams built secondary markets, credit insurance and swaps on
fund shares — and every one of them needed a share to carry a value you could trust, which
was the thing that did not exist. Applications are crowded at a hackathon; the primitive
under them is usually empty. Aim below.

**And at the same sponsor's next event, one layer up.** At XRPL NYC we built the lending desk
that needs our own Paris primitive, the only application in the room with a correct value
underneath it, and it won again. Two events, one sponsor: a candidate rule, in
`references/01-find-the-gap.md` § Then one layer up.

---

## The shape of the work

There are two clocks, and almost every team only runs the second one.

| | When | What it produces |
|---|---|---|
| **Phase A — Positioning** | Weeks to days **before** the event. No time limit. | The idea, and the evidence that it is real |
| **Phase A½ — Temperature** | The first three hours on site | The panel's real composition, and the idea confirmed or replaced |
| **Phase B — Sprint** | The 24 to 48 hours on site | A demo that survives a hostile question |
| **Phase C — After** | The days following | Upstream filings, the public record, the next event |

**Phase A is pillar one.** A team that arrives with a proven gap spends the sprint building;
a team that arrives empty spends the first eight hours brainstorming and never recovers.
Give Phase A whatever time it needs — it is not on the event's clock.

**And Phase A½ is what stops it becoming a trap.** Preparation buys the speed to pivot; it does
not buy the right not to. The judges are real people whose composition you guessed, and the
sponsor's product owner has KPIs you can simply ask about. `references/11-on-site.md`.

---

## Phase A — Positioning (before the event)

Read `references/01-find-the-gap.md`. It is the most important file in this skill, and it is
not only a Phase A file: **the reading of the field repeats on a schedule through the whole
event**, because the organisers answer other people's questions and the field ships while you
build. Its cadence section gives the intervals for a 24-hour event and for a three-week one.

The method in one breath: read the four layers of the technology until you can write down
what you *expect* it to do; execute it; the places where reality disagrees with your
expectation are the findings; translate each finding into who loses money; the biggest
translated finding is your product.

The order matters and the order is not negotiable:

1. **Rules and rubric** — `references/00-rubric.md`. What is scored, **which surfaces are
   judged at all**, the submission-media rules, and what pre-existing work may cross into the
   event. Get this wrong and good work is disqualified.
   - **Then read the brief's verb**, before anything else — `references/01-find-the-gap.md`.
     "Show how X can do Y" is a demonstration brief and rewards the most convincing instance
     of Y; an open brief rewards the gap play. Choosing the layer before reading the verb is
     how a correct project ends up answering a question nobody asked.
2. **Saturate the context** — spec, then **implementation source**, then SDK, then docs and
   tutorial. Depth on two primitives beats breadth on six.
3. **Write the expectations down before executing.** Nothing can be violated if nothing was
   expected. This is the step teams skip and it is why they find nothing.
4. **Execute and diff.** Every disagreement between two layers is a finding.
5. **Translate into money.** "The change set is empty" is a bug report. "Collateral is
   over-valued on the secondary market" is a product.
6. **Apply the layer test.** Of the findings you translated, prefer the one that makes you
   the layer other projects need. Applications are crowded; the primitive is empty. Read the
   field the same way — their files, not their READMEs — and keep reading it while you build:
   *Reading the field* in `01-find-the-gap.md` says how, and what to copy the same day.
7. **Graveyard sweep.** For each surviving idea, find who tried and stalled, and why; keep it only if the
   sponsor's technology removes that reason. See `01-find-the-gap.md`.
8. **Exit test.** Four questions in `01-find-the-gap.md`, the last one being who pays and how.
   If you cannot answer each in two sentences, you do not have an idea yet.
9. **Rehearse the build** when the event is built from a spec — `references/12-dry-run.md`. Build
   it once in a throwaway repository, write every spec defect back, freeze the spec the evening
   before, and keep the list of what the rehearsal did not play: that list is where the event's
   slack goes first.

---

## Phase A½ — Temperature (the first three hours on site)

`references/11-on-site.md`. Three hours inside the sprint, 8 % of a 36-hour event, and it is
the cheapest insurance in this skill.

- **Profile the panel as a fact, not an inference.** Count the judges by type and find the one
  whose product is in the prize — that person has KPIs. A simulated adversarial panel is a tool
  for finding objections; it is not a source of facts about real people, and ours was wrong
  about the composition in the direction that mattered.
- **Ask three questions, in order**: what would make this track a success for you; which of
  your technologies do you most want to see used, and how; what have you already seen too much
  of.
- **Pitch the two sentences and stop talking.** Read the first three seconds of the reaction,
  not the reply.
- **A negative signal from a judge is a brief, not an objection.** When the person best placed
  to judge says they do not see it, write down three things you could build instead before you
  defend once. Keeping the original *after* that search is a decision; keeping it without the
  search is not.
- **A positive signal is a brief too.** A mentor's concrete ask becomes a build step the same hour,
  with a written time after which it is dropped. Decide scope from the measured slack, not by reflex.
- **The sponsor's mentor may be your judge.** At XRPL NYC the person who decided the demo's format
  judged it in the room. Record each conversation (with consent), log what it changes, and ask how
  they want to see the demo: video, live, or in their hands.
- **Reopen the prize map after any pivot.** A pivot invalidates the rubric table, the prize map
  and the effort allocation.

---

## Phase B — Sprint (on site)

Build only what the demo will show, and prove every claim as you make it.

- `references/02-verification.md` — how a fact becomes a fact. Read this before asserting
  anything about the technology to anyone.
- `references/03-claims-ledger.md` — the table of every claim the pitch makes and what
  backs it. Started on day one, closed before the freeze.
- `references/04-demo-audit.md` — the adversarial audit of the demo path. Mandatory, at
  T-6h, and it has found five blocking defects on an event-winning project.
- `references/05-pitch-craft.md` — the two sentences and **the blind read** that tests them, the adversarial pass on anything written, run of show, format discipline, what goes on a slide and
  what stays in your pocket, the backup video. **When the event is asynchronous and there is no stage, the README is the pitch**: the same two sentences, the same blind read, the same audit.
- **The words on stage are the speakers' own.** I supply the facts, the beats, the claims to keep
  and the words never to say, with a short spoken draft; they cut it and say it in their voice. At
  XRPL NYC that version won and the jury said so. `references/05-pitch-craft.md` § The words are
  the speakers'.
- `references/06-operations.md` — the pre-flight that refuses to say everything is fine,
  the boring things that kill demos (memory, ports, orphan processes, stale windows, **the
  account's usage limit, demo state that each take consumes**), and **scoping a safety rule to the
  hazard rather than to a whole network**.
- **The blind read** — in the `prose` skill, `references/07-blind-read.md`, run as Phase 4 of
  `/prose`. On the **first complete draft** of the script or the README opening, not at T-6h.
  `references/04-demo-audit.md` says why it cannot wait for the audit.
- `assets/dx-journal.md` — **one row per friction, written at the moment it happens**, with the
  verbatim error text. Opened on day one whatever the rubric says, because the feedback deliverable is
  due weeks later and nobody remembers an error code. `references/07-contribution.md` § The journal
  has the rules and the way the practice leaks.

---

## Phase C — After

- `assets/debrief.md` — **within 24 hours of the result, ten questions to the people who were in
  the room.** After XRPL NYC nothing recorded what the jury saw or asked until someone asked two
  days later, and the field size surfaced in a CV session. Without the debrief, calibration has
  nothing to work on.
- `references/10-calibration.md` — **before you draw a lesson from the result.** The measured
  base rates (0.9 % at Solana Frontier, 3.4 % finalists across 69 ETHGlobal events), what a
  single sample is worth, the one documented case of an organiser admitting its own scoring
  misranked teams, and which findings a loss licenses immediately. Read it first on a loss.
- `references/09-previous-rounds.md` — **if the organiser has run this before, the winners are
  published, and they are the rubric made concrete.** The method for counting what they share,
  the two counts that contradict the instinct, and the trap in reading only winners. About two
  hours, and the highest-yield research act available when it applies.
- `references/07-contribution.md` — the feedback deliverable and the upstream filings. The
  written report is gated on the rubric; the filings are worth doing at any weight, because
  they are how a maintainer learns your name.
- The public record: the post, the profile, the CV. Say only what is filed and countable.
- Write what you learned into memory before it decays.

---

## The non-negotiables

Nine rules. Each one is here because breaking it cost something real.

1. **Verify on the live system, never on a document.**
   *Two research agents contradicted each other during recon; only execution resolved it.*

2. **An unverified claim does not go on stage.**
   *"Five pull requests, two issues" was written into the deck twice. Zero were filed. The
   jury contained the maintainers of those repositories.*

3. **Retract your own finding the moment the source disagrees.**
   *We reported that `OracleSet` cannot remove a pair and asked for the feature. The
   transactor erases a pair listed without a price. Retracting it publicly, hours before
   judging, is part of what earned the result.*

4. **Every number must be reproducible from what is on the screen.**
   *The headline figure could not be recomputed: the denominator lived on a different
   object and was nowhere on the page. One line fixed it.*

5. **Audit adversarially before you present — the demo, and everything a judge reads.**
   *Sixteen defects, five blocking — including a screen that put one facility's name above
   another facility's figures, which reads as fabricated data.*

6. **Never promise what is not wired.**
   *The script promised two deposits signed live. There was no key file and no replay
   script. The promise was made at minute one and would have failed at minute three.*

7. **The pre-flight must be able to say no.**
   *A script that only knows how to print "ok" tells you nothing. Ours refused to pass when
   a facility's window had expired.*

8. **Record the friction in the journal before you fix it.**
   *A submission page claimed an endpoint change was "in the Developer Experience Report" while
   nothing had been written down. Fifty-seven rows of good practice and the fifty-eighth still
   slipped, because the fix arrives and the relief moves you on. `assets/dx-journal.md`.*

9. **Budget the account like memory: capped fan-out, and a reserve for the night.**
   *One unbounded audit ran 408 agents through 17.7 million tokens in 27 minutes, hit the
   session limit at midnight, and the night of the hackathon was lost. The risk had been written
   down two days earlier and nothing enforced it. `references/06-operations.md`.*

---

## How to use this skill

**When a hackathon appears on the calendar**, open `00-rubric.md` and `01-find-the-gap.md`
and start Phase A. Do not wait for the event.

**In the last days before the event**, if the build follows a spec, run the dry run in
`12-dry-run.md` and freeze the spec the evening before.

**On arrival, before you write code**, run `11-on-site.md`. It is three hours and it is the
difference between a prepared idea and a prepared idea nobody is scoring.

**During the sprint**, keep `03-claims-ledger.md` open and add to it continuously. Run the
blind read (`prose`, `references/07-blind-read.md`) on the first complete draft of the script
or README opening, and `04-demo-audit.md` at T-6h whatever the state of the build.

**When the result comes in**, win or lose, run the debrief (`assets/debrief.md`) the same day,
then read `10-calibration.md` before you draw a lesson from it. A single result at a 1-to-7 % base rate moves less than it feels like it should.

**When something feels finished**, it isn't: the last eight defects on a winning project
were all found after the work was declared done.

`references/08-assistant-failures.md` is about how *I* fail: the greps that returned false
negatives and were reported as fact, the heredocs that silently destroyed code, the success
message printed over a failed push. Read it when you are about to trust me on something
that has no second source.
