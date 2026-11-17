# Finding the gap

**This is the file that decides whether you win.** Everything else in this skill protects an
idea; this is where the idea comes from.

Run it before the event, with no time limit. On the day, there is no time to do it and every
team that tries is still brainstorming at hour eight.

---

## Why searching for ideas does not work

The instinct is to brainstorm: what could we build on this technology? That produces
demos — a dashboard, a wrapper, a nicer client. Demos lose, because five other teams built
the same one and none of them is missing from the world.

The winning idea is not invented. It is **found**, in the gap between what the sponsor's
technology promises and what it actually does under a real business case.

Orma exists because a lending vault's first recognised loss is invisible to any indexer that
reads transaction metadata the standard way. Nobody brainstormed that. It was observed, on a
live network, because someone expected a change record and got an empty one.

**A finding and a product are the same object seen from two sides.** The bug is what the
technology does wrong; the product is what somebody will pay to have done right.

---

## Why an agent with shallow context finds nothing

This is the failure mode to design against, and it is not hypothetical.

A finding is **an expectation that was violated**. No expectation, no violation. An agent
told to "look for flaws" without deep context has only vague expectations, so nothing
contradicts them and it reports nothing — or worse, it invents something plausible.

The proof from our own event: we published, twice, that `OracleSet` had no operation to
remove a price pair, and asked the protocol team to add one. The transactor does it — list
the pair with no price and it is erased. We only learned that by reading
`OracleSet.cpp`. A false finding, filed in a report to the organisers, produced entirely by
not having read the implementation.

So depth is not a nice-to-have. **Depth is the generator.** An agent without it is worse
than useless, because it produces confident noise.

---

## The four layers

Every technology worth building on has four descriptions of itself, and they disagree.

| Layer | Where it lives | What it tells you |
|---|---|---|
| **Spec** | the standard, the draft, the XLS/EIP/RFC | what it is *supposed* to do |
| **Implementation** | the server source: the transactor, the validator | what it *actually* does |
| **SDK** | the client library that developers will use | what developers are *allowed* to express |
| **Docs** | the reference pages, the tutorials | what developers will *believe* |

Read them **in that order**. Spec first to build the model, implementation second to break
it, SDK third to see the constraint developers actually hit, docs last to see the belief the
ecosystem holds.

### The disagreements are the findings

Every real finding from our event was a disagreement between two of those layers. Not one
came from a generic search.

| Finding | Disagreement |
|---|---|
| Empty change set on a first loss | implementation ↔ what every indexer author assumes |
| Missing failure condition in the standard | implementation ↔ spec |
| Investment bounds: 60 in the draft, 180 on the wire | spec ↔ implementation |
| `Scale: 0` cannot be expressed | SDK validator ↔ implementation |
| SDK caps a value the server accepts | SDK ↔ implementation |
| The documented first hour cannot complete | docs ↔ implementation |
| A manager's history cannot be reconstructed | implementation ↔ what a consumer needs |

So the instruction to yourself, or to an agent, is never "find bugs". It is:

> **Read all four layers and find where they contradict each other. Then execute to see
> which one the running system obeys.**

That is also the **filter**. A finding is not a finding until all four layers have been
checked. Applied earlier, that single rule would have stopped the false `OracleSet` claim
from ever being written down.

---

## The method, in six steps

### 1. Read the docs of the technology for intent, not for usage

You are not learning to call the API. You are learning **what it is for** and what it
promises. Write down, in your own words, the promise: *this exists so that X can do Y
without needing Z*.

The promise is what you will later test. A gap is a broken promise with a price tag.

### 2. Place the main sponsor on its market

Not their product — their **strategy**. Where are they trying to go, and who are they trying
to take with them?

For our event: Ripple, moving toward real-world assets, tokenisation, private credit
on-chain. That single sentence decided everything downstream: it meant the interesting
failure modes were about **institutional money**, not retail UX.

