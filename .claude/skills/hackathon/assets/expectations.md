# Expectation ledger

Written **before** executing anything. Nothing can be violated if nothing was expected —
this is the step teams skip, and it is why they find nothing.

Fill the first four columns from the spec and the implementation source. Then execute, fill
the fifth, and diff. **Every row where expectation and reality differ is a candidate
finding.** Every row where they match is context you now own.

The `source` column is what makes this work: writing "spec §3.3.3.2 lists ten failure
conditions" is what lets you notice, later, that the implementation has an eleventh.

| call | what I expect to change | what I expect back | source of the expectation | what actually happened | evidence |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## The four layers

Read in this order, and note where they disagree — the disagreements are the findings.

- [ ] **Spec** — the standard or draft. Every constant, failure condition, invariant.
- [ ] **Implementation** — the transactor, validator, serialisation. The truth.
- [ ] **SDK** — the client model and validator. What developers may express.
- [ ] **Docs and tutorial** — what the ecosystem believes. Run the tutorial end to end.
