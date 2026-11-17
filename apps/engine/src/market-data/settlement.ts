import type { Outcome } from "@winz/shared";

import type { RawChildEvent, RawEvent } from "./schemas";

/** Event status Gemini documents for a cancelled or voided event. Never observed live. */
export const INVALID_EVENT_STATUS = "invalid";

function collect(event: RawChildEvent, outcomes: Map<string, Outcome>): void {
  for (const contract of event.contracts) {
    if (event.status === INVALID_EVENT_STATUS) {
      outcomes.set(contract.instrumentSymbol, "void");
    } else if (contract.resolutionSide === "yes" || contract.resolutionSide === "no") {
      outcomes.set(contract.instrumentSymbol, contract.resolutionSide);
    }
    // No resolutionSide yet: the contract is still open, nothing to report.
  }
}

/**
 * Outcome of every resolved instrument in a Gemini events payload: `resolutionSide` of the
 * contract, or "void" for every contract of an event whose status is "invalid".
 *
 * Works on the recently-settled list and equally on active events, where some contracts
 * (a spread line already out of reach, for instance) settle before the event does.
 */
export function parseSettlements(rawEvents: readonly RawEvent[]): Map<string, Outcome> {
  const outcomes = new Map<string, Outcome>();
  for (const event of rawEvents) {
    collect(event, outcomes);
    for (const child of event.events ?? []) collect(child, outcomes);
  }
  return outcomes;
}
