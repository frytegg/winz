/**
 * FIFO allocation of hedge fills to lots (SPEC 9.5, HE-4), pure: no I/O, no clock, no floats.
 *
 * Each sale creates a lot of `qty` micro-contracts with the `maxHedgeCost` its quote guaranteed.
 * Buy fills of an instrument cover that instrument's lots in `seq` order; each lot receives the
 * price and the fees of the contracts that covered it. A fully covered lot is charged
 * min(cost, maxHedgeCost); whatever is above the guarantee is the platform's loss.
 *
 * Contracts bought ahead of exposure (a fill larger than the open lots) are inventory: a queue of
 * pieces of fills, oldest first, which covers the next lots when they arrive. Sell fills (surplus
 * resold at reconciliation) take from the front of that queue; their proceeds belong to the
 * platform, never to a lot.
 *
 * Rounding. A fill costs `ceil(price × qty / 10 000) + fee` micro-USDC (`fillCost`).
 *
 * - A lot taking `q` of its `Q` contracts pays `ceil(fillCost × q / Q)`, capped by what the fill
 *   still has, except that the take which exhausts the fill gets exactly what is left
 *   (`takeFromPiece`). Each lot's take is recorded (`lot_fills`).
 * - Resales are not recorded take by take, only as the quantity sold, so their cost is a function
 *   of that quantity alone: the first `s` contracts sold from a fill cost `soldCost(s) =
 *   ceil(fillCost × s / Q)`, and a resale of `q` after `s` were sold costs `soldCost(s + q) −
 *   soldCost(s)` (`sellFromPiece`), however many resales came before. Capped, and exhausting, as
 *   a lot's take is.
 *
 * What is left of a fill therefore always costs `max(0, fillCost − (its lots' takes) −
 * soldCost(sold from it))`, whatever the order of the takes, which is how `rebuildInventory`
 * finds it from the tables: so the takes of one fill (lots, every resale on its own, the rest)
 * sum to its cost exactly, and nothing is created or lost by rounding.
 */
import { takerFeeBps } from "@winz/pricing";
import { BPS, mulDivDown, mulDivUp } from "@winz/shared";
import type { Bps, MicroContracts, MicroUsdc, OrderKind } from "@winz/shared";

import type { FillBookRef, OrderSide } from "../../venues/types";
import { AllocationInputError, AllocationStateError, InventoryUnderflowError } from "./errors";

/** A lot as the allocation sees it. `campaignId` says whose it is (one merchant per campaign). */
export interface AllocationLot {
  lotId: string;
  /** FIFO position (`lots.seq`). */
  seq: bigint;
  campaignId: string;
  qty: MicroContracts;
  filledQty: MicroContracts;
  /** Cost allocated so far, micro-USDC. */
  cost: MicroUsdc;
  maxHedgeCost: MicroUsdc;
}

/** One buy execution. */
export interface BuyFillInput {
  fillId: string;
  priceBps: Bps;
  qty: MicroContracts;
  /** Micro-USDC. */
  fee: MicroUsdc;
}

/** One sell execution (surplus resold). */
export type SellFillInput = BuyFillInput;

/** What is left of one buy fill, held ahead of exposure. */
export interface InventoryPiece {
  fillId: string;
  /** Quantity of the whole fill. */
  fillQty: MicroContracts;
  /** Cost of the whole fill (`fillCost`). */
  fillCost: MicroUsdc;
  /** Not allocated to a lot and not sold yet. */
  remainingQty: MicroContracts;
  /** Cost of `remainingQty`: the fill's cost minus every take so far. */
  remainingCost: MicroUsdc;
  /** Contracts of the fill resold so far (`sellFromPiece`); absent when none was. */
  soldQty?: MicroContracts;
}

/** Part of a fill that covered part of a lot. */
export interface LotAllocation {
  lotId: string;
  fillId: string;
  qty: MicroContracts;
  cost: MicroUsdc;
}

