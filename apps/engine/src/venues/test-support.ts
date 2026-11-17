import type { Book, BookLevel, Bps, MicroContracts } from "@winz/shared";
import pino from "pino";
import type { Logger } from "pino";
import { expect } from "vitest";

import { PaperVenue } from "./paper-venue";
import type { PaperVenueConfig } from "./paper-venue";
import { replayFill } from "./replay";
import type { VenueClock, VenueEvent, VenueFill } from "./types";

/** Contracts → micro-contracts, for readable tests: `c(1.5)` is 1 500 000n. */
export function c(contracts: number): MicroContracts {
  return BigInt(Math.round(contracts * 100)) * 10_000n;
}

export function level(priceBps: number, contracts: number): BookLevel {
  return { priceBps: BigInt(priceBps), qty: c(contracts) };
}

export function makeBook(
  instrumentSymbol: string,
  observedAtMs: number,
  bids: readonly BookLevel[],
  asks: readonly BookLevel[],
): Book {
  return { instrumentSymbol, observedAtMs, bids, asks };
}

export class FakeClock implements VenueClock {
  constructor(public ms: number) {}

  now(): Date {
    return new Date(this.ms);
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}

export function silentLogger(): Logger {
  return pino({ level: "silent" });
}

export interface Harness {
  venue: PaperVenue;
  clock: FakeClock;
  events: VenueEvent[];
  fills: VenueFill[];
}

export function harness(config?: Partial<PaperVenueConfig>, startMs = 1_000_000): Harness {
  const clock = new FakeClock(startMs);
  const venue = new PaperVenue({
    clock,
    logger: silentLogger(),
    ...(config === undefined ? {} : { config }),
  });
  const events: VenueEvent[] = [];
  const fills: VenueFill[] = [];
  venue.onEvent((event) => {
    events.push(event);
    if (event.type === "fill") fills.push(event.fill);
  });
  return { venue, clock, events, fills };
}

/** Every fill must be reproduced exactly from its book reference alone. */
export function expectReplayable(fills: readonly VenueFill[]): void {
  for (const fill of fills) {
    const replayed = replayFill(fill);
    expect(replayed, `replay of ${fill.fillId}`).toEqual({
      priceBps: fill.priceBps,
      qty: fill.qty,
      fee: fill.fee,
    });
  }
}

export function bps(value: number): Bps {
  return BigInt(value);
}
