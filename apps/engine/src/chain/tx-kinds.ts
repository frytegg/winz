/**
 * Which transactions of one signer may be in flight together (SPEC ST-3, task R-02).
 *
 * The sender broadcasts a signer's transactions without waiting for the previous one to be mined
 * only for the kinds listed here, each with the reason it is safe to simulate, sign and send while
 * other transactions of the same signer are not mined yet. Simulation runs on the latest block,
 * which does not hold the transactions still in flight: a kind is listed only when what those
 * transactions change cannot make its simulation lie in a way the engine does not already handle.
 *
 * Every other kind, and any kind not listed (a typo included), is a BARRIER: it is prepared only
 * once nothing of its signer is in flight, it travels alone, and nothing queued after it is
 * signed until it is mined. `createCampaignFor`, `setPaused`, `closeSales`, `settle`,
 * `payMerchant` and `release` are barriers: their effects order what comes after them.
 *
 * Checked against `packages/contracts/src/WinzEscrow.sol` and the engine's callers.
 */
export const INDEPENDENT_TX_KINDS: Readonly<Record<string, string>> = Object.freeze({
  /**
   * The relayer buys a ticket of a live campaign for a customer (`_purchase`). What two purchases
   * share on-chain: `ticketCount` (each takes the next id, read back from its own
   * `TicketPurchased`), the campaign's `hedgeReserved` and `lockedRefunds` (sums), the treasury's
   * balance (each pulls its own amount) and `nonceUsed` (each quote has its own random nonce).
   * A purchase simulated before an earlier one is mined can still revert on-chain when, together,
   * they exceed the budget (`BudgetExceeded`) or the treasury's funds; the purchase handler
   * already reads an on-chain revert as it reads a simulation revert (the same reasons, ending
   * the payment cancelled), and checks the budget and the sale state before every quote. A pause
   * or a close is a barrier: no purchase is simulated while one is in flight, and every purchase
   * queued before it is mined before it.
   */
  buyFor:
    "a ticket of a live campaign: independent of other purchases; the engine checks budget and sale state first, and an on-chain revert ends the payment as a simulation revert does",
  /**
   * The oracle charges the hedge of tickets that are already mined (`_existingTicket`). Two
   * charges in flight hold disjoint tickets: the hedging lane leaves out every ticket a queued,
   * sent or mined `chargeHedge` holds (`pendingCharges`, `remainingLots`), and the settlement's
   * safety net cuts one sorted list into batches after waiting for its own earlier batches. Each
   * charge only lowers its own tickets' reservations and pays the treasury out of the escrow,
   * which holds every reservation. `settle` (oracle) is a barrier, so no charge is in flight
   * with it. The safety net, which runs only after the finalizer failed, first waits (within its
   * transaction wait) for every `chargeHedge` of the outbox still queued or sent that holds one of
   * the campaign's tickets, the hedging lane's included, and reads the tickets again after it. The
   * one overlap left (a lane charge still not final after that wait) reverts on-chain with
   * `HedgeAlreadyCharged` instead of failing in simulation: both are read the same way by both
   * callers.
   */
  chargeHedge:
    "tickets already mined, disjoint between the charges in flight; an overlap reverts HedgeAlreadyCharged, handled as a simulation failure is",
  /**
   * Anyone (here the relayer) refunds tickets of a campaign settled YES. The settlement sequence
   * enqueues the batches only once `settle` is mined and read back on-chain, cuts them from one
   * sorted list (disjoint), and never builds new batches while batches of an earlier run are
   * still in the outbox. A ticket already paid out, or of another campaign, is skipped, not
   * reverted, and a failing token transfer is caught (`trySafeTransfer`): a batch cannot revert
   * because of another batch.
   */
  refundBatch:
    "disjoint tickets of a campaign already settled YES; a batch skips paid tickets and never reverts because of another batch",
});

const INDEPENDENT = new Set(Object.keys(INDEPENDENT_TX_KINDS));

/** True when transactions of this kind may be in flight with others of the same signer. */
export function isIndependentTxKind(kind: string): boolean {
  return INDEPENDENT.has(kind);
}