export interface AllocationResult {
  allocations: LotAllocation[];
  /** Every input lot, in the same order, with its new `filledQty` and `cost`. */
  lots: AllocationLot[];
  /** Ids of the lots this allocation completed (lots already complete before are not listed). */
  coveredLotIds: string[];
  /** Inventory still held ahead of exposure, oldest first. Empty unless every lot is covered. */
  inventory: InventoryPiece[];
}

/** What a lot owes once it is covered. */
export type LotCharge =
  | { status: "open"; missingQty: MicroContracts }
  | {
      status: "chargeable";
      /** min(cost, maxHedgeCost): what `chargeHedge` debits from the merchant's budget. */
      amount: MicroUsdc;
      /** max(0, cost − maxHedgeCost): absorbed by the platform (engine P&L). */
      guaranteeLoss: MicroUsdc;
      /** maxHedgeCost − amount: the part of the reservation that returns to the merchant. */
      merchantSaving: MicroUsdc;
    };

export interface SellResult {
  /** The pieces the sale took, oldest first. */
  consumed: { fillId: string; qty: MicroContracts; cost: MicroUsdc }[];
  inventory: InventoryPiece[];
  /** floor(price × qty / 10 000) − fee: what the sale brought in, micro-USDC (can be negative). */
  proceeds: bigint;
  /** What the sold contracts had cost. */
  costBasis: MicroUsdc;
  /**
   * proceeds − costBasis: the platform's result on the resale. With a `shortQty`, the cost of the
   * contracts sold beyond the inventory is not in it yet: the buys that replace them carry it, and
   * the store returns it with them (`replacedShort`) to be booked on the resales.
   */
  result: bigint;
  /** Contracts sold beyond the inventory (only with `allowShort`); 0 otherwise. */
  shortQty: MicroContracts;
}

function assertNonNegative(what: string, value: bigint): void {
  if (value < 0n)
    throw new AllocationInputError(`${what} must not be negative, got ${value.toString()}`);
}

