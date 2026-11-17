# Queue Clock — the two sentences

Source of /frontend's `brief.sentences` and `brief.hero` (FE-00). Each line names where it comes from.

- **What is broken:** a holder who asks to withdraw from a liquid-staking queue is told "a few days, sometimes
  longer" and cannot plan around that answer. *(source: SPEC.md section 1)*
- **What we did:** Queue Clock turns the request's place in the queue and the last fourteen finalization frames into a
  dated range, with every input visible. *(source: SPEC.md section 2)*

## Hero

- **H1:** When will my withdrawal land? *(source: SPEC.md section 6, beat 1)*
- **Sentence:** A dated range for any request in the queue, from the queue's own numbers. *(source: SPEC.md section 2)*

## Who loses, and how much

- Who: holders with a pending withdrawal, and lending protocols that accept the token as collateral. *(source:
  SPEC.md section 3, US1 and US2)*
- How much: not measured in this fixture. Any figure here would be invented; the brief records it as missing.
