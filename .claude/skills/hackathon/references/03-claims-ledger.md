# The claims ledger

One table, started on day one, closed before the freeze. Every claim the pitch, the README,
the report or the slides make, and what backs it.

It exists because of one line that was written into a deck twice:

> *"Five pull requests. Two issues. Five findings on your own developer tooling."*

Zero pull requests had been filed. Zero issues. The tooling findings had never been sent to
anyone. The jury contained maintainers of the repositories named. Both times, it was caught
by someone asking **"is that actually true?"** — once by an audit, once by the presenter.

The ledger makes that question systematic instead of lucky.

---

## The table

```
| # | claim, as it will be said or shown | where it appears | evidence | status |
```

- **Claim** — the sentence as the audience will receive it, not a summary of it. "Forty per
  cent more should have come from the manager" is a claim; "we analysed ordering" is not.
- **Where** — slide number, README section, report page, spoken line. A claim usually appears
  in three places and they drift apart.
- **Evidence** — a transaction hash, a file and line, a screenshot, a committed artifact. A
  link to something that exists.
- **Status** — `verified`, `unverified`, `cut`. Nothing ships as `unverified`.

Keep it in the repository, not in someone's head.

---

## What counts as a claim

More than you think. All of these need a row:

- Every **number** said aloud or shown on a slide.
- Every **superlative or first**: "the only", "nobody has", "first to".
- Every **count**: findings, transactions, pull requests, lines, users.
- Every **promise about what happens next**: "signed live", "this runs now", "you can try it".
- Every **attribution**: "reported before us by", "the maintainer said", "the spec requires".
- Every **negative**: "there is no way to", "it is not documented anywhere", "no operation
  removes this". Negatives are the most dangerous rows in the table — see `02-verification.md`.

---

## The counting rule

A count in a pitch is a promise that someone could recount it.

Counts drift because work continues after the slide is written. Ours drifted in both
directions: a findings total changed as items were withdrawn, and a filings total was
aspirational rather than actual.

- Recount every number **on the morning of the pitch**, from the artifact, not from memory.
- If a count will still be moving at pitch time, **say the count that is true when you walk
  up**, and write the slide so it does not need editing — put the number in your mouth, not
  on the wall.
- An honest four beats an inflated five, in front of the people who own the repositories.

---

## The promise rule

A promise made at minute one has to be kept at minute three.

Our script said *"the two deposits at the end are signed live, in front of you"*. There was
no key file on disk and no replay script. The sentence had survived several rewrites because
it sounded good and nobody traced it to an artifact.

**For every forward-looking promise, name the file that makes it possible and open it.** If
you cannot, cut the sentence. A demo that shows less and delivers everything beats one that
promises more and stalls.

---

## Attribution claims

Claims about other people are the ones that cost the most and are checked the most easily.

- Quoting a mentor or a judge: check the words against what was actually said. A paraphrase
  presented as a quotation costs credibility at the worst possible moment, and they are in
  the room.
- Naming prior art: verify it exists, is still open or closed as you say, and that you have
  described the author's position fairly. We described another developer's state of mind by
  inference from timestamps; it was cut before filing, because he would be notified by the
  cross-reference and it was not ours to guess.
- Naming a maintainer's work as untouched, unmerged or docs-only: re-check the day you say
  it. That fact changed under us in thirteen hours.

---

## The subject rule

**The subject of the pitch and the subject of the demo must be the same object.**

This is not about testnet versus mainnet. No source I have found shows a measured penalty for demonstrating on
a testnet — Colosseum expects devnet, HackQuest treats a verified testnet deployment as the baseline, and the
only stated mainnet preference I could find is a 2022 TRON forum post about visibility rather than scoring.

It is about whether the thing you measured is the thing you moved.

At TOKEN2049 Origins the pitch was built on **sixty-one named frozen escrows on mainnet**, counted, dated and
pinned to a block. The demo settled an escrow we had created ourselves on a test network. Both halves were
true. They were about different objects, and a blind reader's very first question was:

> *"Of the 61, how many have you settled on mainnet? If zero, what is blocking the first one — the contract,
> or finding two counterparties who'll both sign?"*

Record it in the ledger as its own row: **what the headline claim is about**, and **what the demonstration
acts on**. If the two cells differ, you have one of three jobs, and no fourth option:

1. make the demo act on the real objects;
2. manufacture an instance of the real object you control — on the same network, with your own funds, so the
   demo is of the real thing at your own risk and nobody else's (see `06-operations.md` § Scope the rule to
   the hazard);
3. change the headline so it is about what you actually moved.

---

## Three columns the table grew at XRPL NYC

**Applies to** any event where the pitch is spoken by people who also talk to mentors all day.

- **Never say.** The words that are wrong, and the words the sponsor dislikes even when they are right. Ours
  held *"liquidation"* (the sponsor's mentor: institutions get a margin call and time to cure), *"structured
  products"* (*"tu offres la plateforme"*), and *"every lending vault is closed-ended"*, which the server
  source contradicts. Each row says what to say instead.
- **Conditional rows.** A sentence that exists only if a build step is tagged by a written time. The script
  carries it marked, and it is deleted, not softened, if the step is dropped.
- **Spoken claims.** What the team says in a corridor is a claim too. A guest listening to our explanation
  caught three wrong statements in one conversation (*"everything is off-chain"*, a margin call *"if the
  borrower defaults"*, *"looping"*). They went into the never-say column the same evening.

## Every surface a judge reads, the form included

The ledger covered the deck, the README and the script. It did not cover the submission form, and the
organiser's results page still carries our own banned sentence, *"Today every XRPL lending vault is
closed-ended"*, under the winning entry. The same week, the repository's `HACKATHON.md` promised build tags
up to a step that was never built.

List the surfaces before the freeze — the form, the short and long descriptions, the boundary file, the
repository's About line — and run the same three closing checks on each.

## Closing the ledger

At the freeze, walk the table top to bottom and do three things:

1. **Every `unverified` row is cut or verified.** No exceptions, no "it's probably fine".
2. **Every claim is checked in all the places it appears.** The deck, the README and the
   spoken script drift; the same figure must be the same figure everywhere.
3. **Read the claims aloud in order.** Hearing them in sequence surfaces the ones that
   contradict each other, which reading silently does not.
