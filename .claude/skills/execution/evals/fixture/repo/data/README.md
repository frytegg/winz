# Data (frozen, synthetic)

Three JSON files generated with a fixed seed (20260110). They imitate the shape of a liquid-staking withdrawal queue
and describe no real protocol and no real request. ETH amounts are decimal strings; read them with a decimal type,
never as binary floating point. Times are UTC; one oracle frame per day at 12:00 UTC, the last one at the latest
snapshot.

## `exit-rate-series.json`

`frames`: 14 entries, oldest first.

| field | meaning |
|---|---|
| `frame_at` | the frame's instant (UTC) |
| `capacity_eth` | ETH available to finalize requests at this frame: buffer + rewards + exits |
| `from_buffer_eth`, `from_rewards_eth`, `from_exits_eth` | the three parts of the capacity |
| `finalized_eth` | ETH actually finalized (whole requests only, so at most the capacity) |
| `requests_finalized` | number of requests finalized at this frame |

## `queue-snapshots.json`

`snapshots`: one per frame, taken right after it.

| field | meaning |
|---|---|
| `as_of` | the snapshot instant (the frame's instant) |
| `unfinalized_eth`, `unfinalized_requests` | what is still waiting |
| `last_finalized_request_id`, `last_request_id` | the queue's two ends |
| `buffer_eth` | the buffer used at that frame |

## `requests.json`

`requests`: tracked requests.

| field | meaning |
|---|---|
| `request_id`, `requested_at`, `amount_eth` | the request |
| `eth_ahead_at_request` | ETH ahead of it when it was made (backtest rows) |
| `eth_ahead_now` | ETH ahead of it at the latest snapshot (open rows) |
| `finalized_at` | the frame that finalized it, or null while open |
| `role` | `backtest` (finalized, used by the backtest), `demo` (request 48259, the demo request) or `open` |

The rule that turns these numbers into an ETA is the specification's (rule 2.1), not this file's.
