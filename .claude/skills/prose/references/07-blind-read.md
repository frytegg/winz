# The blind read

Phase 4 of the pass, and the only test in this skill that measures a reader rather than the text.

**Run it on**: a pitch, a video script, a README opening, a submission form: anything whose job is to be
understood once, by someone who will not re-read it.

**Run it when**: on the first complete draft, and again after every rewrite that touches the opening or the
load-bearing explanation. Not at the end. A blind read that arrives after the thing is recorded is a report,
not a test.

---

## Why it cannot be done by the author, or by one reader

You know what the project is, so every ambiguity in your draft resolves correctly inside your head and nowhere
else. That is not a discipline problem and more care will not fix it.

It also cannot be done by **one** reader given the whole text. A reader who has seen the ending answers the
"what did you understand in the first fifteen seconds" question while knowing the answer. The contamination is
total and invisible.

So the protocol uses **three readers who never see each other's work**, each testing a different thing.

---

## The three readers

| Reader | Gets | Tests |
|---|---|---|
| **A, the opening** | only the first 15 lines, or the first ~30 seconds of script | whether the hook identifies anything, and which words are undefined |
| **B, careful** | the whole text, strongest model available | the comprehension **ceiling**. If B cannot restate the mechanism, nobody can |
| **C, skimming** | the whole text, a smaller/faster model, told it is tired and on its nineteenth item | the comprehension **floor**, which is closer to a real judge on a review pile |

B and C together bracket the answer. B failing is decisive. C succeeding is decisive. The gap between them is
how much attention your text demands.

---

## Constraints that make it valid

Put all of these in every prompt, verbatim:

- **"Answer from the text alone. Do not use any tools. Do not search the filesystem or the web."**
  Without this a capable agent will find the repository and answer from it, and the result is worthless.
- **"Do not try to identify the company or product."**
- **"Answer as a first-time reader who cannot re-read."**
- **"Be honest rather than charitable. Your answer is data, not feedback to be softened."**
  Omit this and you get encouragement.
- **"If you are guessing, say you are guessing."**

And on your side: **spawn them fresh, never as a fork of your own context**, and inline the text in the prompt
rather than giving a file path. A path is an invitation to explore.

For a video script, hand over **what a viewer sees and hears**: on-screen text and voice-over, in order, with
timings. Strip every annotation, rationale and internal note. Those are the parts you most want to include
and they are exactly what destroys the test.

---

## The questions

**Reader A, opening only:**

1. What is this about, as far as you can tell? One or two sentences.
2. What do you think the product does? If you have no idea, say so.
3. What does *<each metaphor or coined term in the opening>* mean here?
4. What would you expect next?
5. Would you keep reading or watching, and why?
6. List every word or phrase you had to guess at.
7. On 1 to 5, how confident are you that you know what this is?

**Readers B and C, the whole text.** B gets all of these; C gets 1, 2, 3, 5, 6 and a single 1-to-5.

1. What does this product do? Two or three sentences, in your own words.
2. What problem does it solve, and for whom?
3. How does it work mechanically? If you cannot say, name exactly where you lost the thread.
4. Who pays for it, and how much?
5. What did they **demonstrate**, as opposed to **asserted**?
6. What did they admit they cannot do?
7. The three things you are least sure you understood.
8. If you had thirty seconds with the team, what would you ask?
9. On 1 to 5: how clearly did you understand the mechanism, and separately, how convinced are you that the
   problem is real?

Question 5 is the most undervalued. A reader who cannot separate your evidence from your claims has read a
brochure.

---

## Reading the results

- **A finding named independently by two readers is real.** One reader's confusion is that reader's habit.
- **Scores are for comparison across drafts, not for grading.** The number that matters is whether it moved
  after the rewrite.
- **"I inferred it; nobody said it" is the cheapest possible finding.** It means the reader reconstructed your
  mechanism correctly from context. The fix is words, not structure. Say the thing.
- **"I get the outcome but not the architecture" means the opposite**: they are pattern-matching the shape and
  do not have the mechanism. That is a restructure.
- **Fix the text, never the reader.** A clarification later in the document does not repair the opening.
- **Re-run with readers who have not seen the earlier version.**

Watch for the inverse failure too: an opening so careful that a reader cannot say what the thing *is*. If the
answer to "what is this" comes back as a slogan instead of an artefact, you have written a tagline, not an
identification. "The path that knows" is a slogan. "A project template" is an identification.

---

## Worked example, and what it caught

Run on a three-minute hackathon video script, 422 spoken words, on 7 October 2026: the morning of the freeze,
which was far too late.

| Reader | Score | What it caught |
|---|---|---|
| A | confidence **2/5** | two undefined proper nouns in the first 16 seconds; *"the video starts with a blog post, not the product"* |
| C, skimming | clarity **3/5** | restated the mechanism correctly and unprompted. Then, on who pays: **"Unclear from the video."** |
| B, careful | mechanism **3/5**, problem real **4/5** | *"The sentence 'What we found sits one state further on…' is doing all the load-bearing work in the pitch and I cannot tell you what state it is."* |

**The convergence:** B and C, independently, named the same sentence as the point of failure, and both came
away unable to say who paid. Two readers, same two findings, both real.

**The signature that made the fix cheap:** B went on to reconstruct the correct mechanism by inference and
then wrote *"But I inferred all of that; nobody said it."* Fourteen words of script closed it.

**What it did not catch**, and no blind read can: that the product did not appear on screen until 2:14 of
3:00. Readers report what confused them, not what was missing from the frame. Count that yourself.