Sources: their own positioning pages, recent announcements, who they hire, what they
acquire, what their conference talks are about, which standards they are pushing.

**Their own catalogue is part of that sentence, and it is easy to read backwards.** What the
sponsor ships first-party tells you where it puts its own engineers: built-in templates,
reference implementations, SDK modules, starter kits. The instinct is to treat a first-party
X as a closed door: *X is taken, find something else.* That instinct is
wrong often enough to cost an event. A first-party X usually means X is what they are trying
to get the ecosystem to adopt, and the built-in is the demonstration, not the market.

So split the catalogue in two, and write the fraction:

- **Subjects they have covered.** The built-in *is* the use case. Competing head-on means
  being measured against a team with more time and the house style.
- **Mechanisms they have exposed.** A service, a primitive, a call. Here the built-in is an
  advertisement.

The same entry can be either, and the brief will not say which. The test: *could ten different
products be built on this, each a different use case?* Mechanism. *Is this one product?*
Subject.

**Measured once.** On an async template bounty (October 2026) our recon logged the chain's
scheduling service as "already covered by a built-in template" and retired it on that basis.
All five winners were built on that service, each inside a different use case. It was never
the subject. It was the mechanism, and the built-in was the sponsor saying so.

**Measured twice, by a second organiser.** At XRPL NYC (October 2026) the sponsor's push was its
lending protocol, then in validator voting and not yet live. Three of the four track winners were
about credit, and only one of them was in the Lending track: a confidential-loans amendment won
Protocol Innovation, and advances for freelancers won the open track. Five of the eleven prize
winners were about lending. **Candidate rule** (two organisers): the primitive the sponsor is
pushing toward launch wins outside its own track. Ask what that primitive is in the first hour of
Phase A, and check whether your idea uses it, whatever track you enter.

### 3. Find their customers

Current and targeted. The credible use case is the one **their clients** already have, not
the one you find interesting.

This is what stops you inventing a use case nobody has. If the sponsor sells to asset
managers, your failure mode must be one an asset manager feels.

### 4. Construct one precise business use case

Not a category. A specific institution doing a specific thing with a specific amount of
money. Name it. Give it numbers.

Precision here is what makes step 5 productive: you can only tell whether a technology
breaks if you know exactly what you are asking it to do.

### 5. Saturate the context, then probe until it breaks

This is the long step and the one you cannot shortcut.

**Choose depth over breadth.** Two primitives understood completely beat six understood
partially. Pick the two that carry the use case from step 4.

For each one, in order:

- **Read the spec section, fully.** Note every constant, every failure condition, every
  invariant. Quote them into a file; you will diff against these.
- **Read the implementation source.** Find the transactor, the validator, the serialisation.
  This is where the truth is. Look specifically at: the preclaim/precondition checks, the
  constants, what gets written and what gets omitted.
- **Read the SDK's model and validator** for the same transaction. Does it know about every
  field? Does it enforce bounds the server does not, or miss bounds the server has?
- **Run the official tutorial end to end.** Do not skim it. Our first-hour finding exists
  because someone actually ran the documented setup and it failed at step five of seven.

Then, and only then:

- **Write the expectation ledger** (next section).
- **Execute every primitive** against the live system and diff.

### 6. Translate every violation into money

For each violation, answer three questions in writing:

- **Who loses?** A named role, not "users". The depositor, the lender taking collateral, the
  risk committee, the auditor.
- **How much, and how would they find out?** Put a number on it. If they would never find
  out, that is the finding, and it is a bigger one.
- **Who benefits from it staying invisible?** If the answer is a party with discretion, you
  have found an asymmetry, and asymmetries make the best products.

Worked example, all the way through:

> *Violation:* the first recognised loss leaves an empty change set.
> *Who loses:* anyone valuing the position from ledger data — the holder marking it, the
> lender taking the shares as collateral, the subscriber buying in tomorrow.
> *How much:* the reported value overstated by 19.6 % on a live vault, and nothing in the
> record says so.
> *Who benefits:* the manager, whose loss-absorbing obligation is measured against the
> figure that stayed clean.
> *Therefore:* a reader that reports the true value, published where it can be contested.

