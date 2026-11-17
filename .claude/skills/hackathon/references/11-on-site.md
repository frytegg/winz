# Phase A½ — the first three hours on site

**Applies when** you arrive at a judged event with a prepared idea. Which, if you have used this skill, is
every time.

**It exists because of one sentence.** At TOKEN2049 Origins (Singapore, 6-8 Oct 2026, Cardano track) the judge
who had built the marketplace our project ran on wrote, early: *"I don't really see the use case here."* We
spent the next two days constructing the perfect answer to it — a concession of his strongest objection, a
line-by-line reading of his V2 contract, an evidence-rung table, a seven-page annex. He never came back and
said he saw it. **We won the argument and lost the brief.** Three winners were announced and we were not one
of them.

---

## The rule that governs the whole of Phase A

> **Preparation buys the speed to pivot. It does not buy the right not to.**

This is the correction, and it is not a retreat from Phase A. Our Phase A was good: the validator read line by
line, a census of the live contract, a measured arbitration history. By hour three of the sprint we could have
built almost anything in that ecosystem, because we understood it better than the field did.

We treated the **output** of Phase A as a commitment rather than as an option set. Depth of context is supposed
to increase your optionality, not spend it. A team that arrives knowing nothing cannot pivot because it has no
alternatives; a team that arrives deep can pivot in an hour and still be committing code before lunch — if it
remembers that it may.

---

## 1. Profile the panel before you pitch anything

**The panel composition is the rubric in practice**, whatever the rubric says. Get it as a fact, not an
inference.

Write down, by name where you can:

| Judge | Type | What they are measured on |
|---|---|---|
| | sponsor product owner / business / technical / ecosystem | |

Then answer two questions in writing:

- **Who owns a product that is in the prize?** That person has KPIs, those KPIs were set by someone above
  them, and they are usually visible in how they describe the track. At Origins, the marketplace's creator
  almost certainly needed agents listed on his marketplace. That was readable and we did not read it as a
  brief.
- **What is the mix?** Three business judges and one technical judge is a different competition from the
  reverse, and it changes what you build, not just how you present it.

**We got this exactly backwards.** Our pitch notes recorded that "three of the four judges are more technical
than we first assumed", derived from a simulated adversarial panel. The room had one technical judge. So in
the final days we added density *toward the wrong audience*, and the thing we were least able to answer —
who pays and how much — was the thing most of the panel was there to score.

A simulated panel is a tool for finding objections. **It is not a source of facts about real people.**

**The mentors in the room may be the panel.** At XRPL NYC (October 2026) the sponsor's mentor who decided
the shape of our demo — video rather than live, the whole story between two institutions, the data product
first — was a judge in the room for our track, and had sat on the Paris panel a month earlier. At an event the
sponsor runs, find out early which of the people walking the room will judge, and treat their advice on format
as the rubric in practice.

**When a bootcamp or a workshop precedes the event, this phase starts there.** NYC came after three days of
the sponsor's bootcamp, and the idea had been tested on the sponsor's people before the start tag: a foundation
engineer's single test, *"can you borrow?"*, put the successful loan before the refusal in the demo.

---

## 2. Three questions, in this order

Ask a judge, the track lead, or the sponsor's staff. In person, early, before you are committed.

1. **"What would make this track a success for you?"**
   Surfaces the KPI. This is the real grille and it is rarely the rubric text.
2. **"Which of your technologies do you most want to see used, and used how?"**
   The actionable one. A DVB teammate who took second place on a Solana track reduced his whole method to
   this: ask what they want to see used, then use it.
3. **"What have you already seen too much of?"**
   Free differentiation, and almost nobody asks it.
4. **"How do you want to see the demo: on video, live, or in your hands?"**
   At Ledger OP3N the winner put the jury inside a live demo. At XRPL NYC the sponsor's mentor, then a judge,
   said *"Si tu as le moindre bug [en live]…"* and we won with a recorded video. Only the people who will judge
   can settle it, so ask them.

Write the answers down the same hour, attributed. On day two nobody remembers who said what.

