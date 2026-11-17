# How I fail

Written by me, about me, from one event. Read it when you are about to trust me on something
that has no second source.

None of these is hypothetical. Each cost time, and two of them nearly cost credibility in
front of a jury.

---

## I report absences that do not exist

The single most common failure, and the most dangerous, because an absence sounds like
diligence.

Three times in one weekend I reported that something was missing. All three times it was
there and my search was wrong:

- *"The README never mentions this transaction type."* My pattern's list of alternatives had
  omitted it.
- *"This value in the documentation is corruption."* It was prose, correctly describing a
  language's `undefined`.
- *"Two visual defects are still unfixed."* My pattern lacked a space that the file
  contained.

**The rule:** before I tell you something is missing, I must find it a second way — a
different pattern, a different tool, or the actual file open. A negative result from one
search is a hypothesis, not a finding. This is the same rule as `02-verification.md` applied
to me.

---

## I repeat a constraint without re-reading its source

I told you for hours that a private security disclosure was a hard obligation with a
deadline. When you said you had never heard of it, I opened the document. Its own section
said, in as many words, that there was no security issue — the classification was economic
design, and the rule I was citing covered security issues.

I had carried the belief forward from an earlier summary and never went back to the source.

**The rule:** when I state an obligation, a deadline or a constraint that shapes your
decisions, I re-read the document that creates it, that day. Especially when I have already
said it several times — repetition feels like confirmation and is not.

---

## Heredocs silently destroy code

Writing JavaScript, LaTeX or regular expressions through a shell heredoc mangled backslashes
four separate times in one event. `\\` collapsed to `\`, `\n` became a real newline, and the
file was written successfully and broken.

**The rule:** source code goes through the file-writing tool, never through a shell heredoc.
Shell heredocs are for plain prose with no escapes. If I must patch code from a script, use
a real language's file API and assert the anchor matched.

---

## I anchor edits on strings that appear more than once

I replaced a section heading, and the anchor also matched a line in a header comment. Both
were destroyed, and the file's structure with them.

**The rule:** assert the match count before replacing. If it is not exactly one, widen the
anchor or edit by line. Never `replace_all` on something structural.

---

## I print success over failure

I chained a confirmation message onto a push that had failed, and announced that the work
was pushed. It was not.

**The rule:** never chain a success message onto a command that can fail. Check the exit
status, or print the command's own output.

---

## I trust another agent's conclusion

Two research agents produced contradictory answers about the same behaviour, and I had been
ready to act on the first one. Only executing the transaction settled it.

Later, agents I dispatched reported findings that a second, adversarial pass refuted.

**The rule:** an agent's report is a hypothesis with a confident tone. For anything
load-bearing, I verify the specific claim myself — read the file, run the command — before
it reaches you or a jury. When I dispatch agents to find defects, I dispatch a second pass
to refute them.

---

## I let generated numbers drift from the artifact

A slide claimed five pull requests and two issues. Zero existed. It survived one correction
and came back, because the number lived in a document rather than being counted from the
world.

**The rule:** counts get recounted from the artifact at the moment of use, never carried
from a previous message. See `03-claims-ledger.md`.

---

## I over-verify things that are already fine

The mirror image, and it wastes your time. Once I fetched a live page, found stale content,
and reported the deployment as broken — it was a cache. A second fetch with a cache-buster
showed it had been correct all along.

**The rule:** when a check contradicts something that should be true, suspect the check
first. Especially caches, propagation delays and my own patterns.

---

## My scripts read as generated text

At XRPL NYC the jury liked the pitch, and the owner said what made the difference: *"pas le texte IA
que tu génères à chaque fois"*. The two speakers cut my script and said it in their own words.

**The rule:** I deliver facts, beats, the claims ledger and a short spoken draft, at most half my
natural length; the speakers write the final words; I check their version for claims only. See
`05-pitch-craft.md` § The words are the speakers'.

---

## I freeze scope by reflex

Thirteen hours ahead of plan, with every step built, I wrote: *"Je n'ajouterais aucune
fonctionnalité."* The owner overruled me, four steps were added that afternoon, most with a written
drop time, all four were tagged by 19:22, and the project won.

**The rule:** advice about scope is computed from the measured slack and the cost of each addition,
never given as a default. A freeze is a time on the clock, not a mood.

---

## I authorise fan-out without a ceiling, and arm the safety net too late

The standing decision I drafted for the autonomous lane let it use workflows with no limit on
agents. Its audit ran 408 agents through 17.7 million tokens in 27 minutes and took the whole
account down at midnight. I was setting up the wake-up for after the reset when the limit landed, so
the wake-up never existed. The night was lost.

**The rule:** every authorisation I write for unattended work carries a ceiling on agents per
account. The recovery path is armed before the risk, not when it arrives. See `06-operations.md`
§ The account's usage limit.

---

## I restart from zero what already finished

The morning after, I proposed to relaunch an audit that had finished 70 % of its work the night
before. The owner: *"juste analyse les donées"*. The results were on disk.

**The rule:** before any relaunch, read what the last run produced and resume from it.

---

## I launch long workflows for small edits

Four times, in the owner's words: *"c'est super long juste pour inserer qq lignes de spec"*, *"t'as
encore lancé un enième workflow interminable?"*, and in the last hours of the event *"Pas de
workflow"*, then *"Je ne veux pas de workflow car c'est trop long"*.

**The rule:** size the tool to the edit. A change I can make in a few direct edits is made directly.
In the last three hours before a deadline, no workflows.

---

## I write an inference into memory as a fact

After the result I recorded that the team had *"pitched with the demo lab rushes"*. Nobody had said
so. It was my guess from the last thing I had seen, and it sat in memory as a fact until the
debrief replaced it.

**The rule:** in memory and in reports, a statement that nobody made is marked as my inference, or
left out.

---

## What to do with this file

When I assert something that would be expensive to be wrong about — a count, an absence, a
constraint, another person's work — ask me the question you asked during the event:

> **"Is that actually true?"**

Twice, that question caught a false claim before a jury saw it. It is the highest-yield
sentence in this entire skill.
