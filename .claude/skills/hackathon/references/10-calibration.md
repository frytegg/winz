# Calibration

**Applies when** you have just lost, or just won, and are about to draw a lesson from it.

**Read it before `09-previous-rounds.md` on a loss.** That file teaches you to read winners. This one tells you
how much a single result is allowed to move you, which is less than it feels.

---

## The base rates, measured

These are counted from published numbers, not estimated. They are the denominator a result has to be read
against.

| Event | Submissions | Winners | Rate |
|---|---|---|---|
| Solana Frontier (Jun 2026) | 2,857 | 26 | **0.9 %** |
| ETHGlobal, 69 events (2020-2026), scraped dataset | 18,693 projects | 628 finalists | **3.4 %** finalists |
| ETHGlobal, same dataset | 18,693 projects | 7,995 sponsor-prize winners | ~43 %, but prize data starts at HackFS 2021, so the denominator is inflated |
| TOKEN2049 Origins, Cardano track (Oct 2026) | ~40 teams, estimated from "200 builders, 70 % in this track" | 3 | **~7.5 %**, estimated |
| Ledger OP3N, private student hackathon, one team per club (Oct 2026) | 13 | 3 prizes, from 7 finalists | **23 %** prizes, 54 % finalists |
| De Vinci Blockchain XRPL Lending hackathon, Paris (Sept 2026) | 14 | 1 winner, 3 placed | **7 %** winner, 21 % placed |
| XRPL NYC, Lending & Borrowing track (Oct 2026) | 12 | 1 | **8 %** |

