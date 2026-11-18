# Croisement interne (HE-7, tâche H-09) : consigne de construction

**État au 18 novembre 2026 : conçu et jugé, non construit.** La décision de le construire est laissée pour après la porte G3.

## En deux phrases

Quand deux campagnes sont exposées aux deux issues opposées d'un même match (« Texas gagne » pour l'une, « Arkansas gagne » pour l'autre), Winz peut compenser la part commune en interne au lieu d'acheter les deux contrats sur Gemini : il encaisse les deux primes, qui valent ensemble au moins 1, et paie lui-même le côté gagnant, qui vaut exactement 1. Le gain est l'écart de prix et les frais évités.

## Pourquoi ce n'est pas construit

- Trois conceptions ont été écrites puis attaquées par trois juges (argent, accord avec le code, risque de livraison). Chaque conception avait de 3 à 7 défauts sérieux ; la consigne ci-dessous est la synthèse qui les corrige ou retire ce qui ne peut pas l'être.
- Elle demande 10 à 12 heures d'agent, tests compris, et touche la décision d'achat de la politique de couverture, le cœur de la boucle prouvée sur Arc testnet.
- Le croisement se déclenche rarement : il faut de l'exposition pas encore achetée des deux côtés en même temps, et son résultat n'est comptabilisé qu'une fois les deux campagnes réglées.
- Version retenue, réduite : les deux contrats YES d'un match à deux issues, avant le coup d'envoi, plafonnée par événement, derrière le réglage `APP_INTERNAL_CROSSING` coupé par défaut. Coupé, le moteur doit se comporter exactement comme aujourd'hui, et la consigne demande de le prouver.

## Choix à confirmer avant de construire

- When to build. Recommended: after the back-end Musts the user wants done by 15:00 (TASKS.md still lists A-06/HE-1 and other open items as unchecked; verify which are really open). HE-7 is a Should and the first thing to drop. Merge it only with the flag off and only once the off-golden test and the full suites are green.
- Leg price. Recommended: the best ask with no fee. The merchant then pays at most the taker cost its quote assumed, fewer lots hit the guarantee cap, and Winz's gain is the spread only, with the fees avoided shown as a merchant benefit. The alternative is the literal SPEC 9.4 reading: charge the taker cost with fee and count the fees avoided in Winz's gain. Product owner to confirm.
- When P&L is booked. Recommended: when outcomes are known (crossing_gains / crossing_losses), with the expected gain shown as 'pending' before that. A judge or juror sees a booked number only after both legs settle, so the demo script must include settlement.
- Price gate. Recommended: askA + askB >= 10_000, as SPEC 9.4 writes it. A book summing to exactly 1 (the NHL fixture) gives a zero gain, so the demo books must sum above 10_000, e.g. 1000/9200.
- Per-event cap on unrealized crossed quantity. Recommended default: 300_000_000 micro-contracts, a worst-case loss of 300 USDC per event, the same order as uMax.
- The switch. Recommended: the env flag APP_INTERNAL_CROSSING, which needs a restart to change, rather than a live engine_params key. This is what lets the engine never reference the new table while off.
- Pre-empting resting makers is a product choice: a crossed merchant pays the ask instead of a possibly cheaper maker fill at bid + 1 tick. It is always within maxHedgeCost. Confirm, and say it in the pitch.
- Demo guard. Recommended: include it. Forcing one leg 'void' while a crossing is open is refused unless the partner is already void, so a VOID demo cannot be run on a crossed pair.
- Enabling for the demo. Recommended: only after the local-chain crossing e2e and one two-sided rehearsal with the flag on have left receipts. Nothing about HE-7 should be claimed publicly before that.

## Risques qui restent

- Crossing seldom fires in practice. It needs exposure on both legs that is not yet filled, and inside the 60-minute forced-taker window each new E is filled by a taker in the same pass. A demo has to create both sides' exposure early, with makers resting.
- Double failure: if the crossing transaction's outcome is unknown and five re-reads fail, the reservation is released anyway. A runner can then buy up to q on the venue on top of the crossing. That surplus is bounded by q and resold by HE-6 into resale_result.
- Each attempt suspends the runner's hedging of the reserved quantity for up to about 2 s, plus up to 1.5 s for the transaction, and delays other instruments' reads in that pass by as much. The breaker's 5 s grace absorbs it, but a large reservation on a thin book could come close.
- The crossing result is on cost basis. When the quote guarantee binds (quotes made at different prices), the cash result can be negative while the crossing shows a gain. The difference sits in guarantee_losses, so the net engine P&L is exact, but the desk must show the two side by side.
- Complementarity rests on stored catalogue data and on an unverified assumption: two-way leagues settle as yes/no, no/no or void/void. A mislabelled side, or a demo forced result set after a crossing, can produce a recorded loss of at most qty per crossing and at most the cap per event.
- The 'released' and 'void' legs count zero revenue, which is conservative. A campaign that is emergency-released may still have been charged, so the booked result can understate Winz's real result.
- Real venue (H-07, not in the hackathon): crossed contracts exist only internally. Any future reconciliation of H against a real Gemini balance must subtract crossed.
- Effort is about 10 to 12 hours with the Postgres concurrency and property tests and the local-chain e2e. That competes with the user's goal of finishing the back end by 15:00.
- The new migration adds a table and an engine_pnl column. supabase/tests SQL checks (if they pin table or column lists or RLS coverage) may need attention. Those files are outside the builder's allowed set, so the builder will report rather than edit them.