That last line is the product. It was not invented; it fell out.

---

## The expectation ledger

The step teams skip, and the reason they find nothing.

**Before executing anything**, write down what you expect. One file, one row per
transaction or call:

```
| call | what I expect to change | what I expect back | source of the expectation |
```

The **source** column is what makes it work. Writing "spec §3.3.3.2 lists ten failure
conditions" forces you to notice, later, that the server has an eleventh.

Then execute, and fill a second column with what actually happened. **Every row where the
two differ is a candidate finding.** Every row where they match is context you now own.

Keep the evidence with it: the transaction hash, the object id, the exact error string. A
finding without a citation evaporates the moment someone asks.

---

## Read the brief's verb before you choose the layer

**Do this before "Aim one layer down", because it decides whether that section applies at all.**

Briefs come in two kinds and they reward opposite moves.

| The brief says | It is | What wins |
|---|---|---|
| "Build a lending protocol", "build for the emerging X economy" | **open** | the gap play. Find what the other projects assume is solved, and build that |
| "**Show how** X **can** do Y", "demonstrate Y using Z" | **a demonstration brief** | the most convincing single instance of Y |

In a demonstration brief, the primitive-layer play is a category error. You are submitting a critique of the
organiser's product into a competition about using it — and you can be completely right and still be answering
a question nobody asked.

**TOKEN2049 Origins, Cardano track, October 2026.** The brief: *"Show how AI agents and autonomous apps can
transact on Cardano"*, and the track page called it *Agentic Commerce*. We built a settlement-repair layer for
a flaw in the sponsor's escrow contract: the measurement was sound, the mechanism held, and the judge who
wrote the contract could not fault it.

Then count the winners. **Five of five named the movement of money in their first sentence:**

- *"the check before an AI agent moves money… agents pay per call on Cardano through x402"*
- *"allows any agent on Cardano to buy from Amazon"*
- *"private payments for agents"*
- *"each hire is escrowed on Cardano… Chainlink verifies each deliverable before anyone is paid"*
- *"paste an API link and in minutes AI agents can pay for it"*

Every one is a literal instance of the brief's verb. The Cardano Foundation's own one-line description of its
winners was *"Teams built agents that pay, get paid, and prove their work."* Not one of them was trivial —
second place was zero-knowledge proofs over a shared stablecoin pool — so this is not a finding about
technical ambition. It is a finding about **which sentence the project's first line is an instance of.**

**Counted again at XRPL NYC (October 2026), on four tracks that were open briefs, not demonstrations.** The
four track winners' own one-line descriptions on the organiser's results page:

- *"Orma prices a share straight from the ledger; Orma Desk… lends against it"*
- *"any AI agent locks XRP in native escrow, and the seller is paid only if the answer checks out"*
- *"a new protocol amendment that allows loans to be issued in confidential MPTs"*
- *"helps freelancers get paid sooner through AI-verified, liquidity-funded advances"*

Four of four name a movement of money: lend, pay, issue a loan, advance. The seven partner-prize winners: four
of seven. Two organisers, two chains, the same count on the main tracks: a **candidate rule** that is no longer
limited to demonstration briefs. Whatever the brief, the first sentence says who gets money and how. The
partner prizes are a different game, as `10-calibration.md` already says of ETHGlobal.

### The demonstrability precondition

Whichever kind of brief it is, one gate applies to any gap you are considering:

> **A flaw you can only demonstrate on infrastructure you do not control is a flaw you cannot demonstrate.**

Find the path to one real execution during Phase A, or change target. "Real" means the demo acts on the same
objects the pitch is about. If the pitch is about sixty-one specific frozen escrows, the demo moves one of
them — or the pitch stops being about them. See `03-claims-ledger.md` § The subject rule.

