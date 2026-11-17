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

/** Raised by `startSaleStates` for an option that makes no sense (a non-positive interval). */
export class SaleStateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleStateConfigError";
  }
}
