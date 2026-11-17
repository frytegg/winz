# The demo audit

Mandatory, at T-6h, whatever state the build is in. It is the highest-yield hour of the
sprint.

On a project that went on to win, this audit found **sixteen defects, five of them
blocking** — after the demo had already been verified screen by screen, by hand, with
screenshots, by two people who believed it was finished.

**Work being declared done is the signal to run it, not a reason to skip it.**

---

## What it audits

Not the code. The **demo path**: the exact sequence a judge will watch, and whether every
screen supports every sentence said over it.

Three sources must agree, and the audit is the diff between them:

1. **The artifact** — the captured data, the fixtures, what was actually recorded.
2. **The screen** — the component that renders it, as it will appear on the wall.
3. **The script** — what the presenter says while it is showing.

Most defects live between two of these, and none of them is visible from inside one.

---

## How to run it

One agent per screen or beat, each given the three sources and told what to hunt for. Then
an adversarial pass: for every claimed defect, a second agent tries to **refute** it,
defaulting to refuted when unsure. Only survivors reach the presenter.

The refutation pass matters. It keeps the presenter from spending the last hours chasing
things that were never wrong, which is the failure mode of an unfiltered audit.

Run the agents against a **live** instance of the product, not a description of it. They
should be able to call the API and read what the screen receives.

---

## What to hunt for

This list is the yield from one real audit. Every item found something.

- **A screen a judge cannot place themselves in.** Before any other item: show the first screen of the
  product to a reader who knows nothing, and ask three questions. What is this? Which side am I on? Which
  button acts? The `/frontend` skill's blind first-screen reader does exactly this. At XRPL NYC the owner
  asked for a screen *"clair avec un bouton pour faire la tx"* on 21 October, said of the rehearsal build *"je
  n'ai pas vu comment interagir avec le protocole"*, and on the last morning *"on ne sait pas de quel côté on
  est, prêteur ou emprunteur"*. It was fixed three hours before the deadline, because no check in between
  could fail. Run this at the dry run (`12-dry-run.md`), not at T-6h.
- **A number said aloud that is not on the screen**, or differs from it. Including a number the screen says
  about itself: our signing card announced three minutes while the signature expired after about sixty
  seconds.
- **The timestamp at which your own product first appears.** Play the cut with a stopwatch. ETHGlobal's rule
  is *"Keep introductions under 20 seconds"* and *"Show your project in action… skip any unnecessary
  waiting"*; MLH plans for videos that are *"a demo of their hack, not a presentation"*. On the Origins
  submission the Brume interface first appeared at **2:14 of 3:00** — 71 % of the film with no product in it,
  behind a blog post, a diagram and an animation. If the product arrives after the first third, re-cut.
- **A claim in the script that depends on a third party having acted.** It is a hope, not a claim, until they
  act. Give it a written fallback variant the moment it enters the script, and record both takes. Ours was
  *"listed on their marketplace as an agent you can hire today"*, against a reality of a private coworker and
  an unpaid task.
- **Whether the blind read has been run on this version.** It is not a late check: see § Run the blind read
  on the first draft.
- **A figure that cannot be reproduced from anything else on that screen.** A missing
  denominator, a unit mismatch — raw units against display units, drops against whole units,
  ratios against basis points. Our headline figure could not be recomputed because its
  denominator lived on a different object and appeared nowhere.
- **A stale stage direction.** A scroll, a click, a tab that no longer matches the layout.
  Ours told the presenter to scroll to a table that now fit on one screen.
- **A navigation gesture that silently does the wrong thing.** The facility picker kept the
  current tab, so choosing a facility from one screen left the presenter on that screen,
  scrolling for a table that was not there.
- **A label that reads as missing data when it is actually the finding.** A column headed
  "Before" full of dashes reads as sloppiness; headed "Change set" the same dashes are the
  argument.
- **A screen that borrows an identity it should not.** Ours titled a capture with whichever
  facility the picker held, so it could show one facility's name above another's figures.
  That reads as fabricated data, and a judge who saw the earlier table can catch it.
