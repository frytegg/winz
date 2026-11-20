/** Raised when a campaign row read for the sale state does not have the expected shape. */
export class SaleStateRowError extends Error {
  constructor(
    public readonly campaignId: string,
    public readonly issues: readonly string[],
  ) {
    super(`campaign ${campaignId} cannot be evaluated: ${issues[0] ?? "unknown"}`);
    this.name = "SaleStateRowError";
  }
}

/**
 * A sale state pass ended before it finished: it ran past `passTimeoutMs` (`reason` "timeout"),
 * or the service stopped while it ran ("stopping"). `waitingOn` says what the pass was waiting
 * for at that moment (the read of the campaigns, or the write of one campaign's sale state).
 */
export class SaleStatePassAbortedError extends Error {
  constructor(
    public readonly reason: "timeout" | "stopping",
    public readonly waitingOn: string | null,
    public readonly timeoutMs: number,
  ) {
    super(
      reason === "timeout"
        ? `sale state pass did not end within ${timeoutMs.toString()} ms (waiting on: ${waitingOn ?? "nothing"})`
        : "sale state pass ended: the service is stopping",
    );
    this.name = "SaleStatePassAbortedError";
  }
}

/** Raised by `startSaleStates` for an option that makes no sense (a non-positive interval). */
export class SaleStateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleStateConfigError";
  }
}