## La consigne (telle que remise à l'agent de construction, en anglais)

TASK (H-09 / SPEC HE-7, 9.4, 9.6, a reduced and provably safe subset, off by default): build internal crossing of the two YES moneyline contracts of a two-way game. When both instruments carry exposure that is neither bought nor committed to a taker order, the engine records the common quantity as two internal buy fills, one per side, priced at that side's best ask with no fee. They are written through the existing fill and allocation ledger in one Postgres transaction, so no Gemini order is placed for that quantity. Merchants are charged through the unchanged lot and chargeHedge path, and Winz's result is booked per event once both outcomes are known. One env setting, APP_INTERNAL_CROSSING (default false), switches the whole feature. While it is false, the engine's SQL, the runner's decisions, the database writes and GET /api/hedge-desk must be exactly today's, and you must prove it with the tests below.

Read first, in full:
- /home/user/winz/SPEC.md: requirements HE-1 to HE-10 (around line 240) and sections 9.1 to 9.7 (lines 366-410).
- /home/user/winz/TASKS.md: item H-09.
- /home/user/winz/apps/engine/src/hedging/policy/runner.ts (whole file) and /home/user/winz/apps/engine/src/hedging/policy/decide.ts.
- /home/user/winz/apps/engine/src/hedging/runtime/service.ts (whole file), /home/user/winz/apps/engine/src/hedging/runtime/store.ts and /home/user/winz/apps/engine/src/hedging/runtime/desk.ts.
- /home/user/winz/apps/engine/src/hedging/runtime/sink.ts, /home/user/winz/apps/engine/src/hedging/runtime/charger.ts and /home/user/winz/apps/engine/src/hedging/runtime/index.ts.
- /home/user/winz/apps/engine/src/hedging/allocation/store.ts and /home/user/winz/apps/engine/src/hedging/allocation/core.ts.
- /home/user/winz/apps/engine/src/chain/projector.ts: refreshExposure, projectTicketPurchased and the CampaignSettled handling.
- /home/user/winz/supabase/migrations/20261117000000_init.sql: tables orders, fills, lots, lot_fills, positions and engine_pnl.
- /home/user/winz/supabase/migrations/20261117010000_catalog.sql and /home/user/winz/supabase/migrations/20261117040000_engine_pnl_resale.sql.
- /home/user/winz/packages/shared/src/api/schemas.ts (the hedge desk schemas) and /home/user/winz/packages/pricing/src/fees.ts.
- /home/user/winz/apps/web/lib/server/hedge-desk.ts, /home/user/winz/apps/web/lib/server/hedge-desk.test.ts and /home/user/winz/apps/web/lib/server/demo.ts.
- /home/user/winz/apps/web/e2e/loop.test.ts (lines 199-211), /home/user/winz/apps/web/e2e/support/ledger.ts, /home/user/winz/apps/web/e2e/support/world.ts and /home/user/winz/apps/web/e2e/rehearsal/invariants.ts.
- Test helpers: /home/user/winz/apps/engine/src/hedging/policy/test-support.ts, /home/user/winz/apps/engine/src/hedging/runtime/test-support.ts and /home/user/winz/apps/engine/src/hedging/allocation/test-support.ts.
- Existing tests: runner.exposure-read.test.ts, held.property.test.ts, store.conservation.test.ts, store.test.ts and service.reconcile.test.ts.
- Wiring: /home/user/winz/apps/engine/src/config/env.ts, /home/user/winz/apps/engine/src/app.ts and /home/user/winz/apps/engine/src/index.ts.

Units everywhere: money in bigint micro-USDC; prices in bigint basis points (tick = 100); quantities in bigint micro-contracts (step STEP = CONTRACT_STEP_MICRO = 10_000). floorStep(q) = q ≤ 0 ? 0 : (q / STEP) * STEP. ceilStep is the existing ceilToContractStep.

1. Scope.
In scope:
- Crossing the two instruments of one game that the complementarity rule (point 3) accepts.
- Only exposure that is neither held nor committed to a taker buy. Resting buy makers may be pre-empted through the reservation in point 4.
- Before events.starts_at, and while neither instrument is salesOver.
- Realized P&L per event, an optional Hedge desk section, a demo guard, and a pure rehearsal invariant.

Out of scope (do not build):
- Unwinding or selling contracts already bought on the venue.
- Spreads, totals and three-way markets.
- Crossing after the start or after sales close.
- A live toggle through engine_params.
- The U-06 page.
- Any real-venue (H-07) concern.

2. The setting and the off contract.
- In env.ts, add APP_INTERNAL_CROSSING: booleanString.default(false) and document it in /home/user/winz/.env.example.
- index.ts passes it as tuning.hedging.internalCrossing.
- HedgingServiceOptions gains:
  - internalCrossing?: boolean (default false);
  - internalCrossingMaxOpenQtyPerEvent?: bigint (default 300_000_000n, i.e. 300 contracts, the worst-case loss bound per event in micro-USDC);
  - crossingAttemptTimeoutMs?: number (default 2_000).
- Changing the setting requires a restart.

