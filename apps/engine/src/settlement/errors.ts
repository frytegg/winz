/** Base class of the errors raised by the settlement watcher. */
export class SettlementError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SettlementError";
  }
}

/** A setting of `startSettlement` is out of range. */
export class SettlementConfigError extends SettlementError {
  constructor(message: string) {
    super(message);
    this.name = "SettlementConfigError";
  }
}

/** The watcher is stopping: the sequence of a campaign was left where it was, to resume later. */
export class SettlementAbortedError extends SettlementError {
  constructor() {
    super("settlement stopped before the sequence finished");
    this.name = "SettlementAbortedError";
  }
}

/** A step of one campaign's sequence threw: wraps the cause with where it happened. */
export class SettlementStepError extends SettlementError {
  constructor(
    readonly campaignId: string,
    readonly onchainId: bigint,
    readonly step: string,
    cause: unknown,
  ) {
    super(`settlement of campaign ${onchainId.toString()} failed at step ${step}`, { cause });
    this.name = "SettlementStepError";
  }
}

/** `settleCampaignNow` was given an id that is not a campaign. */
export class CampaignNotFoundError extends SettlementError {
  constructor(readonly campaignId: string) {
    super(`campaign ${campaignId} does not exist`);
    this.name = "CampaignNotFoundError";
  }
}

/** The escrow answered a read with something that is not what its ABI says. */
export class EscrowReadError extends SettlementError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EscrowReadError";
  }
}

/** The hedge finalizer did not answer in time: counted as a failure of the finalizer. */
export class FinalizeTimeoutError extends SettlementError {
  constructor(
    readonly campaignId: string,
    readonly timeoutMs: number,
  ) {
    super(
      `the hedge finalizer did not answer within ${timeoutMs.toString()} ms for campaign ${campaignId}`,
    );
    this.name = "FinalizeTimeoutError";
  }
}
