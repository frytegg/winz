# Pitches, submission forms and video scripts

A pitch is judged in less time than it took to write its first sentence, and by someone who will not ask a
follow-up question. Everything in `01-mechanism-tests.md` applies, harder. Three things change.

## The two sentences come first, and they are one artefact

Write the whole thing as two sentences before writing anything else.

> **Sentence one is the loss, with a number. Sentence two is what you hand over.**

Then keep those two sentences identical in substance everywhere they appear: the README's opening, the
submission form's description field, and the first thing said in the video. A judge who reads the form and then
opens the repository is checking, without meaning to, whether the same person wrote both.

This is cheap to enforce. A checker can compare the three and fail when they drift.

## The blind read is the only test that works

You cannot test your own opening. You know what the project is, so every ambiguity resolves correctly in your
head and nowhere else. Hand the first fifteen lines to a reader with no context and ask two questions in
writing, **before they see anything else**:

> Read only this. In two sentences: what is this, and why would you keep reading?

Compare their answer with the truth. The gap is the finding, and it is worth more than any amount of rereading.

The full protocol, including what to do with the answer and the rule that you fix the opening rather than the
reader, is in the `hackathon` skill at `references/05-pitch-craft.md`. It is the same test. Use whichever
skill is open and do not duplicate the protocol.

**One addition specific to this skill.** Ask the blind reader a third question: *what problem does this solve,
and what does it cost you not to use it?* An opening can identify a project correctly and still fail to say why
anyone should care. That failure is invisible to the first two questions, and it is the most common defect in a
technical README's first screen.

## What a judge reads as a machine

In a pitch the tells are louder, because the form is short and rhetoric is tempting.

- **A tricolon in the opening.** Measured at nearly twice the human rate in machine output, and it is the
  single strongest device-level discriminator in that study. Two items or four. Never three by default.
- **An adjective where the number belongs.** In a pitch this is fatal: it is the sentence a judge would have
  quoted, and it turns out to contain nothing.
- **The heading that announces meaning.** "Key takeaways", "The future of X". A heading names contents.
- **A claim with no scope.** "It works" invites the question "on what?". "It has run on Hedera testnet, chain
  296, eleven times since 21 September" does not.
- **Rhetorical questions.** Humans use them at more than twice the machine rate in one study, so they are not a
  tell. They are still usually a way of avoiding a claim.

## The video script

Three rules, all mechanical.

1. **Nothing is said that is not on screen while it is said.** A viewer who mutes the video must see the same
   story; a viewer who only listens must never hear a figure they cannot watch being produced.
2. **Count the words, not the minutes.** 145 words a minute is brisk, 130 unhurried. Write the script, count
   the spoken words, and state the range. A script that claims a duration it was never counted against is the
   same defect as an adjective standing in for a measurement.
3. **Name what the recording cannot prove.** If a beat shows a capture rather than a live run, the voice says
   so. The audience for that sentence is the one judge who would have noticed.

## The form fields nobody rehearses

Most submissions are strongest in the README and weakest in the four boxes of the form, because the boxes are
filled at the end, in a hurry, by someone who has stopped reading their own words.

Write them **first**, from the two sentences, and run the checker over them. They are prose a judge reads before
they decide whether to open anything.
