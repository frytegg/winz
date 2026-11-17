/** Base class of everything the cost allocation (SPEC 9.5) throws on purpose. */
export class AllocationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AllocationError";
  }
}

/**
 * The caller passed something the allocation cannot trust: lots out of FIFO order, a negative
 * quantity, a lot filled beyond its quantity, a price outside 0..10 000 bps. A programming error.
 */
export class AllocationInputError extends AllocationError {
  constructor(message: string) {
    super(message);
    this.name = "AllocationInputError";
  }
}

/**
 * A sell fill for more contracts than the inventory held ahead of exposure. Selling would take
 * contracts that already cover a merchant's lot: the books and the venue disagree, and someone
 * must look before anything else is recorded on the instrument.
 */
export class InventoryUnderflowError extends AllocationError {
  constructor(
    readonly instrument: string,
    readonly requestedQty: bigint,
    readonly availableQty: bigint,
  ) {
    super(
      `${instrument}: selling ${requestedQty.toString()} micro-contracts but only ` +
        `${availableQty.toString()} are held ahead of exposure`,
    );
    this.name = "InventoryUnderflowError";
  }
}

/** The fill does not match the order row it claims to belong to, or the order does not exist. */
export class FillOrderMismatchError extends AllocationError {
  constructor(message: string) {
    super(message);
    this.name = "FillOrderMismatchError";
  }
}

/**
 * What the database holds cannot be right: a fill allocated beyond its quantity or its cost, more
 * contracts sold than were ever held. Nothing more is recorded on the instrument until someone
 * looks.
 */
export class AllocationStateError extends AllocationError {
  constructor(message: string) {
    super(message);
    this.name = "AllocationStateError";
  }
}

/** A venue fill id recorded before with a different price, quantity, fee or side. */
export class FillConflictError extends AllocationError {
  constructor(
    readonly venueFillId: string,
    message: string,
  ) {
    super(`fill ${venueFillId}: ${message}`);
    this.name = "FillConflictError";
  }
}