And when the person best placed to judge the idea tells you they do not see it, that is a brief and not an
objection: `11-on-site.md` § A negative signal from a judge is a brief.

---

## Aim one layer down

The strongest position at a hackathon is not the best application. It is **the layer every
other project silently assumes is already solved.**

At our event, nearly every other team built on the secondary market: exchanges for fund
shares, credit insurance, credit default swaps. All of them were interesting. All of them
were broken without us, and none of them knew it — because every one of them needed a share
to carry a value you could trust, and that was the thing that did not exist.

The third-placed team built a protocol for swapping fund shares into liquid assets. The line
in our pitch was:

> *If I want to use BSA Fund to swap my shares for another asset and get liquid, my shares
> have to carry the right net asset value with them, or the secondary market misprices
> them.*

First person, as a **user** of their protocol, not as a critic of it. That matters — see
below.

### Why this is systematic, not lucky

On a hackathon built around a new technology, teams imagine **what you can do with it**.
That is what a demo looks like, so that is where everyone goes: applications, interfaces,
markets, aggregators.

Almost nobody asks **what is missing underneath it**, because a missing primitive is not
something you can picture until you have hit it. And you only hit it by going as deep as
Phase A demands.

So the application layer is crowded and the layer below it is empty, at almost every event.
**Aim below by default.**

### The layer test

Apply it to every candidate idea before you commit:

- **Is our output an input to somebody else's product?** If yes, you are a primitive.
- **If we are wrong, are they wrong too — and silently?** That is the strongest form: the
  dependency exists whether or not anyone acknowledges it.
- **Could a competitor at this event use us and be better for it?** If yes, you are not
  competing with them. You are underneath them.
- **Is somebody else's demo quietly assuming our problem is already solved?** Then the gap
  is proven by their existence, and you did not have to argue for it.

If the answer to all four is yes, stop looking. That is the idea.

### Then one layer up, on your own primitive

**Applies when** you won, or placed, with a primitive, and the same sponsor runs another event.

At the next event, the strongest application in the room is the one that needs your primitive, because it
is the only one with a correct value underneath it. Paris (September 2026) was won with a reader that prices
a lending-vault share from the ledger. At XRPL NYC (October 2026) we built the lending desk that lends against
that price, and it won its track. A Ripple judge from the Paris panel had said *"keep building the same
project"*, then mentored the team in New York and judged it in the room.

What makes it work, and what it costs:

- **The earlier win becomes a twenty-second credential, not the subject.** The sponsor's mentor capped it at
  *"20 secondes max"*. The new build is the pitch.
- **Ask the organiser whether a continuing project is allowed**, and make the boundary checkable (§ Boundary
  hygiene below). A judge who saw the first event will look for what is new.
- **The new layer still has to pass the layer test on its own.** The desk passed it as an application: its
  output, a refusal or an approval with a report, is an input to a risk committee.

Two events, one sponsor's people: a **candidate rule**, not a law. It may say more about that sponsor than
about hackathons.

### Reading the field

Everything above finds the gap in the *technology*. This finds your place among the *other
teams*, and it is a different question with a different answer.

A census that asks "do they have what we have?" produces a scoreboard, and a scoreboard
changes nothing you do. The question that changes what you ship is:

> **Where is our output an input to theirs?**

**When the submissions are public** — an async bounty, a showcase, a public repo list — run
it against files, not READMEs. Clone every entry and grep for the behaviours you documented.
Then read the three things a README never tells you:

- **The constants they hard-coded.** A round number with a comment saying a limit is needed,
  and not why, is a team that met your finding and worked around it blind.
- **The whole body of their catch blocks.** Where their failure story stops is where your
  decoder starts.