Off contract, all four must be proven by the tests below:
- (a) The engine issues no SQL whose text matches /crossing/i.
- (b) The runner's new fields crossed and crossingReserved stay 0n for the whole run.
- (c) Every existing test passes unchanged.
- (d) The live_hedge_desk payloads and GET /api/hedge-desk are byte-identical to today's whenever no crossings row exists.

Toggling across restarts must stay consistent. Off after on: the synthetic fills stay in `bought`, so derivedHeld still counts them; crossed reads as the literal 0 in both the restore and every read, so Δ = 0. On after off: the restore and the listing read crossed from the same statement, so Δ = 0.

3. Complementarity.
New function `listComplementPairs(sql, symbols: readonly string[]): Promise<ComplementPair[]>` in apps/engine/src/hedging/crossing/store.ts, with exactly this predicate:

select a.symbol as instrument_a, b.symbol as instrument_b, a.event_ticker
from instruments a
join instruments b on b.event_ticker = a.event_ticker and a.symbol < b.symbol
join events e on e.ticker = a.event_ticker
where a.symbol = any($1) and b.symbol = any($1)
  and a.type = 'moneyline' and b.type = 'moneyline'
  and a.side in ('home','away') and b.side in ('home','away') and a.side <> b.side
  and a.active and b.active and a.outcome is null and b.outcome is null
  and e.sport <> 'soccer' and e.status in ('upcoming','active') and e.starts_at > now()
  and (select count(*) from instruments m where m.event_ticker = a.event_ticker and m.type = 'moneyline') = 2
  and not exists (select 1 from demo_overrides d where d.instrument in (a.symbol, b.symbol) and d.forced_result is not null)
order by a.event_ticker, a.symbol

- The count deliberately includes inactive rows: normalize skips non-active contracts, so a missing Draw row proves nothing.
- Safety rests on two facts only: mutual exclusivity (at most one leg settles YES) and the price gate in point 7 (askA + askB ≥ 10_000). A tie or NO/NO is a gain for Winz.
- The rule is stricter than safety needs, so that "complementary" means what SPEC 9.4 says.

4. Runner changes, in policy/runner.ts only. All of them are additive and inert at 0n.
- `ExposureRead.crossed?: MicroContracts` and `PolicyRestore.crossed?: MicroContracts`. Absent means "unchanged" in a read and 0n in a restore.
- Private fields `crossed` (initialised to restore.crossed ?? 0n) and `crossingReserved` (0n).
- onExposureRead:
  - Validate read.crossed when present (a bigint ≥ 0, else PolicyInputError).
  - readCrossed = read.crossed ?? this.crossed.
  - Stale order: older_read, then older_settlements, then readCrossed < this.crossed gives the new reason "older_crossings". Log it like the others and return { applied: false, reason }.
  - On apply, in this exact order: added = readCrossed − this.crossed; this.crossed = readCrossed; this.held += added; then the existing release-or-set-exposure step. Adding before releasing makes H = max(0, H + added − released).
  - `changed` already covers H.
  - The applied outcome object and exposureReadState() keep their exact current shape. Do not add fields to them, or to PolicyRunnerSnapshot.
- New `applyCrossedTotal(total: MicroContracts): MicroContracts`, synchronous and idempotent on the cumulative total. If total ≤ this.crossed it returns 0n and changes nothing. Otherwise it adds delta = total − this.crossed to held, sets this.crossed = total, requests a cycle (not awaited, errors logged as in onExposureRead) and returns delta.
- New `reserveForCrossing(qty: MicroContracts): Promise<void>`. It throws PolicyInputError if qty < 0, if a reservation is already non-zero, if the runner is not started, or if reconcileRequested is true. Otherwise it sets crossingReserved = qty and returns this.requestCycle(), which resolves once a cycle started after the request has finished.
- New `releaseCrossingReservation(): void`, synchronous. It sets crossingReserved = 0n and, if it was > 0n, requests a cycle (not awaited).
- New `crossingState()`. It returns { restored, crossed, reserved, exposure, held, openBuyQty, openTakerBuyQty }, where:
  - openBuyQty = Σ remainingOf(order) over this.orders with side 'buy' (exactly the set maxBuyQty iterates over, including pending and unconfirmed placements);
  - openTakerBuyQty is the same sum restricted to kind 'taker'.
- policyState(): held becomes `this.held + (this.reconcileRequested ? 0n : this.crossingReserved)`. A reservation can never drive a sell.
- maxBuyQty(): `let committed = this.held + this.crossingReserved`.
- maxSellQty(), unhedgedNotional() (and therefore the breaker), withinOneStep() and the desk snapshot keep the real held.
- reconcile() throws PolicyInputError while crossingReserved > 0n. That is a bug guard; the service slot in point 6 makes it unreachable.

5. Store changes, in runtime/store.ts.
- listHedgeInstruments(sql, options: { crossings?: boolean } = {}), getHedgeInstrument(sql, symbol, options = {}) (passing the options through), and loadRestoreState(sql, instrument, venue, prefix, options = {}).
- Each selects `crossed` IN THE SAME STATEMENT as exposure and settled_allocated:
  - when options.crossings is true: (select coalesce(sum(x.qty),0) from crossings x where x.instrument_a = <symbol> or x.instrument_b = <symbol>)::bigint;
  - otherwise the literal 0::bigint, so the text never names the table.
