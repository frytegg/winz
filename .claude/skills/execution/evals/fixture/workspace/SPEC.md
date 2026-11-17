# Queue Clock — specification

Rehearsal fixture of /execution (contract/FIXTURE.md). Fictional event, synthetic data. The sponsor and the
candidate customers are real organisations named only as context; nothing here claims any link with them.

- Project: Queue Clock (working name, not confirmed by the owner)
- Sponsor: Lido (liquid staking), see `customers.json`
- Event: Rehearsal Hack, in person, about six hours, see `event-brief.md`
- Kickoff (T0): {{t:t0}} · Submission: {{t:end}}
- Status: draft. The owner validates this file through the spec-validation decision; any later change is a decision.

## 1. Problem

A holder of a liquid-staking token who asks to withdraw joins a queue. The queue is served once per oracle frame
(once a day), from three sources: the protocol's buffer of deposited ETH, staking rewards, and validator exits.
The holder is told "a few days, sometimes longer" and cannot plan around that answer. Integrators that accept the
token as collateral face the same question at the scale of their whole book.

## 2. What Queue Clock does

It reads the queue's latest snapshot and the last fourteen frames of finalization data, and turns the position of a
withdrawal request into a dated range: the frame by which it is likely finalized (P50), an early bound (P10) and a
late bound (P90). Every figure shows its source and its as-of time. The data in `repo/data/` is frozen and synthetic.

### 2.1 The ETA rule (normative; FR-004 implements it)

- Inputs: the request's ETH ahead in the queue plus its own amount (`need`), the last snapshot's frame instant
  (`frame`), and the `capacity_eth` of the up-to-seven frames at or before the instant of the estimate.
- Fewer than three frames available: the estimate is "insufficient data", never a guess.
- Rates: `fast` = 9th decile, `p50` = median, `slow` = 1st decile of those capacities, computed with inclusive
  linear interpolation between closest ranks (the method of Python's `statistics.quantiles(method="inclusive")`).
- Frames needed: `k = ceil(need / rate)` for each rate; ETA = `frame + k` days. P10 uses `fast`, P50 `p50`, P90 `slow`.
- Arithmetic on ETH amounts is decimal (strings in the data, a decimal type in code), never binary floating point.
- Worked example (the demo request 48259 at the last snapshot): need = 19489.94 + 1.95 = 19491.89 ETH; rates
  4877.518 / 2891.84 / 2136.708 ETH per frame; k = 4 / 7 / 10; P10, P50, P90 = last frame + 4, 7 and 10 days.

## 3. User stories

| id | priority | story |
|---|---|---|
| US1 | P1 | As a token holder with a pending withdrawal, I want to see when it will likely be finalized, as a range with its sources, so that I can plan around it. |
| US2 | P2 | As a risk analyst at a lending protocol that accepts the token, I want the queue's size and its recent finalization capacity in one place, so that I can judge exit liquidity. |
| US3 | P3 | As a token holder, I want to be told when my request is finalized, so that I do not have to come back and check. |

## 4. Functional requirements

| id | priority | required | group | surface | status expected | requirement |
|---|---|---|---|---|---|---|
| FR-001 | P1 | yes | G1 Request ETA | ui | — | Look up a withdrawal request by id (from `data/requests.json`) and show the ETH ahead of it as of the latest snapshot, with the snapshot time. An unknown id says so and suggests the demo request. |
| FR-002 | P1 | yes | G1 Request ETA | ui | simulated | Show the request's ETA as the P50 date with the P10-P90 range (rule 2.1), labelled simulated, with the as-of time and the inputs used. |
| FR-003 | P2 | yes | G2 Queue health | ui | — | Queue health panel: unfinalized ETH and request count at the latest snapshot, the capacity of each of the last 7 frames split into buffer, rewards and exits, and their median. |
| FR-004 | P1 | yes | — | api | — | ETA engine: a pure function from (request, snapshots, frames, instant) to {p10, p50, p90, rates, frames_used} or "insufficient data", implementing rule 2.1 exactly, with unit tests including the worked example. |
| FR-005 | P2 | yes | — | cli | — | Command line: `queue-clock eta --request <id> [--json]` prints the engine's answer; exit 0 on an answer, 1 on "insufficient data", 2 on an unknown id. |
| FR-006 | P3 | no | G1 Request ETA | ui | planned | Notify the holder when the request is finalized. Shown in the UI as planned, with no control that pretends to work; not built in this event. |
| FR-007 | P3 | no | G2 Queue health | ui | — | Backtest table: the replayed requests of `data/requests.json` with at least three prior frames, predicted P50 frame against the actual finalization frame. |

## 5. Success criteria

| id | criterion | measured by |
|---|---|---|
| SC-001 | The engine is deterministic: the same inputs give byte-identical JSON output. | two runs of the CLI on the demo request, compared byte for byte |
| SC-002 | On the replayed requests that have at least three prior frames, the P50 frame is within one frame of the actual finalization for at least three of the four. | the backtest command's output against `data/requests.json` |
| SC-003 | The first view loads with no request to another origin and no console error. | /frontend's `render` gates |
| SC-004 | Every figure on screen carries its source (`data-source="simulated"`) and an as-of time. | /frontend's `coverage` gates |
| SC-005 | The worked example of rule 2.1 is reproduced exactly (4 / 7 / 10 frames). | the engine's unit test |

## 6. Demo beats (recorded video, at most 180 seconds)

1. The first view asks the question a holder asks: when will my withdrawal land? (10 s)
2. Enter request 48259: the ETH ahead, then the P50 date and the P10-P90 range, labelled simulated, with the inputs. (40 s)
3. The queue health panel: why the date moves (buffer, rewards, exits per frame, and their median). (40 s)
4. The backtest: what the rule got right and what it missed, row by row. (40 s)
5. The command line printing the same answer as JSON for an integrator. (25 s)
6. The planned notification, labelled planned, and the close. (15 s)

## 7. Out of scope

- Reading any chain, any live API or any oracle; the data is frozen and synthetic.
- Any transaction, on any network.
- Wallet connection, accounts, persistence of user data.
- Delivering notifications (FR-006 is shown as planned only).
- Other liquid-staking protocols, prices, yields, and any prediction of validators' exit decisions.
- Any statement that the estimate is guaranteed, or that the sponsor or a candidate customer endorses the project.
