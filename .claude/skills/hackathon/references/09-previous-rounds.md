# The previous round is the rubric

**Applies when** the organiser has run this programme, or one like it, before, and published who won. A
recurring bounty, a grant wave, a hackathon series, a template call, an accelerator batch.

**Does not apply when** it is a first edition, or when the winners were never published. Then the rubric text is
all you have, and `00-rubric.md` is the whole method.

---

A rubric tells you what they say they want. The previous round's winners tell you what they actually rewarded,
and the two are never identical. This is the cheapest high-yield research act available, it takes about two
hours, and almost nobody does it.

## The method

1. **Find the announcement.** The organiser's blog, their Discord announcements channel, their X account. It
   usually names every winner with one paragraph each.
2. **Open the artefacts, not the write-up.** This matters: on the round we studied, each winner's blog paragraph
   was a close paraphrase of that project's own README opening. The post carried no criteria, no quotes from
   evaluators and no scoring commentary. **Whatever the judges read, the write-up was assembled from the
   READMEs.** So read the READMEs, the file trees, the CI configuration and the commit history.
3. **Count, do not impress yourself.** For each property, write the fraction. "Four of five ship a command that
   makes their own checker fail" is a finding. "They all seemed rigorous" is a feeling.
4. **Hunt hardest for the properties that contradict your instinct.** Those are the ones that save you days.

## What the counting produced, once

From the five winners of a $1,000-each bounty run by the same team that later ran the one we entered. Kept here
as a worked example of the method, not as a law about your event.

**The pattern every one of them shared:** each README named one specific thing the standard approach could not
do, then handed the reader a link or a command that settled whether their fix worked.

- **5 of 5** linked resolvable **transaction** ids, not account or contract ids. Every quantity was a number
  attached to a link. Across five READMEs there was no "fast", "cheap" or "seamless" standing on its own.
- **5 of 5** argued in a **named section** that the mechanism was specific to that chain. One phrased it exactly
  as the brief's own removal test: *"Take any one away and it stops working."*
- **4 of 5** shipped a command a stranger could run **that made their own checker fail**: a flag that forced the
  verifier to exit 1, a run that sent four deliberately tampered payments which had to be rejected, an audit CLI
  that printed a fraud verdict.
- **4 of 5** stated non-goals or limits explicitly.
- **3 of 5** published something outside the repository (packages, a live URL).

**And the two counts that contradict the instinct, which is why you count:**

- **The shortest README won.** 1,443 words against a 6,007-word winner in the same round. Length was not the
  variable; evidence density was.
- **A winner had zero test files**, and a green CI badge was not what was rewarded: of five winners, only three
  had CI that ran tests at all. Tests are insurance against your own mistakes. They are not the argument, and a
  team that spends its last two days adding tests instead of evidence is optimising the wrong number.

## What to do with the counts

Write them into your plan as targets, with dates. Anything you lack that costs under half a day, build it this
week. Anything costlier goes on the list you do not build, with the reason.

Then check the inverse: **what did every winner have that a losing entry plausibly lacked?** On that round the
answer was sharp. A losing entry most plausibly had an integration that worked, described as working, with the
chain used as a rail rather than as the thing that made a named failure impossible, and nothing a judge could
run in under five minutes to check it.

## The trap in this method

You are reading winners, so everything they did looks like a reason they won. Most of it is not. Three
protections:

- **Only count properties shared by most of them.** A single winner's habit is a habit.
- **Prefer properties the rubric also names.** Where the counting and the rubric agree, you have two
  independent sources. Where they disagree, the rubric is what the judges must defend in public.
- **Look for the counter-example inside the set.** The zero-test winner is worth more than the four with tests,
  because it tells you what is *not* required.

---

## A second round by the same organiser, and what replicated

Two rounds are worth far more than one, because a property that shows up in both belongs to the judges rather
than to a cohort. The counting above is a payments bounty of July 2026. The same team ran a template bounty that
closed in October 2026, and we entered it and were not selected. Its five winners, counted the same way:

- **5 of 5** were built on one service, the chain's scheduling primitive, each inside a different use case:
  multisig governance, limit orders, liquidation keepers, recurring buys, prediction-market settlement.
- **4 of 5** sold the same sentence: the contract books its own next execution, so no off-chain keeper, no bot,
  no server.
- **2 of 5** integrated the same DEX we did, so the protocol was not the differentiator.
- The announcement's own summary named the set as a theme. Five winners sharing one mechanism reads as a curated
  showcase rather than five independent verdicts.

**This counting is incomplete, and the gap is the method's own step 2.** It comes from the announcement. Nobody
has cloned the five trees. Until someone does, every count above is a claim about a blog post.

**What replicated, and is therefore a rule:** winning entries argue that their mechanism could not exist
elsewhere. Round one, five of five made that argument in a named section. Round two, five of five chose the one
service with no equivalent on a competing chain.