function assertPrice(what: string, priceBps: Bps): void {
  if (priceBps < 0n || priceBps > BPS) {
    throw new AllocationInputError(
      `${what} must be between 0 and 10000 bps, got ${priceBps.toString()}`,
    );
  }
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function validateFill(fill: BuyFillInput): void {
  if (fill.fillId === "") throw new AllocationInputError("fill id is empty");
  assertPrice(`fill ${fill.fillId} price`, fill.priceBps);
  // A fill of zero contracts would carry its fee nowhere: no lot and no inventory could hold it.
  if (fill.qty <= 0n) {
    throw new AllocationInputError(
      `fill ${fill.fillId} qty must be positive, got ${fill.qty.toString()}`,
    );
  }
  assertNonNegative(`fill ${fill.fillId} fee`, fill.fee);
}

function validateLots(lots: readonly AllocationLot[]): void {
  const ids = new Set<string>();
  let previous: bigint | null = null;
  for (const lot of lots) {
    if (ids.has(lot.lotId)) throw new AllocationInputError(`lot ${lot.lotId} is listed twice`);
    ids.add(lot.lotId);
    if (previous !== null && lot.seq <= previous) {
      throw new AllocationInputError(
        `lots must be in strictly increasing seq order (FIFO): ${lot.seq.toString()} after ${previous.toString()}`,
      );
    }
    previous = lot.seq;
    assertNonNegative(`lot ${lot.lotId} qty`, lot.qty);
    assertNonNegative(`lot ${lot.lotId} filledQty`, lot.filledQty);
    assertNonNegative(`lot ${lot.lotId} cost`, lot.cost);
    assertNonNegative(`lot ${lot.lotId} maxHedgeCost`, lot.maxHedgeCost);
    if (lot.filledQty > lot.qty) {
      throw new AllocationInputError(`lot ${lot.lotId} is filled beyond its quantity`);
    }
  }
}

function validatePiece(piece: InventoryPiece): void {
  assertNonNegative(`piece ${piece.fillId} fillQty`, piece.fillQty);
  assertNonNegative(`piece ${piece.fillId} fillCost`, piece.fillCost);
  assertNonNegative(`piece ${piece.fillId} remainingQty`, piece.remainingQty);
  assertNonNegative(`piece ${piece.fillId} remainingCost`, piece.remainingCost);
  if (piece.remainingQty > piece.fillQty || piece.remainingCost > piece.fillCost) {
    throw new AllocationInputError(`piece ${piece.fillId} has more left than the whole fill`);
  }
  const sold = piece.soldQty ?? 0n;
  assertNonNegative(`piece ${piece.fillId} soldQty`, sold);
  if (sold + piece.remainingQty > piece.fillQty) {
    throw new AllocationInputError(`piece ${piece.fillId} has sold more than the fill gave`);
  }
}

/** Notional of a fill rounded up, plus its fee: what the fill really cost, micro-USDC. */
export function fillCost(priceBps: Bps, qty: MicroContracts, fee: MicroUsdc): MicroUsdc {
  assertPrice("price", priceBps);
  assertNonNegative("qty", qty);
  assertNonNegative("fee", fee);
  return mulDivUp(priceBps, qty, BPS) + fee;
}

/** A whole buy fill as an inventory piece, nothing taken from it yet. */
export function inventoryPiece(fill: BuyFillInput): InventoryPiece {
  validateFill(fill);
  const cost = fillCost(fill.priceBps, fill.qty, fill.fee);
  return {
    fillId: fill.fillId,
    fillQty: fill.qty,
    fillCost: cost,
    remainingQty: fill.qty,
    remainingCost: cost,
  };
}

/**
 * What the first `sold` contracts resold from a fill of `fillQty` cost: their share of `fillCost`,
 * rounded up, and the whole cost from `fillQty` on. Never decreasing in `sold`.
 */
export function soldCost(
  fillCost: MicroUsdc,
  fillQty: MicroContracts,
  sold: MicroContracts,
): MicroUsdc {
  assertNonNegative("fill cost", fillCost);
  assertNonNegative("sold qty", sold);
  if (sold >= fillQty) return fillCost;
  return mulDivUp(fillCost, sold, fillQty);
}

/**
 * A lot takes `qty` contracts from a piece. The take that exhausts the piece gets its whole
 * remaining cost; any other take costs its share of the whole fill rounded up, capped by what is
 * left.
 */
export function takeFromPiece(
  piece: InventoryPiece,
  qty: MicroContracts,
): { cost: MicroUsdc; piece: InventoryPiece } {
  validatePiece(piece);
  if (qty <= 0n || qty > piece.remainingQty) {
    throw new AllocationInputError(
      `cannot take ${qty.toString()} from fill ${piece.fillId}, which has ${piece.remainingQty.toString()} left`,
    );
  }
  const cost =
    qty === piece.remainingQty
      ? piece.remainingCost
      : minBig(mulDivUp(piece.fillCost, qty, piece.fillQty), piece.remainingCost);
  return {
    cost,
    piece: {
      ...piece,
      remainingQty: piece.remainingQty - qty,
      remainingCost: piece.remainingCost - cost,
    },
  };
}

/**
 * A resale takes `qty` contracts from a piece: `soldCost` of everything sold from the fill once it
 * is done, minus that of what was sold before (`piece.soldQty`), so that a fill's resales cost
 * the same in all however many there were. The take that exhausts the piece gets its whole
 * remaining cost; any other take is capped by it.
 */
export function sellFromPiece(
  piece: InventoryPiece,
  qty: MicroContracts,
): { cost: MicroUsdc; piece: InventoryPiece } {
  validatePiece(piece);
  if (qty <= 0n || qty > piece.remainingQty) {
    throw new AllocationInputError(
      `cannot sell ${qty.toString()} from fill ${piece.fillId}, which has ${piece.remainingQty.toString()} left`,
    );
  }
  const before = piece.soldQty ?? 0n;
  const cost =
    qty === piece.remainingQty
      ? piece.remainingCost
      : minBig(
          soldCost(piece.fillCost, piece.fillQty, before + qty) -
            soldCost(piece.fillCost, piece.fillQty, before),
          piece.remainingCost,
        );
  return {
    cost,
    piece: {
      ...piece,
      remainingQty: piece.remainingQty - qty,
      remainingCost: piece.remainingCost - cost,
      soldQty: before + qty,
    },
  };
}

/** A recorded buy fill and what lots took from it, as the database holds them. */
export interface HeldFill {
  fillId: string;
  fillQty: MicroContracts;
  fillCost: MicroUsdc;
  /** Sum of `lot_fills.qty` of this fill. */
  allocatedQty: MicroContracts;
  /** Sum of `lot_fills.cost` of this fill. */
  allocatedCost: MicroUsdc;
}

/** The inventory of an instrument as `rebuildInventory` finds it. */
export interface RebuiltInventory {
  /** What is held ahead of exposure, oldest first. */
  pieces: InventoryPiece[];
  /**
   * Contracts sold on the venue beyond everything that was held unallocated (an over-sale): the
   * venue position is that much below what the lots were allocated. The next buy fills replace
   * them first, at the platform's cost, before they cover any lot. 0 in a sound state.
   */
  shortQty: MicroContracts;
}

/**
 * The inventory held ahead of exposure, rebuilt from what the database records: every buy fill of
 * the instrument in the order it was recorded, minus what lots took from it, minus everything
 * sold, taken from the front.
 *
 * Lots and sales both take from the front of the same queue, and new buy fills join at its end,
 * so whatever was consumed is a prefix of the queue: the parts lots took are in `lot_fills`, and
 * the parts sales took are the first `soldQty` contracts of what lots left. The suffix that
 * remains is therefore known exactly in quantity, and so is what was sold from each fill. Its
 * cost is each fill's cost minus what its lots took (`lot_fills`) minus `soldCost` of what was
 * sold from it, never below zero: exactly what the resales left, however many there were and in
 * whatever order they and the lots took (see the module comment). So the costs allocated to lots,
 * the cost bases the resales returned and the inventory's cost always add up to the fills' cost,
 * to the micro-USDC.
 *
 * When more was sold than lots left (a real over-sale on the venue), the whole queue is consumed
 * and the excess comes back as `shortQty`: buy fills recorded later are taken by it first, which
 * is how they replace the contracts sold out from under covered lots.
 */
export function rebuildInventory(
  instrument: string,
  fills: readonly HeldFill[],
  soldQty: MicroContracts,
): RebuiltInventory {
  assertNonNegative("sold qty", soldQty);
  const unallocated: { fill: HeldFill; remainingQty: MicroContracts }[] = [];
  for (const fill of fills) {
    const remainingQty = fill.fillQty - fill.allocatedQty;
    const remainingCost = fill.fillCost - fill.allocatedCost;
    if (remainingQty < 0n || remainingCost < 0n) {
      throw new AllocationStateError(
        `${instrument}: fill ${fill.fillId} is allocated beyond its quantity or cost`,
      );
    }
    if (remainingQty === 0n) {
      if (remainingCost !== 0n) {
        throw new AllocationStateError(
          `${instrument}: fill ${fill.fillId} is fully allocated but ${remainingCost.toString()} of its cost is not`,
        );
      }
      continue;
    }
    unallocated.push({ fill, remainingQty });
  }
  const available = unallocated.reduce((total, item) => total + item.remainingQty, 0n);
  if (soldQty >= available) return { pieces: [], shortQty: soldQty - available };
  const pieces: InventoryPiece[] = [];
  let toSell = soldQty;
  for (const { fill, remainingQty: unallocatedQty } of unallocated) {
    const sold = minBig(toSell, unallocatedQty);
    toSell -= sold;
    const remainingQty = unallocatedQty - sold;
    if (remainingQty === 0n) continue;
    const remainingCost =
      fill.fillCost - fill.allocatedCost - soldCost(fill.fillCost, fill.fillQty, sold);
    const piece: InventoryPiece = {
      fillId: fill.fillId,
      fillQty: fill.fillQty,
      fillCost: fill.fillCost,
      remainingQty,
      remainingCost: remainingCost > 0n ? remainingCost : 0n,
      ...(sold > 0n ? { soldQty: sold } : {}),
    };
    validatePiece(piece);
    pieces.push(piece);
  }
  return { pieces, shortQty: 0n };
}

/**
 * `rebuildInventory` for a state that must be sound: throws `AllocationStateError` when more was
 * sold than was ever held unallocated.
 */
export function heldInventory(
  instrument: string,
  fills: readonly HeldFill[],
  soldQty: MicroContracts,
): InventoryPiece[] {
  const rebuilt = rebuildInventory(instrument, fills, soldQty);
  if (rebuilt.shortQty > 0n) {
    throw new AllocationStateError(
      `${instrument}: ${soldQty.toString()} micro-contracts were sold but only ` +
        `${(soldQty - rebuilt.shortQty).toString()} were held`,
    );
  }
  return rebuilt.pieces;
}

/** Quantity and cost of an inventory. */
export function inventoryTotals(inventory: readonly InventoryPiece[]): {
  qty: MicroContracts;
  cost: MicroUsdc;
} {
  let qty = 0n;
  let cost = 0n;
  for (const piece of inventory) {
    qty += piece.remainingQty;
    cost += piece.remainingCost;
  }
  return { qty, cost };
}

/**
 * Covers open lots, in `seq` order, with inventory pieces, oldest first. Lots already covered
 * (including lots of zero quantity) are passed through untouched. Inventory left once every lot
 * is covered is returned.
 */
export function allocateInventory(
  openLots: readonly AllocationLot[],
  inventory: readonly InventoryPiece[],
): AllocationResult {
  validateLots(openLots);
  inventory.forEach(validatePiece);
  const lots = openLots.map((lot) => ({ ...lot }));
  const pieces = inventory
    .filter((piece) => piece.remainingQty > 0n)
    .map((piece) => ({ ...piece }));
  const allocations: LotAllocation[] = [];
  const coveredLotIds: string[] = [];

  let pieceIndex = 0;
  for (const lot of lots) {
    if (lot.filledQty === lot.qty) continue;
    while (lot.filledQty < lot.qty && pieceIndex < pieces.length) {
      const piece = pieces[pieceIndex];
      if (piece === undefined) break;
      const qty = minBig(lot.qty - lot.filledQty, piece.remainingQty);
      const taken = takeFromPiece(piece, qty);
      pieces[pieceIndex] = taken.piece;
      lot.filledQty += qty;
      lot.cost += taken.cost;
      allocations.push({ lotId: lot.lotId, fillId: piece.fillId, qty, cost: taken.cost });
      if (taken.piece.remainingQty === 0n) pieceIndex += 1;
    }
    if (lot.filledQty === lot.qty) coveredLotIds.push(lot.lotId);
    else break; // Inventory exhausted: later lots stay open, FIFO.
  }
  return {
    allocations,
    lots,
    coveredLotIds,
    inventory: pieces.slice(pieceIndex).filter((piece) => piece.remainingQty > 0n),
  };
}

/**
 * Splits one buy fill across the open lots in FIFO order. What the lots cannot absorb comes back
 * in `inventory`, to be allocated to the next lots when they arrive (`allocateInventory`).
 */
export function allocateFill(
  openLots: readonly AllocationLot[],
  fill: BuyFillInput,
): AllocationResult {
  return allocateInventory(openLots, [inventoryPiece(fill)]);
}

/**
 * The charge of a lot: nothing while it is not fully covered; once covered, min(cost,
 * maxHedgeCost), and the guarantee loss above it. A lot of zero quantity is covered from the
 * start and charged 0, which only releases its reservation.
 */
export function chargeForLot(
  lot: Pick<AllocationLot, "qty" | "filledQty" | "cost" | "maxHedgeCost">,
): LotCharge {
  assertNonNegative("lot qty", lot.qty);
  assertNonNegative("lot filledQty", lot.filledQty);
  assertNonNegative("lot cost", lot.cost);
  assertNonNegative("lot maxHedgeCost", lot.maxHedgeCost);
  if (lot.filledQty > lot.qty) throw new AllocationInputError("lot filled beyond its quantity");
  if (lot.filledQty < lot.qty) return { status: "open", missingQty: lot.qty - lot.filledQty };
  const amount = minBig(lot.cost, lot.maxHedgeCost);
  return {
    status: "chargeable",
    amount,
    guaranteeLoss: lot.cost - amount,
    merchantSaving: lot.maxHedgeCost - amount,
  };
}

/** What a buy of `qty` at `priceBps` costs a taker, fee included, micro-USDC. */
export function takerCost(priceBps: Bps, qty: MicroContracts): MicroUsdc {
  return fillCost(priceBps, qty, mulDivUp(qty, takerFeeBps(priceBps), BPS));
}

/** The best ask a fill's book reference recorded, or null when it recorded none. */
export function bestAskOf(bookRef: FillBookRef | null): Bps | null {
  if (bookRef === null || bookRef.source !== "book" || bookRef.bookSide !== "asks") return null;
  let best: Bps | null = null;
  for (const level of bookRef.levels) {
    if (best === null || level.priceBps < best) best = level.priceBps;
  }
  return best;
}

export interface SavingFillInput {
  side: OrderSide;
  kind: OrderKind;
  priceBps: Bps;
  qty: MicroContracts;
  fee: MicroUsdc;
  bookRef: FillBookRef | null;
}

/**
 * Maker saving of a fill (shown on the Hedge desk): what the same quantity would have cost a
 * taker at the best ask its book reference recorded, minus what it cost, floored at zero. Zero for
 * a sell, and for a fill whose reference recorded no ask (a maker fill on a public trade print).
 */
export function makerSaving(fill: SavingFillInput): MicroUsdc {
  if (fill.side !== "buy") return 0n;
  const ask = bestAskOf(fill.bookRef);
  if (ask === null) return 0n;
  const saving = takerCost(ask, fill.qty) - fillCost(fill.priceBps, fill.qty, fill.fee);
  return saving > 0n ? saving : 0n;
}

export interface SellOptions {
  /**
   * False (the default): selling more than the inventory throws `InventoryUnderflowError`. True:
   * the sale is a real execution that must be recorded anyway; it sells everything held and
   * returns the excess as `shortQty`, without touching any lot.
   */
  allowShort?: boolean;
}

/**
 * Sells `fill.qty` contracts from the front of the inventory. Throws `InventoryUnderflowError`
 * when the inventory holds fewer, unless `allowShort`: then the excess comes back as `shortQty`
 * and its cost basis is not known yet (the buys that replace it will carry it).
 */
export function sellFromInventory(
  instrument: string,
  inventory: readonly InventoryPiece[],
  fill: SellFillInput,
  options: SellOptions = {},
): SellResult {
  validateFill(fill);
  inventory.forEach(validatePiece);
  const available = inventory.reduce((total, piece) => total + piece.remainingQty, 0n);
  if (fill.qty > available && options.allowShort !== true) {
    throw new InventoryUnderflowError(instrument, fill.qty, available);
  }
  const pieces = inventory
    .filter((piece) => piece.remainingQty > 0n)
    .map((piece) => ({ ...piece }));
  const consumed: SellResult["consumed"] = [];
  let toSell = minBig(fill.qty, available);
  let costBasis = 0n;
  let index = 0;
  while (toSell > 0n) {
    const piece = pieces[index];
    if (piece === undefined) throw new InventoryUnderflowError(instrument, fill.qty, available);
    const qty = minBig(toSell, piece.remainingQty);
    const taken = sellFromPiece(piece, qty);
    pieces[index] = taken.piece;
    consumed.push({ fillId: piece.fillId, qty, cost: taken.cost });
    costBasis += taken.cost;
    toSell -= qty;
    if (taken.piece.remainingQty === 0n) index += 1;
  }
  const proceeds = mulDivDown(fill.priceBps, fill.qty, BPS) - fill.fee;
  return {
    consumed,
    inventory: pieces.slice(index).filter((piece) => piece.remainingQty > 0n),
    proceeds,
    costBasis,
    result: proceeds - costBasis,
    shortQty: fill.qty > available ? fill.qty - available : 0n,
  };
}
