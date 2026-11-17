# Developer experience journal

The raw material for the feedback deliverable. **One row per friction or surprise, written at the
moment it happens**, because the report is due weeks later and nobody remembers the exact error
string by then. See `references/07-contribution.md` § The journal.

Times in UTC. Never a paraphrase where the verbatim text fits.

| When (UTC) | Who | Where (page / endpoint / tool / version) | What I tried | What happened (exact text) | Time lost |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## What earns a row

- An error, refusal or rate limit, with its **code and its verbatim message**.
- A documented behaviour that differs from the live one, either direction.
- A number the tool quotes that is not the number it enforces.
- An endpoint, flag or field that changed shape, disappeared, or needs an undocumented header.
- A **success that was expected to fail**, or vice versa. Both are findings.
- Anything that cost more than ten minutes, even when the cause was your own mistake — especially
  then, if the tool's error pointed at the wrong thing.
- **Your own defects**, when the failure mode is one you are criticising upstream. A report that
  admits the same class of error it complains about is read differently.

## What does not

Your own typos, your own misreadings that the tool reported correctly, and anything with no number,
no verbatim text and no reproduction. A journal padded with those is a journal nobody trusts.

## Rules that keep it usable

- **Reproduce line on every row.** The exact request, the exact command, the exact URL. A row a
  reader cannot re-run is an anecdote.
- **Mark each row VERIFIED or UNVERIFIED**, and say who verified it. A second agent re-executing the
  call is enough; your memory is not.
- **Keep refuted rows, marked refuted.** They are how a careful reviewer is told apart from a
  confident one, and the strongest page of the report is the one that names its own withdrawals.
- **Scope every number.** "Slow" is not a row; "4,982 ms, three times, same host" is.
- **Never delete a row because the vendor fixed it.** Date the fix and keep both. That the behaviour
  existed on the date you built against it is the fact.