- **Above all, the files they inherited rather than wrote.** The strongest result of one such
  census came from a file nobody in the field had authored: the starter's own write hook
  simulates before it sends, and in eleven of twenty-two repositories nothing disabled it. So
  the assumption we had disproved was not one competitor's bug — it was the default everyone
  starts from, *including us*. That is a far stronger position than a rival's mistake, and it
  is only visible in the code.

**In a room**, at an in-person event, the same question is two conversational moves. Ask what
they are building; let them describe the happy path; then ask one mechanical question drawn
from your own findings — *what do you show the user when the wallet quotes a fee three times
what the network charges?*, *what happens if someone pastes the other form of their address?*
You are not testing them. You are listening for the layer they assume exists. **The tell is an
unhesitating answer about the product followed by a pause about the mechanism.** Write down
the team, the assumption, and the exact place it would bite them, as precisely as you would
write a file and a line number.

**When the final is a live pitch, the repository is not the entry.** Files tell you what a
rival built. They say nothing about how it will land in five minutes on a stage. At Ledger
OP3N (October 2026) the finalist recon ranked six rivals from their code and put the eventual
winner third among the threats, because its main branch had no AI. The owner, who had talked
to that team on site, had said to watch its execution. Keep two columns per rival: *what is
built*, from the files, and *how it will be shown*, from the room (a demo seen in the
corridor, a rehearsal overheard, what the team says it will hand the jury). Rank the stage
threat on the second column. When a teammate's read from the room disagrees with the files,
the room wins for the final and the files win for the questions.

### Reconnaissance is a cadence, not a phase

**Applies to every event, at every length.** Only the intervals change.

The reconnaissance that finds the idea happens before the build, and it is tempting to file it as done. It is
not done, because **the information that matters most arrives while you are building.** At the start nobody has
shipped anything and the organisers have said only what the brief says. By the middle, other entrants describe
their work in public, the organisers answer individual questions, and the sponsor ships, deprecates or
announces things that change the ground.

The clearest case we have: the definition of the heaviest scoring line, 35 of 100 points, was given nine days
before the deadline, in a support channel, in an answer to somebody else's project. Nobody who read the brief
once had it. Everybody who re-read the channels did.

**The cadence, by the length of the event:**

| length | when to re-read | what it can still change |
|---|---|---|
| 24 hours | once at the halfway point, once about two hours before you submit | the order of the demo, the first sentence, which failure you show first. Not the build |
| a weekend | the evening of day one, the morning of the last day | one feature you can still cut, the framing, what the demo opens on |
| one to three weeks | weekly, then every two days in the last week, and a final pass **three days before the deadline, never the day of** | emphasis, ordering, the documentation, and anything you can add in under half a day |

**Three rules keep this from destabilising the build.**

1. **Set the response rule before you read**, as the census section says: anything they do better that costs
   under half a day, you copy the same day; anything costlier is written down and not built. Deciding this in
   advance is what stops a late finding from becoming a late pivot.
2. **Late reconnaissance never changes the subject.** After the first pass the subject is fixed. If a later
   pass seems to demand a new one, what it actually found is that the first pass was wrong, and that is a
   lesson for the next event rather than a decision for this one.
3. **The last pass needs time to act on.** A pass that lands the morning you submit is a source of panic, not
   of decisions. Put it far enough back that a finding can still become a commit.

**What each pass asks is different.**

- **The first**, before building: is the gap real, and has anyone taken it?
- **The middle ones**: what have the organisers said to *other people* since I last looked? What has the field
  actually shipped, as opposed to announced? Has anyone moved into the gap?
- **The last**: only two questions, both narrow. Is there anything they do better that costs under half a day?
  And has anything been said, anywhere, that contradicts a claim I am about to submit?

That last question is the one that pays. A rubric clarification, a deprecation notice, a changed deadline or a
sentence from an organiser that cuts against your framing is cheap to act on three days out and expensive to
discover afterwards.

### Where the field talks, and how to read it

**Applies everywhere**, but the route changes with the event and only the route changes. The questions below
are the same whether you read them or ask them out loud.