- **Evidence that exists in the artifact and reaches no pixel.** Nine ledger-proven steps
  with hashes, including the two refusals that were the whole claim, sat in a file and were
  never rendered.
- **A fold that hides the thing being pointed at.** The record the script pointed to was
  collapsed on arrival and re-collapsed on every navigation.
- **A promise the script makes that no file supports.** See `03-claims-ledger.md`.
- **A colour or scale that carries the wrong meaning.** A five-step conduct grade routed
  through a twenty-step credit ladder printed the worst grade in the colour used for "no
  data".
- **A link that 404s.** Check every one by fetching it. Public explorers frequently have no
  route for the object type you are linking, and render a client-side not-found that a
  `200` status will not reveal.

---

## Ship the command that makes your own checker fail

**Applies when** anything you claim is checkable by a stranger: a verifier, a test suite, a report generated
from data, a figure read back from a system. **Does not apply** to a demo whose whole claim is a running
interface a judge watches you drive.

Rigour that cannot be exercised is decoration. If your project prints sentences derived from data, a reader
cannot tell a derived sentence from a hardcoded one by reading, because on a screen they look identical. So
hand them the means to find out.

> **Break your own evidence on purpose, in front of them, and show the output follow.**

Four of the five winners of one bounty did exactly this, each in a line: a flag that forces the verifier to
exit 1, a run that sends four deliberately tampered payments that must all be rejected, an audit tool that
prints a fraud verdict on doctored input, a suite that "bends one thing at a time".

The version we built took twenty seconds and no network: three captured answers, one field altered in each, in
memory, with the same function run over both versions. A response code changed from 194 to 22 and the verdict
flipped from fail to pass. Another changed from 292 to 184 and the recommended action moved from "approve" to
"associate". The command reads its input files twice, compares the digests, says that nothing on disk moved,
and exits 1 if any sentence survives its own evidence being falsified.

Three rules make it worth something:

- **Alter the data, never the code.** Changing the code proves your test suite works. Changing the data proves
  the output is derived, which is the claim under suspicion.
- **Make it exit non-zero on the defect it hunts.** A checker that cannot fail teaches a reader nothing. Write
  the test that builds the defect and requires the command to report it.
- **Say what it did not touch.** Digests before and after, no network, no key. The reader is being asked to
  trust a command that deliberately corrupts things; tell them the blast radius.


## Run the blind read on the first draft, not here

The audit is at T-6h. **The blind read is not an audit item, because by T-6h it is too late to act on what it
finds.**

Run it the moment the script or the README opening is first complete, and again after every rewrite that
touches the opening or the load-bearing explanation. The executable protocol — three readers, the constraints
that keep them blind, the question sets, how to read the scores — is in the `prose` skill at
`references/07-blind-read.md`. Running `/prose` on a script runs it as Phase 4.

On the Origins submission it ran on the morning of the freeze, after the video was recorded. It found, from
two independent readers, that the single load-bearing sentence of the pitch did not land and that nobody could
say who paid. Both were fixable in fourteen words. Neither was fixed, because the audio was already cut.

---

## Severity, and what to do with each

- **Blocking** — a judge would see it, and it would make the work look wrong or fabricated.
  Fix before presenting, or cut the beat.
- **Visible** — a judge might notice; it costs polish, not credibility. Fix if time.
- **Minor** — record it in the hard-questions file and move on.

Five blocking defects on a finished, hand-verified demo is a normal yield. Budget for it:
run the audit with enough time to fix, not as a final checklist.

---

## After the audit

Two outputs, both written down:

1. **The fixes**, applied and re-verified against the live product. Restart whatever needs
   restarting and confirm the screen actually changed.
2. **A hard-questions file** — every caveat the audit surfaced that you are *not* fixing,
   with the answer you will give if asked. An observant judge sees the same things the audit
   did. Knowing which ones you chose to leave, and why, turns a weakness into a considered
   decision.

Ours carried eleven: two facilities showing identical figures, a top grade on a facility
carrying a large loss, a ratio that is undefined at zero exposure, a sign-in button that
does nothing. None was a bug. Each had a one-sentence answer ready.
