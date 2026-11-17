# The dry run

**Applies when** the build is planned from a written spec, the event lasts a day or more, and its rules let
knowledge cross into the event but not code. **Does not apply** to a remote bounty where the build *is* the
preparation, or to an event where pre-existing code is allowed outright: there, keep building.

The owner's plan before XRPL NYC (October 2026), in the owner's words: build the project once in a private throwaway
repository, *"rencontrer des erreurs, itérer dessus"*, collect every place the spec was wrong, fix the spec,
then on the day *"coder tout de A à Z mais avec la spec corrigée, donc une exécution sûre"*.

---

## What it measured

- **The dry run:** sixteen steps built from the start tag in 8 h 43 of wall clock, against 23 h 30 planned.
  117 spec defects journalled with an id, each one written back into the next version of the spec.
- **The event:** steps 1 to 14 tagged in 3 h 21, and 13 hours ahead of plan by 16:00 on day one.
- **What the slack bought:** four steps added that afternoon, three of them asked for by mentors, each one
  tagged by 19:22 (`11-on-site.md` § A positive signal is a brief too). The project won its track, 1st of 12.

The time saving is a measurement. That it caused the win is not: `10-calibration.md` says what one result is
worth.

## The rehearsal says what it did not rehearse

The dry run's own report predicted the event: *"the constraint on Saturday will not be build speed. The margin
must be planned for what was not played: production, the spoken pitch."* Everything that hurt on the day was on
that side of the line:

- the first screen a judge would see, which nobody could read (`04-demo-audit.md` § A screen a judge cannot
  place themselves in);
- the demo state, consumed by the takes for the video (`06-operations.md` § Consumable demo state);
- the account's usage limit, hit at midnight by an unbounded audit (`06-operations.md` § The account's usage
  limit);
- production, which the dry run never deployed.

**So the dry run's real output is a list:** what it built, and what it did not play. Write the second list
explicitly, with an owner per line, and spend the event's slack on it before spending it on anything else.

## How to run it

1. **Same spec, same agents, same machine, a throwaway private repository.** Anything you change between the
   two runs is a thing the dry run did not test.
2. **Journal every spec defect with an id at the moment it is hit,** the same rule as the friction journal
   (`07-contribution.md` § The journal). A defect fixed in the code and not in the spec comes back on the day.
3. **Play the parts that are not code:** the deploy to the place the judges will open, the first screen read
   blind by someone who knows nothing, the demo actions with their irreversible units counted, the pitch said
   aloud with a timer by the people who will say it.
4. **Freeze the spec the evening before, and check its fingerprint on the build machine before the start
   tag.** At NYC the final spec landed at 10:50 on build day, a stale copy sat on one build clone, only a
   manual fingerprint check caught it, and the start slipped 2 h 20.
5. **Rebuild from a start tag on the real repository,** and make the boundary checkable: `01-find-the-gap.md`
   § Boundary hygiene.

## The boundary

A dry run is the strongest form of *knowledge crosses, code does not*: the spec and the defect journal cross,
every line of product code is written again on the clock. Say so in the repository, in a file a judge can open,
and point at the tag and the compare link. The sponsor's own mentor suggested exactly that proof at NYC.
