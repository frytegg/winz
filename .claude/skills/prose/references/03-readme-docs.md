# READMEs and documentation sets

Voice fails first at the structural level. A page that mixes a tutorial into a reference reads wrong before a
single sentence is judged, and no amount of sentence work repairs it.

## Know which of the four you are writing

Diátaxis separates documentation by what the reader is doing, and the separation is the point.

| kind | the reader | the rule that bites |
|---|---|---|
| tutorial | learning, does not yet know what to ask | *"A tutorial is not the place for explanation."* Ruthlessly minimise it. Ignore options and alternatives. |
| how-to | has a goal, is in charge | *"Action and only action."* Written from the reader's perspective, not the machinery's. |
| reference | needs a fact, is looking it up | *"Austere and uncompromising."* The structure mirrors the product's structure. Link out for instruction. |
| explanation | wants to understand why | The only one allowed to discuss alternatives, history and trade-offs. |

Title how-to guides by what they show: *"How to integrate application performance monitoring"* is right,
*"Integrating…"* is worse, *"Application performance monitoring"* is worst.

**The documented gap.** Hillel Wayne's criticism is worth carrying: the model was designed for documenting
tools and misses the **conceptual overview** a reader needs *before* deciding to engage at all, and it does not
separate a **snippet** (how something is done) from an **example** (how to do a thing). A README usually needs
that overview in its first screen, and the four-way split gives it nowhere to live.

## What a README is measured to be missing

A classifier over 4 226 sections from 393 GitHub repositories found what READMEs actually contain: How 58.4 %,
References 20.3 %, What 16.7 %, Who 7.6 %, When 4.3 %, Contribution 2.9 %, **Why 2.7 %**. The paper's finding:
*"many README files lack information regarding the purpose and status of a repository."*

So the checkable rule is: **a README with usage but no purpose and no status is missing the two things the
corpus says are usually missing.** Write the why. A weak why beats no why.

For context on the stakes, the GitHub Open Source Survey found incomplete or outdated documentation observed by
**93 %** of respondents, while **60 %** of contributors say they rarely or never contribute to it.

## The five documentation smells that are machine-detectable

From an SANER 2021 study over 1 000 documentation units, with 21 developers surveyed and 95.2 % saying these
hurt productivity: **Bloated**, **Excess Structural Information**, **Tangled**, **Fragmented**, and **Lazy**,
where lazy means *"does not provide extra info other than the method prototype"*. A generated API page that
restates the signature in a sentence is the lazy smell, and it is the most common thing a model produces when
asked to document a function.

## Rules you can lift whole

**Date or version every time-bound claim.** Google's timeless-documentation page gives the list to avoid: *as
of this writing, currently, does not yet, eventually, existing, future, in the future, latest, new, newer, now,
old, older, presently, at present, soon*. If you must use one, *"give a reference point such as a date or
version release number."* This is PR-07 in the checker. Four of the six control documents break it, so it is a
quality rule rather than a tell.

**Replace the adjective with the measurement.** The canonical pair, from Google's technical-writing course:
*"makes the application run screamingly fast"* becomes *"makes the application run 225 to 250 % faster"*.

**Declare non-goals.** From Google's design-doc practice: non-goals are *"not negated goals… but rather things
that could reasonably be goals, but are explicitly chosen not to be."* A limits section that lists what you
chose not to do reads as authored. A document with no limits reads as marketing.

**List the negative consequences.** Nygard's architecture decision records: *"All consequences should be listed
here, not just the 'positive' ones."*

**Grade normative verbs.** RFC 2119 gives MUST, SHOULD and MAY defined force, binding only in capitals. A
document that uses "should" for both a requirement and a suggestion has made the reader guess.

## Make the documentation testable

This is the part that separates documentation from an essay, and it is where the curl project is the best
teacher available. Daniel Stenberg's six requirements: docs live in the code repository, are not extracted from
code, feature examples, cover every API call, are easily browsed, and are easy to contribute to.

Then curl enforces them in CI. Test 1173 asserts that every libcurl man page carries *"the eight mandatory
libcurl sections… in the right order and that there is an example section that is more than 2 lines"*. Test
1139 asserts that the man page lists exactly the options the source has. Proselint and aspell run over roughly
482 pages.

Simon Willison's version, documentation unit tests, introspects the API surface, parses the docs, and fails CI
on anything undocumented. He also states its limit, which is the honest part: *"the tests can't confirm the
quality of the documentation… but they do at least protect against adding a new option but forgetting to
document it."*

Manny Silva's framing is the most useful sentence in the area: *"Each doc is a test suite, each procedure a
test case, each step an assertion."*

**What to take from this.** Any factual claim a document makes is a candidate for a check. A command in a
README can be run in CI. A figure can be read back from the artefact that produced it. A file path can be
asserted to exist. Prose that survives a checker reads differently from prose nobody ever verified, and the
difference is visible.

## Explaining without confusing

Julia Evans names the failure patterns better than any style guide: *unrealistic examples*, *jargon that
doesn't mean anything*, *no examples*, and *explaining the "wrong" way to do something without saying it's
wrong*. Her two positive rules are worth more than a chapter of advice: **pick one specific person and write
for them**, and **address one major knowledge gap at a time**.

## A note on generated reference

Auto-generated documentation, however good, produces exactly one of the four kinds. It is reference. A project
whose entire documentation is generated has three quarters of a documentation set missing, and a reader feels
the absence as "the docs are bad" without being able to say why.