The organiser's *support* channel is worth more than the event channel, and almost nobody reads it. The event
channel carries announcements everyone sees. The support channel carries the organiser answering individual
projects, and those answers are the rubric in plain words, given to someone else, before the call where you
would have had to ask for them.

On one bounty, three messages to three different projects, none of them ours, said: an integration is
load-bearing when the named mechanisms are what make the thing work rather than decoration; document the
deployed contracts, the transaction ids, the addresses and the exact flow; separate simulated transactions from
real ones; make the reader understand the why in the first minute; and *"I don't think you necessarily needed
more features"*. That is a specification for the last week of work, published nine days before the call.

**The route, by where they talk:**

| where | how to get it |
|---|---|
| Discord | by hand. Copying is against nobody's rules; automating it with your own account token is a self-bot, which breaks the terms of service and gets accounts banned. Start with a search for everything one organiser has written, everywhere, rather than whole channels |
| Telegram | an MCP server exists; use it rather than copying |
| a forum, a mailing list, a public tracker | fetch and read directly |
| in person | the two conversational moves above. The room is the channel |

**What to look for, in this order:** anything an organiser wrote about scoring; long answers to other people's
projects; who states a role and who does not; questions several people asked that nobody answered.

**The last one is a finding in its own right.** A question asked three times with no answer is a gap in the
organiser's own documentation, and it belongs in the developer-experience survey or the feedback channel if the
programme has one. It is also worth checking before you assume your own unanswered question was ignored: ours
was one of several.

**And a caution that saves embarrassment.** Note who is actually answering. On the programme we studied, every
usable answer came from someone whose stated role was moderator, and nobody in any channel identified
themselves as a judge. A moderator's reading is the best evidence available and is still not the rubric. Record
it as "what X said on the 16th", never as "the criteria".

### What to do with the answer

It splits in two, and the halves need opposite responses.

**The generous half: their project is the customer, yours is the infrastructure — and the move
is never to say so.** A layer claim asserted in a README is vocabulary, and a judge discounts
it. A layer claim *demonstrated* is: an interface documented for a caller who is not you, your
module answering about an input the reader chose, and your error surface sitting one import
away from the one they already have. Keep the wording generous — a user of the same base
saying what it had to add, never a critic saying what anyone else got wrong. It is also the
safest framing, because you are not claiming to be better than anyone, only to be earlier in
the stack: a statement about position, not about quality.

**The honest half matters more: sometimes the census says you are simply behind.** Then copy,
fast and without pride. One project did it three times in a day — a rival's thirty-second
entry path became an offline replay command, a rival's product screenshots became a captured
screenshot of our own refusal, and a behaviour a rival had executed while we had only
simulated was executed that evening instead of argued about. Copying a rival's table of
contents is cheaper than copying their code, and it is usually the thing actually being
scored: how a judge is let into a repository is judged before anything inside it is read.

**Set the rule before you start reading, or you will find reasons afterwards:**

> Anything they do better that costs under half a day, you copy today. Anything that costs
> more, you write down and do not build.

The field moves in hours near a deadline, and an entry that was a stub on Monday is a contender
on Thursday. Re-read it on a schedule, not on a feeling: the next section is when.

---


## The graveyard sweep

A prior-art search asks *who has built this?* and stops at what exists and works. It misses the more useful set:
**who tried, and stalled.** A startup that raised and faded, a hackathon winner with no commits after the event, a
thread on X announcing something that never shipped. (Suggested by a teammate, Eli, for Ledger OP3N 2026.)

Each one tells you two things at once: **the need is real** (someone bet time or money on it) and **there is a
specific reason it did not work**. That reason is where the gap usually lives.

For every candidate idea, before the exit test:

- **Find the stalled attempts.** Startup databases and shutdown posts, YC and accelerator batches, hackathon
  showcases (winners with a dead repo a month later), GitHub repos whose last commit is the demo day, X/Farcaster
  launch threads with no follow-up, "we're pivoting" / "we're shutting down" posts.
