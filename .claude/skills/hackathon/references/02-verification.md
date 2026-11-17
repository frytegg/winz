# Verification

How a belief becomes a fact. Read this before asserting anything about the technology to a
teammate, a judge, a maintainer or a report.

---

## Verify along the path your work will actually be judged on

**The principle is invariant: whatever will be run, run it the way they will run it, in the place they will run
it.** Only the implementation changes.

| the shape of the event | what the judge's path is | what to reproduce |
|---|---|---|
| a remote bounty whose entry is built by a tool | the artefact their tooling produces from your repository, not your repository | scaffold or install your own submission from scratch, in a clean directory, with their exact command, and run your checks *there* |
| a remote submission a human clones | a fresh clone with no local state | clone into a new directory, with no env file, and follow your own README literally |
| a live event with a stage | the machine, the network and the projector you present from | the machine and the network, at the venue, before the room fills |
| a hosted judging environment | their container, their versions | the pinned versions, in their base image if it is published |

The distinction is not academic. A rule we added to our own checks was green in the repository and red in the
artefact the tool built from it, because that artefact is a different tree: the generator drops three lifecycle
scripts, and one configuration file does not survive the copy. Our repository had 66 root scripts, the built
artefact 63, and a rule that reasoned about all of them failed on exactly the three that were gone. We found it
in the nightly run, not in our own green suite.

**The cheap simulation is usually available.** Ours was: remove the three scripts, move the missing file aside,
run the check, put everything back. Thirty seconds, and it turns a category of surprise into a step in the
verification list.

**When it does not apply.** At a live hackathon there is often nothing between you and the judge but a laptop,
and this section collapses into `06-operations.md`: present from the machine you tested on, on the network you
tested on. Do not invent a judge's environment that does not exist.

## The rule

> **Verify against the running system, not against a document.**

Documents describe intent. Implementations have behaviour. When they disagree the running
system wins, and the disagreement is itself worth reporting.

During recon, two research agents produced contradictory answers about the same protocol
behaviour. Neither was stupid; both had read sources. Only executing the transaction settled
it. Since then the rule has been: **a fact that was never executed is a hypothesis wearing a
fact's clothes.**

---

## The evidence ladder

From weakest to strongest. Know which rung you are standing on when you speak.

1. **Someone said so** — a forum post, a blog, another model, **a mentor**. Not evidence. At XRPL NYC a
   mentor gave a regulatory default threshold of 60 days past due; the rule says 90, and it was checked
   before it reached a screen. Take the mentor's direction, verify the mentor's facts.
2. **The documentation says so.** Weak: docs lag implementations, and the gap between them
   is where findings live.
3. **The specification says so.** Weak for behaviour, strong for intent. Drafts are often
   months behind the code.
4. **The implementation source says so.** Strong. Read the actual transactor, validator or
   handler. Quote the lines.
5. **It happened, and here is the transaction hash.** Strongest. Executed on the network the
   judges will check.

**Rungs 4 and 5 together are the standard.** Source tells you why, execution tells you that
it is still true today.

---

## Positive controls

When a result is an *absence* — a rejection, a refusal, a failure — you cannot cite a hash,
because rejected work often never lands.

So prove the apparatus works by running the same operation in a form that should succeed.

We needed to show a permission could not be delegated. Every attempt was rejected before
reaching a ledger, so no hash existed. The evidence shape that worked: delegate a permission
that *is* allowed, from the same account, on the same network, in the same run. It succeeded
with a hash. That control is what makes the refusals mean something rather than looking like
a broken script.

**Any claim of the form "X is impossible" needs a control showing that Y, which is possible,
worked in the same breath.**

---

## Re-verify before you cite

Evidence decays. Test networks are pruned and reset; ours kept roughly 29 days of history.
Source files move; line numbers drift; branches merge.

Before any citation goes somewhere public — a report, an issue, a slide — re-run it:

- Does the transaction still resolve, and still say `validated`?
- Does the ledger object still exist, and still carry the field you are pointing at?
- Is the source file still at that path, and the quoted code still at those lines?
- Has the pull request you are commenting on moved since you drafted the comment?

We re-verified every hash in the minutes before filing upstream. The report we were
correcting had died of exactly this: it was unreproducible six months later, so nobody could
act on it.

That last check has teeth. Between drafting a tutorial fix and filing it, the maintainer
pushed commits carrying four of its five fixes. Filing it unchanged would have put a
near-duplicate in front of the person who wrote the original, alongside a sentence asserting
their work did not touch those files.

---

## Two sources before you report an absence

The hardest thing to prove is that something is **not** there, and it is where I fail most.

Three times in one event I reported an absence that did not exist:

- "The README is missing this transaction type" — my search pattern had omitted it.
- "This value in the docs is corruption" — it was prose correctly describing a language's
  `undefined`.
- "Two visual defects are unfixed" — my pattern lacked a space that the file contained.

All three were confident, all three were wrong, and all three would have been caught by one
extra check with a different method.

**Before reporting that something is missing, find it a second way.** A different pattern, a
different tool, a human eye on the actual file.

---

## Retract fast and in public

When the source contradicts something you have already published, retract it — even if the
retraction is uncomfortable, even if it is hours before judging, especially if the audience
owns the code.

We told the organisers, in a submitted report, that their oracle transaction had no way to
remove a data pair, and asked them to add one. It does. The source is explicit. We withdrew
the claim in the next report, named the mistake, and kept the half that was true.

The alternative is worse in every direction: a maintainer on the jury falsifies you from
memory, and everything else you said becomes suspect. A report that shows its corrections is
worth more than one that cannot be caught being wrong.

---

## Write the verified facts down

Keep a `known-behaviour.md`: one line per verified fact, with its evidence.

```
| fact | evidence | verified on |
```

It stops the team, and me, re-asserting something later that nobody actually executed. Every
project accumulates folklore within two days; this is the antidote.
