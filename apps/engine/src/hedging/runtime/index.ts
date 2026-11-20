import { HedgingService, type BreakerStatus, type HedgeFinalizer } from "./service";
import type { HedgingServiceOptions } from "./service";

export {
  GUARANTEE_LOSSES_KEY,
  HedgeCharger,
  LOSSES_RECORDED_KEY,
  RESOLVED_CHARGE_ERRORS,
  TERMINAL_CHARGE_ERRORS,
} from "./charger";
export type { ChargePassResult, ChargeTxSender, HedgeChargerOptions } from "./charger";
export { DESK_RECENT_ROWS, HedgeDeskWriter, parseBookRef } from "./desk";
export type { DeskInstrumentInfo } from "./desk";
export {
  HedgeFinalizeError,
  HedgeNotReconciledError,
  HedgingConfigError,
  HedgingRuntimeError,
  HedgingStoppedError,
  PositionEventsPendingError,
  UnknownOrderError,
} from "./errors";
export { orderIdPrefix, orderSeqOf } from "./ids";
export { DEFAULT_RUNTIME_RISK_PARAMS, loadRiskParams, policyParamsOf } from "./params";
export type { RiskParams } from "./params";
export { HedgingService } from "./service";
export type {
  BreakerStatus,
  FinalizeCampaign,
  HedgeBookSource,
  HedgeFinalizer,
  HedgingServiceOptions,
} from "./service";
export { PgPolicySink } from "./sink";
export type { FillRecorded, PgPolicySinkDeps } from "./sink";

export type StartHedgingOptions = HedgingServiceOptions;

export interface Hedging {
  /** Resolves once every loop and runner has stopped: the signal is aborted and nothing is in flight. */
  stopped: Promise<void>;
  /** For the settlement lane (`HedgeFinalizer`). */
  finalizer: HedgeFinalizer;
  /** For the sale-state evaluator: sales of an instrument stop while its breaker is active. */
  breakerStatus: (instrumentSymbol: string) => BreakerStatus;
}

/**
 * Starts the hedging engine (H-10, H-08): one policy runner per instrument with something to
 * hedge, fed by the book feed and the exposure ledger, against the configured execution venue;
 * orders and fills recorded with their allocation; hedge charges sent through the transaction
 * outbox; the reconciliation at sales close; the public Hedge desk. It never throws out of its
 * loops and leaves no timer running once the signal is aborted and `stopped` has resolved.
 *
 * Throws at once (`HedgingConfigError`, `VenueInputError`, `VenueNotAllowedError`) only for an
 * option it cannot run with: the sandbox venue without its client, or Gemini production.
 */
export function startHedging(options: StartHedgingOptions): Hedging {
  const service = new HedgingService(options);
  const stopped = service.run().catch((error: unknown) => {
    // `run` never rejects; this only guards against a bug in that guarantee.
    try {
      options.logger.error({ err: error }, "hedging stopped on an unexpected error");
    } catch {
      // Nothing left to report to.
    }
  });
  return {
    stopped,
    finalizer: { finalize: (campaign) => service.finalize(campaign) },
    breakerStatus: (instrumentSymbol) => service.breakerStatus(instrumentSymbol),
  };
}