- **Write the stall reason in one line, with its source.** No distribution? No trust from the counterparty? A primitive
  that did not exist yet? Regulation? Unit economics?
- **Ask whether the sponsor's technology removes that exact reason.** If it does, you have both a validated need and
  the argument for why now. If the stall reason is distribution or go-to-market, a hackathon build will not fix it —
  treat the idea as a demo, not a gap.
- **Separate "cool for a jury" from "reaches its market".** Many stalled projects were excellent hackathon material and
  failed on distribution. That is fine for winning the event, but say which one you are building, and never claim
  traction you do not have.

A graveyard entry also improves the pitch: "X tried this in 2025 and stalled because Y; Y is exactly what the sponsor's
primitive now makes possible" is a two-sentence why-now that a judge can check.

---

## The exit test

Before writing a line of product code, answer these four in two sentences each. Out loud,
to another person if possible.

1. **Who is losing money today, precisely?**
2. **How does the sponsor's technology make that possible, or invisible?**
3. **Why has nobody done this?**
4. **Who pays for it, and how?** The mechanism, in two sentences. The figures go in writing,
   checked, for the questions.

The fourth question is here because two events agree. At TOKEN2049 Origins nobody could say who
paid, two business judges said so in a rehearsal, and we did not place. At XRPL NYC the pitch said
who pays and how, without a figure, and won. The night before, in a talk with the organiser's
business mentor, six of the eleven points we logged were our own figures or claims, wrong or
overstated: a Bloomberg seat at 300k instead of about 30k, a fee off by a factor of ten, a cost base
of zero. The mechanism belongs in the pitch; the numbers belong on paper before anyone asks.

If any answer needs a paragraph, you do not have an idea yet — you have a topic. Go back to
step 5.

This is the operational version of the advice a DeFi lecturer gave before the pitch: *if
they do not understand what you do in two sentences, it is worthless*. Apply it to the
**idea**, weeks before you apply it to the pitch. An idea that cannot survive the test will
produce a pitch that cannot either.

---

## The exit criteria

The mentor's three words, used as a checklist. The idea must be:

- **New** — nobody has built it. Check properly: search the ecosystem's issues, PRs, forums
  and existing products. Our headline finding had prior art we had missed on the first pass,
  and finding it made the report stronger rather than weaker.
- **Genuinely useful** — a named party would pay, or would be protected. Not "interesting".
- **Filling a market gap** — the reason it does not exist yet is a gap in the technology,
  not a lack of interest. That is what makes it the sponsor's problem too.

- **Underneath, if you can get it** — the layer other people's products need. Not a
  requirement, but when it is true it settles the question. See *Aim one layer down*.

If it is new but useless, it is a toy. If it is useful but exists, it is a clone. Both lose.
If everyone else's project needs yours to be correct, the argument is already over.

---

## Boundary hygiene

Phase A produces work **before** the event. Most hackathons have rules about that, and they
vary from "anything goes" to "no pre-existing code".

Decide the boundary before you write anything, and enforce it mechanically:

- Keep pre-event material in directories that are **gitignored from the first commit**, and
  keep a separate archive of its history outside the submitted repository.
- Never move a file out of those directories to get it committed. If the organisers confirm
  pre-event material is allowed, say plainly in the commit message where it came from.
- Knowledge always crosses. Code may not, unless the rules say so.

The research, the reading, the expectation ledger and the findings are yours to bring. The
product gets built on the clock.

**Make the boundary checkable by a judge.** At XRPL NYC: a start tag pushed at the opening, a
`HACKATHON.md` that says what came from before the event and what was built during it, and the
compare link between the two. The sponsor's own mentor suggested that proof. **That file is a
claim like any other** (`03-claims-ledger.md`): ours promised build tags up to a step that was never
built, and it was still public after the result.