- HedgeInstrumentRow.crossed?: MicroContracts and RestoreState.crossed?: MicroContracts are OPTIONAL, so hand-built rows in existing tests still type-check.
- The service passes { crossings: this.internalCrossing } at every call site: syncInstruments, createEntry and reconcileForFinalize.
- handRead passes `crossed: row.crossed`; createEntry passes `crossed: state.crossed` in restore.

6. The crossing attempt, in runtime/service.ts.
- Entry gains `crossing: Promise<void> | null`, a slot like `reconciling`. The two waits:
  - reconcileForFinalize waits on it exactly as it waits on `reconciling`: at the top of the loop, and again after followSettlements (`if (entry.reconciling !== null || entry.crossing !== null) continue`).
  - The sales-close claim in syncInstrument additionally requires entry.crossing === null.
- In syncInstruments, AFTER the first per-row loop (every runner has this pass's read) and before the retire loop, add:
  if (this.internalCrossing) { try { await this.crossComplements(rows) } catch → log error }
  then, under the same flag and in its own try/catch, `await this.realizeCrossings()` (point 10). The rest of the method is unchanged.
- crossComplements(rows) makes AT MOST ONE attempt per pass: the first pair, in order, whose two legs X both satisfy all the preconditions below.

Preconditions on each leg X:
- An entry exists and needsRunner(row).
- !salesOver(row, now) and row.eventStartsAt > now.
- entry.reconciling === null and entry.crossing === null.
- runner.crossingState(): restored is true, reserved === 0n, and crossed === (row.crossed ?? 0n). Otherwise a previous crossing has not reached the runner: skip.
- snapshot: !reconcilePending, !breaker.active, !stale, askBps not null and between 100 and 9_900.
- sink.pendingCount(X) === 0.

The attempt:
- Claim both slots synchronously right after the checks. Release them in `finally`.
- Plan:
  - potential(X) = exposure − held − openTakerBuyQty (from crossingState). Resting makers are not subtracted: they will be pre-empted.
  - preRoom = a read-only query giving lotRoom(X) and capRemaining (definitions in point 7).
  - x = floorStep(min(potential(A), potential(B), lotRoom(A), lotRoom(B), capRemaining)).
  - If x < STEP, release and skip.
- Reserve: `await Promise.all([runnerA.reserveForCrossing(x), runnerB.reserveForCrossing(x)])`, raced against the attempt deadline (crossingAttemptTimeoutMs measured from the reservation). That cycle cancels the makers the reservation makes surplus: decide step 9 cancels the newest first while working > room, or cancels with not_needed.
- Then poll every 50 ms until sink.pendingCount is 0 on both legs and every precondition still holds, until the deadline. On timeout or a failed precondition: release both reservations and skip, logging at warn with the reason.
- Commit quantity: qMem(X) = exposure − held − openBuyQty (crossingState again, after the cycle); q_plan = floorStep(min(x, qMem(A), qMem(B))). If q_plan < STEP: release and skip.
- Call recordCrossing (point 7) with maxQty = q_plan and the runners' askBps and bookObservedAtMs.
- On status 'crossed', in ONE synchronous block with no await: runnerA.applyCrossedTotal(crossedTotalA); runnerA.releaseCrossingReservation(); then the same for B.
- Then requestCharge() if coveredLots is non-empty. Log at info: pair, qty, prices, expectedGain, feesAvoided.
- On 'skipped': release both reservations and log at info with the reason.
- On a thrown error (the commit outcome is unknown):
  - re-read both rows with getHedgeInstrument(…, { crossings: true }) up to 5 times, 200 ms apart;
  - for each leg whose row.crossed > runner crossed, applyCrossedTotal(row.crossed);
  - then release the reservations;
  - if every re-read fails, release anyway and log at error "crossing outcome unknown: possible over-hedge of q, resold by HE-6".
- No exception ever leaves crossComplements.
- HedgingTestHooks gains the additive hook `beforeCrossingCommit?: (pair: { a: string; b: string }) => Promise<void>`, awaited just before recordCrossing.

Proof obligation, to state in a code comment and test in point P3:
- E is frozen during the attempt: only syncInstruments, which is sequential, and finalize, which is blocked by the slot, hand reads.
- While the reservation r = x is in force, every new buy keeps H + r + openBuys ≤ ceilStep(E) (maxBuyQty).
- Fills move quantity from openBuys into H without changing the sum. No sells happen outside reconcile mode.
- At the commit, q ≤ r and q ≤ E − (H + openBuys) measured after the reservation cycle.
- Hence, after H += q: H + openBuys ≤ max(H0 + B0 + q, ceilStep(E) − r + q) ≤ ceilStep(E). This is the bound the runner already guarantees today, so a crossing never creates surplus for HE-6 to resell, apart from the double-failure case above.

7. recordCrossing(sql, req) in apps/engine/src/hedging/crossing/store.ts. One sql.begin transaction, in this order:
- (1) `set local lock_timeout = '500ms'` and `set local statement_timeout = '1500ms'`.
- (2) pg_advisory_xact_lock(hashtextextended('winz:hedge-crossing:' || event_ticker, 0)).
- (3) The allocation lock of min(A,B), then of max(A,B). Export the existing lockInstrument from allocation/store.ts; add `export` and change nothing else.
- (4) `select … from instruments where symbol in (A,B) order by symbol for share`. Both outcomes must be null and neither may have a demo forced_result, else skip 'settled'.
- (5) `select … from positions where instrument in (A,B) order by instrument for update`.
- (6) Per leg X:
  - roomDb(X) = positions.exposure − derivedHeldOf(bought, sold, settled_allocated) − Σ(qty − filled_qty) over orders with instrument = X, side 'buy' and status in ('working','partially_filled'), using the same subquery definitions as listHedgeInstruments;
  - inv = heldInventoryOf(tx, X); skip 'short' if inv.shortQty > 0;
  - lotRoom(X) = Σ(l.qty − l.filled_qty) over the lockOpenLots predicate (instrument X, filled_qty < qty, not charged, campaign status not in the settled set) − inv.qty;
  - capRemaining = cap − Σ qty of crossings with this event_ticker and realized_at is null.
- (7) q = floorStep(min(maxQty, roomDb(A), roomDb(B), lotRoom(A), lotRoom(B), capRemaining)). If q < STEP, return { status: 'skipped', reason: 'no_room' } (rollback, nothing written).
- (8) Prices: pA = askA and pB = askB. Require 100 ≤ p ≤ 9_900 and pA + pB ≥ 10_000, else skip 'price'.
  - cost_X = fillCost(p_X, q, 0n) = mulDivUp(p_X, q, 10_000). This is exact because q is a multiple of 10_000.
  - expected_gain = cost_a + cost_b − q, which is ≥ 0.
  - fees_avoided = mulDivUp(q, takerFeeBps(pA), 10_000) + mulDivUp(q, takerFeeBps(pB), 10_000). It is informational and goes to the merchants, not to Winz.
- (9) id = a new uuid. For each leg, A then B:
  - insert into orders (instrument X, side 'buy', kind 'taker', price_bps p_X, qty q, filled_qty q, status 'filled', venue = the service's venue name, venue_order_id 'cross.' + id without dashes + '.a' or '.b');
  - then recordFill(tx, { orderId, venueFillId: 'cross', priceBps: p_X, qty: q, fee: 0n, at, bookRef: null });
  - assert status 'recorded', replacedShort === null, and Σ qty of result.allocations whose fillId is this fill's id === q. Otherwise throw CrossingAllocationError, which rolls everything back.
- (10) Insert the crossings row.
- (11) `update positions set held = held + q where instrument in (A,B)` and assert 2 rows.
- (12) Read crossedTotal per leg (Σ crossings.qty touching the instrument).
- Return { status: 'crossed', crossingId, qty: q, expectedGain, feesAvoided, crossedTotalA, crossedTotalB, coveredLots } (coveredLots from both recordFill results).
- Lock order is event lock, then allocation locks in symbol order, then instrument rows, then positions rows, then lots (inside recordFill). It must never be changed.
- Nothing is written to engine_pnl at crossing time. maker_savings is unaffected because bookRef is null.

8. Charging, which needs no code change.
- The synthetic fills enter each instrument's FIFO queue behind older inventory, are allocated by the unchanged allocateAndWrite, and are charged min(cost, max_hedge_cost) by chargeCovered or chargeRemaining. Any excess goes to guarantee_losses as today.
- The on-chain cap HedgeAboveGuarantee is untouched. settle, payMerchant and refunds do not read the ledger.
- apps/web/e2e/support/ledger.ts stays UNCHANGED. Internal fills must stay inside fillsCost, because loop.test.ts:205 (charged + guaranteeLosses == fillsCost) holds with them included.

9. Finalize and sales close. The waits are described in point 6. A crossing never happens once salesOver, so the sales-close reconciliation sees the synthetic contracts in H and reaches |H − E| ≤ STEP without selling.

10. Realization and P&L, booked once per crossing when outcomes are known.
- realizeCrossings(sql) runs only while the flag is on. It selects crossings with realized_at is null (partial index) and, for each, the lot_fills of fill_a and fill_b joined to lots and campaigns.
- A crossing is ready when every such campaign has status in ('settled_yes','settled_no','void','closed').
- result = Σ over those lot_fills of ( [status in (settled_yes, settled_no)] · lf.cost − [status = settled_yes] · lf.qty ). 'void' contributes 0, since the treasury returns hedgeSpent, and 'closed' (released) contributes 0, which is conservative.
- state:
  - 'void' if every lot is void;
  - else 'released' if any lot is closed;
  - else 'inconsistent' if both legs have settled_yes lots, or exactly one leg has void lots;
  - else 'settled'.
- One transaction: `update crossings set result, realized_state, realized_at = now() where id = $1 and realized_at is null returning event_ticker`. If a row came back, upsert engine_pnl (event_ticker from crossings) adding max(result,0) to crossing_gains and max(−result,0) to crossing_losses.
- Identities:
  - result ≥ −qty always, because each term lf.cost − lf.qty ≤ 0 and cost_a + cost_b ≥ qty;
  - result = expected_gain on yes/no or no/yes;
  - result = expected_gain + qty on no/no;
  - result = 0 on void/void.
- The result is on cost basis. The cap excess on crossed lots is already in guarantee_losses, so the net engine P&L stays exact. The desk shows guarantee losses per event next to the crossing result. Never call the crossing gain "cash".

11. Engine desk payload, in runtime/desk.ts.
- The orders and fills queries add `(o.venue_order_id like 'cross.%') as internal`. The payload sets `internal: true` only when that is true, and omits the key otherwise.
- write() gains an optional third argument { crossed?: MicroContracts }. The service's tick passes runner.crossingState().crossed, and the payload carries `crossed` only when > 0n.
- Shared schema: hedgeInstrumentSchema gains crossed: microContractsSchema.optional(); hedgeOrderSchema and hedgeFillSchema gain internal: z.literal(true).optional().

12. Web API, in apps/web/lib/server/hedge-desk.ts and schemas.ts.
- hedgeDeskResponseSchema gains `crossing: hedgeDeskCrossingSchema.optional()`.
- It is included ONLY when `select to_regclass('public.crossings') is not null` is true AND at least one crossings row exists. totals, params and every existing key are unchanged.
- Contents, all digit strings:
  - totals { crossedQty, pendingGain (Σ expected_gain of unrealized rows), atRiskQty (Σ qty unrealized), losses (Σ engine_pnl.crossing_losses), feesAvoided };
  - events: up to 50 rows of { eventTicker, eventTitle, makerSavings, guaranteeLosses, crossingGains, crossingLosses, crossingPending, crossedQty }, over events having an engine_pnl or crossings row, ordered by starts_at desc. This is SPEC 9.6.
  - recent: the latest 20 crossings as { id, eventTicker, labelA, labelB, qty, priceABps, priceBBps, costA, costB, expectedGain, feesAvoided, state: 'open'|'settled'|'void'|'inconsistent'|'released', gain: string|null, loss: string|null, at }.
- The web computes nothing beyond sums.

13. Demo guard, in demo.ts forceDemoResult, inside its transaction.
- Only if to_regclass('public.crossings') is not null and an unrealized crossing touches the instrument:
  - refuse 'yes' when the other leg of that crossing has forced_result 'yes' or instruments.outcome 'yes';
  - refuse 'void' unless the other leg is already forced or settled 'void'.
- Use the module's existing conflict-style error (HTTP 409); report which one you used.
- With no crossing rows the behaviour is today's.

14. Rehearsal invariant. Add an exported pure function crossingsBalanced(sample) to apps/web/e2e/rehearsal/invariants.ts. It is vacuous on an empty sample and checks, per crossing:
- qty % 10_000 = 0;
- cost_X·10_000 = price_X·qty;
- expected_gain = cost_a + cost_b − qty ≥ 0;
- Σ lot_fills.qty of each fill = qty;
- result null or ≥ −qty.
Per event it checks crossing_gains − crossing_losses = Σ realized results.
- Wire it into the rehearsal's checks only if no existing test pins the list or count of invariants and the collection can be guarded by to_regclass. Otherwise leave it unwired and report.

15. Migration /home/user/winz/supabase/migrations/20261118000000_internal_crossing.sql. It is additive: no existing constraint is dropped or altered.
- create table public.crossings with these columns:
  - id uuid primary key;
  - event_ticker text not null references events(ticker) on delete restrict;
  - instrument_a and instrument_b: text not null references instruments(symbol) on delete restrict;
  - qty bigint not null;
  - price_a_bps and price_b_bps: integer not null;
  - cost_a, cost_b, expected_gain and fees_avoided: bigint not null;
  - order_a and order_b: uuid not null unique references orders(id);
  - fill_a and fill_b: uuid not null unique references fills(id);
  - book_a_at and book_b_at: timestamptz not null;
  - result bigint, realized_state text, realized_at timestamptz (all nullable until realization);
  - created_at timestamptz not null default now().
- CHECK constraints:
  - instrument_a < instrument_b;
  - qty > 0 and qty % 10000 = 0;
  - both prices between 100 and 9900;
  - price_a_bps + price_b_bps >= 10000;
  - cost_a * 10000 = price_a_bps::bigint * qty, and the same for b;
  - expected_gain = cost_a + cost_b - qty and expected_gain >= 0;
  - fees_avoided >= 0;
  - (result is null) = (realized_at is null) and (result is null) = (realized_state is null);
  - result is null or result >= -qty;
  - realized_state is null or in ('settled','void','inconsistent','released').
- Indexes on instrument_a and on instrument_b, and a partial index on event_ticker where realized_at is null. Enable row level security, then `revoke all on public.crossings from anon, authenticated`.
- alter table public.engine_pnl add column crossing_losses bigint not null default 0, add constraint engine_pnl_crossing_losses_nonneg check (crossing_losses >= 0).

Reference example, to be used as exact fixtures:
- Event NCAAF-2611212030-ARK-TEX-M. Instrument a = …-M-ARK (away, bid 800, ask 1000); instrument b = …-M-TEX (home, bid 9000, ask 9200).
- M1 has a TEX lot of 50_000_000 with a resting TEX maker of 50e6 at 9100. M2 has an ARK lot of 20_000_000 with a resting ARK maker of 20e6 at 900.
- x = 20_000_000. The reservation cycle cancels TEX's 50e6 maker and re-places 30e6 at 9100, and cancels ARK's maker (not_needed). Then q = 20_000_000.
- cost_a = 2_000_000; cost_b = 18_400_000; expected_gain = 400_000; fees_avoided = 126_000 + 104_000 = 230_000 (takerFeeBps 63 at 1000, 52 at 9200).
- Realized results:
  - TEX yes / ARK no: +400_000 to crossing_gains;
  - no/no: +20_400_000;
  - void/void: 0, state void;
  - TEX yes / ARK void: −1_600_000 to crossing_losses, state inconsistent;
  - yes/yes: −19_600_000, which is ≥ −20_000_000.

Tests. All files are NEW. Seeded property tests use the repository's existing seeded PRNG style. Each case lists the mutation it must fail under; the verifier will apply them.

U1, apps/engine/src/hedging/crossing/core.test.ts (pure plan and price functions):
- asks 9_200 + 799 refused, 9_200 + 800 accepted with gain 0. Mutations: guard removed, or `>=` changed to `>`.
- floorStep(min) gives 20_000 for rooms 25_000 and 1_234_567, and 9_999 is refused. Mutations: ceil instead of floor, or max instead of min.
- The reference example gives exactly the numbers above. Mutations: fee included in cost, or mid or bid used instead of the ask.

U2, policy/runner.crossing.test.ts (FlakyVenue/Scenario from policy/test-support):
- (a) A read with crossed +x raises H by x in the same synchronous step. Mutation: `held += added` dropped.
- (b) crossed lower than the runner's gives older_crossings, with E and H unchanged. Mutation: guard removed.
- (c) held_before < released ≤ held_before + x in one read gives H = held_before + x − released with no clamp log. Mutation: release applied before the add.
- (d) A restore with crossed N followed by a read with N gives Δ 0. Mutation: restore.crossed ignored.
- (e) applyCrossedTotal is idempotent and ignores lower totals.
- (f) A reservation makes the next cycle cancel the newest maker above the room and place nothing beyond ceilStep(E) − H − r. Mutations: reservation left out of maxBuyQty; reservation left out of policyState.
- (g) With reconcileRequested the reservation is ignored by decide and no sell is ever driven by it; reserveForCrossing throws while reconcileRequested. Mutation: the `reconcileRequested ? 0n` branch removed, which produces a sell.
- (h) Every existing runner.exposure-read.test.ts scenario replayed without `crossed` gives identical outcomes.

P3, policy/runner.crossing.property.test.ts (1_000 seeds). Random E, H, resting makers and takers, ask and book moves. Fills happen during the reservation wait, including a maker filling before its cancel. TTL expiry and ask-move replacement occur inside the window, and the forced-taker window is sometimes on. The service's commit rule (q = floorStep(min(x, E − H − openBuyQty))) is applied, then applyCrossedTotal and release, then 5 more cycles. Assert after every cycle:
- H + openBuyQty ≤ ceilStep(E);
- no sell order is ever placed;
- q ≤ x.
A coverage counter requires ≥ 200 cases where a maker filled during the window and ≥ 200 where q < x. Mutations: committing x instead of the recomputed q; counting makers as pre-emptable at commit time; reservation not in maxBuyQty.

PG1, crossing/store.test.ts (Postgres):
- The reference crossing writes exactly:
  - two filled 'cross.%' orders, and two fills with fee 0 and book_ref null;
  - FIFO lot_fills (each fill fully allocated);
  - the crossings row;
  - positions.held +q on both legs;
  - engine_pnl untouched, maker_savings unchanged.
- An open taker buy row in orders reduces q. Mutation: roomDb removed.
- Lots pre-marked charged so lotRoom < q: CrossingAllocationError or no_room, with zero rows written anywhere. Mutations: lotRoom bound or allocation assertion removed.
- A prior over-sale gives skip 'short' with zero rows.
- An outcome set between plan and transaction gives 'settled'.
- The cap binds across two crossings.
- A forged row violating each CHECK is rejected by Postgres.
- Complementarity: yes for the home/away pair, and no for each of these, one case each (mutation: drop any single predicate):
  - different events;
  - spread;
  - total;
  - null side;
  - 'tie' side;
  - same side;
  - a third moneyline row, active or not;
  - soccer;
  - outcome set;
  - active false;
  - event status closed, settled or void;
  - forced_result;
  - starts_at in the past.

PG2, crossing/conservation.crossing.property.test.ts (30 seeds, mirroring store.conservation.test, with crossings interleaved among buys, resales, over-sales and allocateHeldInventory). After every step, per instrument:
- paid − (Σ lots.cost + soldCostBasis + replacedCost + inventory.cost) = 0;
- Σ lots.cost = Σ lot_fills.cost;
- Σ lot_fills.qty of each crossing fill = qty.
Mutation: writing the leg outside recordFill, or with a fee.

PG3, runtime/held.crossing.property.test.ts (24 seeds, real projectChainEvent with settlements of either leg in any order, as in held.property.test). Assert:
- derivedHeld = allocatedUnsettled + inventory − short = loadRestoreState.held = listing.derivedHeld;
- listing.crossed = restore.crossed = Σ crossings.qty touching the instrument when crossings is true, and both are 0 when false.

PG4, concurrency: 50 rounds of recordCrossing(A,B) racing PgPolicySink.writeFill on A and on B, plus projector TicketPurchased and CampaignSettled on both. Assert:
- zero deadlock errors;
- fills.created_at strictly increasing per instrument;
- the PG2 identities hold after each round.
Mutation: taking the allocation locks in a different order.

PG5, crossing/realize.test.ts: settle through the real projector the outcome pairs yes/no, no/yes, no/no, void/void, yes/void (forced), yes/yes (forced) and a released campaign. Assert result, state and the engine_pnl deltas match the reference table, and a second realizeCrossings books nothing. Mutations: the `realized_at is null` predicate removed; void counted as revenue.

S1, runtime/service.crossing.test.ts (Postgres, paper venue, HandBookSource, the createHedgeHarness options or the service built directly; new helpers go in crossing/test-support.ts). The reference example end to end:
- no venue order for the crossed 20e6, with the TEX maker re-placed for 30e6;
- chargeCovered enqueues 2_000_000 for M2;
- the sales-close reconciliation is within one step on both legs with no sell;
- finalize succeeds on both.
Further cases:
- Restart right after the commit: no second Δ, and no order for the crossed quantity.
- TEX salesOver: no crossing.
- Asks summing to 9_900: no crossing.
- beforeCrossingCommit fills the TEX maker during the window: q shrinks, the invariant holds, and nothing is resold at sales close.
- beforeCrossingCommit starts finalize on TEX: finalize waits for the slot, then succeeds. Mutation: slot check removed.
- A thrown error injected after the commit: the re-read applies the total and nothing is placed for it.

S2, runtime/service.crossing-off.golden.test.ts:
- Script a two-instrument scenario covering sales on both legs, resting makers, fills, a TTL replacement, sales close, charges and finalize.
- Run it with internalCrossing false and compare a normalized record against a JSON fixture: orders (side, kind, qty, price, status), fills (price, qty, fee), lots (cost, filled_qty), charges, positions, engine_pnl, and desk payloads minus timestamps.
- Generate the fixture on the UNTOUCHED tree, before any non-test source edit, through an UPDATE_GOLDEN=1 path, and report the command.
- On a dedicated postgres.js connection with the `debug` option recording every query text, assert no query matches /crossing/i.
- Assert runner.crossingState().crossed and reserved are 0n throughout.
- Mutations: crossComplements or realizeCrossings running when off; the listing subquery not gated.

W1, apps/web/lib/server/hedge-desk.crossing.test.ts:
- With no crossings rows the response deep-equals today's shape: no `crossing` key, totals unchanged.
- With seeded crossings and engine_pnl rows, the section matches the stored numbers.
W2, a demo guard test in a new file: both refusals, and no change when no crossing exists.

E2E on the local chain, new file /home/user/winz/apps/web/e2e/crossing.test.ts using WorldOptions.tuning { hedging: { internalCrossing: true } }; if a second instrument cannot be seeded through the existing support, add helpers in a NEW apps/web/e2e/support/crossing.ts:
- two campaigns, on ARK and on TEX, with demo books summing to 10_200;
- sales on TEX, then on ARK;
- wait for a crossings row;
- close sales, force TEX yes and ARK no, settle both;
- assert per instrument charged + guaranteeLosses == fillsCost (the same helper as loop.test);
- assert every charge ≤ maxHedgeCost, and moneyAddsUp per campaign;
- assert the crossing is realized with result = expected_gain, engine_pnl.crossing_gains equals it, and the desk `crossing` section shows it.
The full existing e2e and rehearsal suites must pass with the flag off.

Constraints:
- Create or modify ONLY these files:
  - the new directory apps/engine/src/hedging/crossing/ (core.ts, store.ts, index.ts, test-support.ts and the tests above);
  - policy/runner.ts;
  - runtime/store.ts, runtime/service.ts and runtime/desk.ts;
  - allocation/store.ts (the `export` keyword on lockInstrument only);
  - config/env.ts, index.ts and .env.example;
  - the new migration;
  - packages/shared/src/api/schemas.ts;
  - apps/web/lib/server/hedge-desk.ts and demo.ts;
  - apps/web/e2e/rehearsal/invariants.ts;
  - the new test files listed above and the new e2e support file.
- Do NOT modify:
  - decide.ts, breaker.ts, allocation/core.ts, sink.ts, charger.ts, projector.ts;
  - anything under settlement/, packages/pricing, packages/contracts;
  - existing migrations;
  - apps/web/e2e/support/ledger.ts, or any existing support or test-support file;
  - TASKS.md.
- Other agents are editing test files right now. Do not edit, skip, weaken or re-baseline ANY existing test. Every new test lives in a new file.
- TypeScript strict, no `any`, explicit types, bigint units, pino logging (no console.log).
- Do not commit or push.
- Run the full engine and web unit, integration and e2e suites, plus the supabase SQL tests if a runner exists, with the flag off.
- Cut order if time runs out: the rehearsal wiring first, then the web `recent` list. Never cut points 2 to 10 or their tests. If points 2 to 10 cannot all be green, deliver nothing behind the flag and report.

Report:
- For every numbered point: does the code exist, and was it run with a receipt (test name and result)?
- Every interpretation you made, and every deviation from this brief, with the reason.
- The golden-fixture generation command, and evidence that the fixture was produced before any source edit.
- The commands run and their pass counts.
- Whether the rehearsal invariant was wired.
- The demo guard's error type.
- Anything left undone.