**What did not replicate, and is therefore still one cohort's habit:** the falsifiable command, the stated
non-goals, the short README. None could be counted in round two, for the reason above. Do not promote them. Do
not drop them either.

### The failure this cost us, which is the useful part

We had the replicated rule. It was in this file before we entered. We lost anyway, because the rule was
ambiguous in the one place it needed to be sharp.

**Chain-specificity comes in two kinds, and they do not score alike.**

- A **capability** that exists nowhere else: the chain lets you do a thing no other chain lets you do. *The
  contract schedules itself.*
- A **failure mode** that exists nowhere else: the chain breaks in a way no other chain breaks, and you handle
  it. *Every simulator approves a swap the network then refuses, and it keeps the gas.*

Both are genuine chain-specificity. Ours was the second kind. We can defend it line by line: nine behaviours, each with
the transaction that proves it, and every figure in the documentation re-derivable from a public mirror node.
It was not selected.

A criterion named *ecosystem integration and value*, carrying 35 of 100 points, asks what a developer **gets**. A
capability answers that in one sentence. A failure mode answers a different question — what a developer
**avoids** — and that answer has to be translated before it scores, if it can be translated at all.

**So before you commit to a subject, say your entry's value in one sentence and look at the verb.** *You can now
X* is a capability. *You will no longer lose X* is a defence. Neither is wrong, and a defence can be the better
engineering. But when the heaviest criterion says value and your sentence is a defence, you are asking a panel
to do the translation for you.

The cheap repair is not to abandon the defence. It is to **carry a capability sentence as well**, and to lead with
it. State the same work as the thing the developer can now do, with the failure it prevents as the reason it
was hard. If no capability sentence exists, that is worth knowing in week one rather than on results day.

### Two warnings about everything in this section

**It is one event, read by an interested party.** We had an obvious motive to find a reason that is not "the
work was not good enough", and we have not read the winning repositories. Treat capability-versus-defence as a
question to ask yourself, not a verdict about which kind of work wins.

**Evidence tiers, which is how this file stays honest as it grows.** Write the tier next to anything you add:

| seen in | status | what to do with it |
|---|---|---|
| one round | observation | write it down, let it inform, never let it decide |
| two rounds, same organiser | candidate rule | plan against it, and say in the plan that you are |
| two rounds **and** the published rubric | confirmed | treat it as a requirement |

Capability-versus-defence is an **observation**, with exactly one case behind it. One property has now
reached **confirmed**, in the section below.

---

## A third round, at another organiser, and a sibling round

**XRPL NYC, October 2026**, counted from the four track winners' own descriptions on the organiser's results
page, with the seven partner-prize winners alongside.

**What replicated, and is now confirmed.** Three of the four track winners name a mechanism native to the
ledger in their one line: *"straight from the ledger"*, *"native escrow"*, *"a new protocol amendment"*. That is
the rule from the bounty rounds above — the mechanism could not exist elsewhere — seen again at a different
organiser, and this time the published rubric names it too: the kickoff defined Implementation as *"did you
use the XRPL well"*. Two rounds and the rubric: by the tiers above, **confirmed**.

**A sibling round predicted a track.** The owner noticed it: NYC's Agentic Finance winner has the same shape as
the TOKEN2049 Origins Cardano winners seventeen days earlier, at a different organiser on a different chain.

| | Origins, Cardano track (Oct 2026) | XRPL NYC, Agentic Finance (Oct 2026) |
|---|---|---|
| Payment by an agent, per call | CoinGraph (overall): *"agents pay per call on Cardano through x402"* | Misa: *"open-source x402 auth-capture"* |
| Funds held until a condition | Cardano Card (1st): *"allows any agent on Cardano to buy from Amazon"*, the funds held in escrow until the order | Misa: *"locks XRP in native escrow"* |
| Released only after a check | Uplift (3rd): *"each hire is escrowed on Cardano… Chainlink verifies each deliverable before anyone is paid"* | Misa: *"the seller is paid only if the answer checks out"* |

Misa is not a copy of any one of them. It is the three rows in one product, on the new chain's native
primitive. At NYC the same shape appears in a second track winner (advances whose *"funds stay in escrow until
settlement"*) and in the desk that won Lending (shares pledged in escrow, released by loan state): three of four
track winners hold money until a check passes.

**So the method extends past one organiser.** When a theme — agent payments, lending, tokenised funds — has
just been judged elsewhere, that round's winners are a rubric for this one, translated onto the new sponsor's
primitives. Two rounds, two organisers: a **candidate rule**. Run the counting method on the sibling round
in Phase A, and expect the field to have read it too.

**And one count against the instinct.** At an event branded *"AI & Fintech"*, two of the four track winners have
no AI in their description. The banner is not a criterion in every track. It is the same mistake as ranking a
rival low because its main branch had no AI (`01-find-the-gap.md` § Reading the field).