**Better: record the conversation, with consent, and log what it changes.** At XRPL NYC every mentor talk was
recorded on a phone, transcribed the same evening, and broken into numbered rows — the sponsor's mentor M1 to M7,
the business mentor B1 to B11 — each one pointing at the build step, the screen or the pitch line it changed. Five
conversations produced three of the day's four new build steps and a never-say list. Two rules come with it: a private person is never
named or quoted in public material without their agreement, and a mentor's facts are checked before use
(`02-verification.md`, the first rung).

**Where this is not allowed**, and at some events judges may not advise, ask the same three of the sponsor's
developer-relations staff. They brief the judges.

---

## 3. Pitch in two sentences and watch the first three seconds

Use the two sentences from `05-pitch-craft.md`. Deliver them, then stop talking.

**Read the reaction, not the reply.** Politeness is free and a judge will find something encouraging to say.
What you are measuring is whether their first movement is toward the idea or away from it — a question, a
name they want to connect you to, a "have you seen X", versus a pause and a reframe.

---

## 4. A negative signal from a judge is a brief, not an objection

This is the rule the whole file exists for.

When the person best placed to judge your idea says they do not see it, the correct next action is **not** to
construct a rebuttal. It is to generate alternatives.

**The protocol, and it is time-boxed to one hour:**

1. **Write down three things you could build instead**, using the context you already have, that would be a
   literal instance of the track's verb (see `01-find-the-gap.md` § Read the brief's verb).
2. **Apply the removal test** from `00-rubric.md` to each.
3. **Only then** decide whether to keep the original. Keeping it after the search is a decision. Keeping it
   without the search is not.

### The false alternative, and how to break it

The reason we never ran that search is that the choice had already been framed, internally, as *our
technically interesting project* versus *a trivial agent, basically a skill.md, which is beneath us*.

That framing was false, and the winners prove it:

| | what it was | why it is not trivial |
|---|---|---|
| **zx402**, 2nd | private funding rail for agents: a shared stablecoin pool with zero-knowledge proofs | ZK proofs over a shared pool |
| **CoinGraph**, overall winner | verified token/wallet/market intelligence; REST, MCP, ten agents; paid per call | three sponsors, each load-bearing, with Chainlink CRE attesting every answer |
| **Hirakumi**, honourable mention | paste an API link and agents can pay for it within minutes | an x402 monetisation gateway, i.e. infrastructure |

The space between *critique the rail* and *trivial agent* was enormous and full of serious engineering. We
never looked into it, because the false binary made looking feel like capitulation.

**So the check is explicit: before concluding that the other road is beneath you, write down what a plausible
winner on that road would actually have to build.** If that list is empty, you were right. It is almost never
empty.

---

## 4b. A positive signal is a brief too

The section above treats the judge who does not see it. The opposite case needs a protocol as well, because
the instinct is to protect the build and say "roadmap".

At XRPL NYC the build was thirteen hours ahead of plan by 16:00 on day one. The sponsor's mentor asked for
a margin call with a cure period instead of a liquidation, and for the whole story between two institutions;
a professor mentoring the track said a missed payment is the strongest predictor of default, and none of our
screens showed one. My advice was to add nothing. The owner overruled it:

- each ask became a written addendum within the hour — a build step, its proof, and **a time after which it
  is dropped** if not tagged;
- the first addendum went out about 45 minutes after the conversation that prompted it;
- all four new steps were tagged by 19:22, long before their drop times, and before the hardening pass;
- the pitch carried each new sentence marked as conditional on its step (`03-claims-ledger.md`).

**The rule:** a mentor's concrete ask is a brief, the same as a judge's doubt. Whether to build it is computed
from the measured slack and the cost of the step, never answered by reflex. The drop time is what makes saying
yes safe.

---

## 5. Re-run the prize map after any pivot

Our Phase A idea was multi-sponsor with every piece load-bearing: x402 for origination, Chainlink CRE for
pricing. The pivot to a single contract collapsed it to one sponsor, and **nobody reopened the prize map
afterwards.** We went from three eligible slots to one without ever deciding to.

A pivot invalidates the rubric table, the prize map and the effort allocation. Redo all three, on the spot, in
fifteen minutes. See `00-rubric.md` § The removal test.

---

## What this phase costs

Three hours, inside the sprint, and it feels like three hours not spent building. At a 36-hour event that is
8 %.

The alternative price, paid once: two days spent building the correct answer to a question nobody was
scoring.
