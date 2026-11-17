# Claims ledger

Every claim the pitch, the README, the report or the slides make, and what backs it.
Started day one. Closed at the freeze. Nothing ships as `unverified`.

Queue Clock rehearsal fixture: the format is /hackathon's `assets/claims.md`; the rows are fixture content with mixed
statuses on purpose (verified, unverified, cut). Every figure is synthetic and labelled so wherever it is shown.
Verifiers append rows during the run with status `unverified` (contract/CLI.md `wave ingest`).

| # | claim, as it will be said or shown | where it appears | evidence | status |
|---|---|---|---|---|
| 1 | Queue Clock reads fourteen daily finalization frames. | README; first-view footer | `data/exit-rate-series.json`: 14 entries in `frames` (count re-run at instantiation) | verified |
| 2 | Median finalization capacity over the last seven frames: 2,891.84 ETH (synthetic). | queue health panel | median of `capacity_eth` over the last 7 entries of `data/exit-rate-series.json`; `tools/gen_data.py` summary `median_capacity_last7_eth` | verified |
| 3 | Unfinalized at the last frame: 38,863.77 ETH (synthetic). | queue health panel | `data/queue-snapshots.json`, last snapshot, `unfinalized_eth` | verified |
| 4 | For request 48259, the P50 lands seven frames after the last snapshot (P10 four, P90 ten). | demo beat 2; video | SPEC.md rule 2.1 worked example; not yet computed by the product (FR-004, SC-005) | unverified |
| 5 | On the four replayed requests with at least three prior frames, the P50 is within one frame for three. | demo beat 4; slide | SPEC.md SC-002; the backtest is not built yet (FR-007) | unverified |
| 6 | Every figure on screen is synthetic and labelled as such. | footer; every figure | SPEC.md SC-004; /frontend coverage gates not run yet | unverified |
| 7 | Withdrawal time guaranteed to the day. | (removed) | contradicts FR-002 (a range, never a promise); on the never-show list as a do-not-carry phrase | cut |
| 8 | Built with the sponsor's endorsement. | (removed) | no endorsement exists; event rule 4 | cut |

## Closing checklist

- [ ] Every `unverified` row is cut or verified
- [ ] Every claim checked in **all** the places it appears — deck, README, spoken script
- [ ] Counts recounted from the artifact this morning, not from memory
- [ ] Every forward promise traced to the file that makes it possible
- [ ] Read aloud in order, listening for contradictions