Sources: [Colosseum](https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/),
[scraped ETHGlobal dataset](https://github.com/Marcussy34/ethglobal), Cardano Foundation announcements of
8-9 Oct 2026, Ledger OP3N organisers' announcements of 15-16 Oct 2026, the Paris organisers' results of
13 Sept 2026, the owner's count for the NYC track and
[XRPL Commons' results page](https://hackathons.xrpl-commons.org/projects?filter=winners&hackathonId=6a8da2be91320fdff78ed817)
(eleven prize-winning projects across four tracks and the partner prizes; the event's total entry count is not
published there).

**Two structurally different games.** ETHGlobal publishes that typically only the top 20 % advance to live
judging, and that "the majority of prizes are paid out to projects that do not advance". A sponsor prize and a
finalist slot are not the same competition and should not be planned for as one.

---

## What a single result is worth

**A loss at 7 % is one sample from a distribution you mostly do not observe.** You see your own entry in full
and the winners in a paragraph each. You never see the forty entries that also lost, so you cannot tell whether
you were twelfth or second.

This matters because the post-mortem has a bias built into it: you will find reasons, because reasons are
always findable, and you will weight them by how vivid they are rather than by how much they moved the
outcome.

Three protections:

- **Separate "this was a mistake" from "this cost us the win."** Most post-mortem findings are the first. Very
  few are demonstrably the second, and saying so is not softening the blow — it is refusing to learn a rule
  from noise.
- **Prefer findings that are mechanical over findings that are psychological.** "The product first appears at
  2:14 of 3:00" is checkable by anyone. "We were too attached to our idea" is a story, and stories fit any
  evidence.
- **Only promote a finding to a rule when it is confirmed by a source outside the event**: an organiser's
  published rule, a count across the winners, or a second event. One loss promotes nothing on its own.

---

## The judging process is itself a source of variance

**Midnight Summit, November 2025.** The organisers published a correction in January 2026 stating that their
new rubric "allowed incomplete and inconsistent judge data, which meant some teams were misranked and some
outstanding projects did not move forward."
([source](https://midnight.network/blog/correcting-the-midnight-summit-hackathon-scoring-process))

This is the only primary-source admission of its kind I have found, which does not mean it is the only
occurrence — it means organisers rarely publish it.

What follows is not fatalism. It is that **the correct response to a single loss is to enter the next event,
not to rewrite the method.** Rewrite the method when two events agree, or when a source outside the events
tells you the rule was always there and you missed it.

---

## What a loss does license immediately

Three things, where the cost of acting is near zero and the cost of being wrong is also near zero:

- **Anything an organiser publishes as a rule.** If ETHGlobal auto-rejects a video outside 2-4 minutes, that
  is not a lesson from your loss, it is a fact you should already have had. Fold it in without waiting for
  confirmation.
- **Anything you can count across the winners.** Five of five naming the money movement in their first
  sentence is a count, and counts travel.
- **Anything that was a process failure regardless of outcome.** Running the blind read on freeze day instead
  of on the first draft was wrong even in the branch where you win.

Everything else waits for a second data point.

---

## A third place, read with this file

**Ledger OP3N, Paris, 16 October 2026.** Thirteen club teams, seven finalists, a 5-minute pitch and 5 minutes of
questions in front of four jurors: two Ledger executives and two partner representatives. We placed third with a
company-memory product whose consents are clear-signed on a Ledger. The organisers' written brief asked for that kind
of project: *"Most of what exists today points the stack at wallets and transactions. The projects we haven't seen yet
are the ones that point it somewhere else."* One juror, a Ledger executive, named the risk we took on that alternative
route, and the amount of work.

The two teams ahead of us had both built and run their product on a real Ledger. The winner, a tap-to-pay app on a
Flex, put the jury inside its demo. Our consent screens could only run on the emulator: their descriptors are signed
with the test key, and a retail device refuses them.

What this result licenses now, by the rules above:

- **A process failure, whatever the outcome: the finalist recon measured the wrong thing.** It ranked six rivals from
  their repositories, and put the eventual winner third among the threats because its main branch had no AI. A
  repository shows what is on main. A live final judges a performance, and the owner, who had met that team on site,
  had said to watch its execution. *Reading the field* in `01-find-the-gap.md` now says how to weigh the two.
- **A count, small and stated as such.** Three of the seven finalists had built for a real device, and two of those
  three placed. Of the four that had not, one placed: us. Seven entries is a count, not a law, but it points the same
  way as the subject rule (`03-claims-ledger.md`): the pitch was about the Ledger as a badge, and the demo never
  touched a Ledger.

**What waits for a second event:** putting the jury inside the demo as a gate at idea choice. One winner did it, and
it is the most vivid thing in the post-mortem, which is exactly the bias this file warns about. Test it at the next
event with a stage: during Phase A, ask whether a judge could do the core action with their own hands, on the hardware
in the room. If that event agrees, promote it to the exit criteria in `01-find-the-gap.md`.

**Tested at XRPL NYC, nine days later: not confirmed.** The organiser allowed it, the demo could have handed the
jury the signing, and we won with a recorded video that no juror touched, on the advice of the sponsor's mentor who
then judged. One win each way. It stays a question to ask (`05-pitch-craft.md` § The demo, on screen), not a gate.

**And a qualifier on the one-sentence theory**, also one sample. The gap play was recognised. Five of the sponsor's
staff (developers, product) picked it in the written selection, though it moves no money and runs on no device. On
the podium, the two other projects moved USDC. It did not set the order on stage. Like the
ETHGlobal split above, the written round and the live final are two games: the first reads the gap, the second
watches a moment.

---

## And the inverse, after a win

The same discipline, pointed the other way, and it is harder because nobody wants to audit a win.

After the XRPL event (Paris, Sept 2026, first place) the mentor named three things: the work, the feedback, and
the market gap. **None of them was the demo's production quality, and we had spent real hours on it.** A win
tells you what did not disqualify you. It does not tell you what was load-bearing, and the temptation to
believe your whole method was validated by one result is exactly as strong as the temptation to discard it
after one loss.

---

## A second win, read with this file

**XRPL NYC, 24-25 October 2026.** Lending & Borrowing track, first of twelve, $6,000. A three-minute pitch
in a track room, then the prize on stage at the closing ceremony. The jury saw a short recorded video and
asked questions; a Ripple judge from the Paris panel was in the room. Built from a spec after a full dry run
(`12-dry-run.md`), by two people and autonomous agents.

**What it does not license.** That the dry run won it, that the video format won it, that the four late
features won it. Each is true of the winning entry and none is shown to be load-bearing. The owner's own
reading is the one with the most weight, because the owner was in the room: the jury liked a short pitch,
said in the team's own words, *"straight to the point"*.

**What it licenses now, by the rules above:**

- **Process failures, whatever the outcome.** An unbounded audit took the account down for the night
  (`06-operations.md` § The account's usage limit). The takes consumed the demo state (§ Consumable demo
  state). The first screen could not be read, though the owner had asked for a readable one from the
  first spec onward (`04-demo-audit.md`). The submission form carried a sentence the claims ledger had banned
  (`03-claims-ledger.md`). Nothing recorded what the jury saw until two days later (`assets/debrief.md`).
- **Counts across the winners.** Four of four track winners name a movement of money in their first line
  (`01-find-the-gap.md` § Read the brief's verb). Three of four use the sponsor's pre-launch primitive, credit,
  across three different tracks (§ Place the main sponsor). Three of four name a mechanism native to the
  ledger, which the rubric also names: confirmed (`09-previous-rounds.md`).
- **Two events that agree.** Who pays, and how: absent at Origins, which did not place; said without figures
  at NYC, which won. Promoted to the exit test.
- **And one that disagrees.** Jury participation: one win with it, one without. It stays a question.

**What waits:** the series play (`01-find-the-gap.md` § Then one layer up) — two wins on one sponsor, which may
be about that sponsor rather than about hackathons; and the application pitch shape (`05-pitch-craft.md`),
given by two advisors at one event.
