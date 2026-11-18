/**
 * The version of a read of the exposure ledger (`HedgeInstrumentRow.asOf`, `RestoreState.asOf`):
 * a read that sees a later commit has a higher version, and a read that sees nothing new has the
 * same or a higher one; never a lower one. Real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { createMarket } from "../allocation/test-support";
import { getHedgeInstrument, loadRestoreState } from "./store";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database?.drop();
});

async function asOf(instrument: string): Promise<bigint> {
  const row = await getHedgeInstrument(database.db, instrument);
  if (row === null) throw new Error("no row");
  return row.asOf;
}

describe("the version of an exposure read", () => {
  it("grows with every commit the read sees, and never goes back", async () => {
    const market = await createMarket(database.db);
    await database.db`insert into positions (instrument, exposure) values (${market.instrument}, 5)`;
    const first = await asOf(market.instrument);
    expect(await asOf(market.instrument)).toBeGreaterThanOrEqual(first);
    await database.db`update positions set exposure = 7 where instrument = ${market.instrument}`;
    const second = await asOf(market.instrument);
    expect(second).toBeGreaterThan(first);
    const restore = await loadRestoreState(database.db, market.instrument, "paper", "wz.x");
    expect(restore.exposure).toBe(7n);
    expect(restore.asOf).toBeGreaterThanOrEqual(second);
  });

  it("a transaction still open when a read starts keeps that read below one taken after it commits", async () => {
    const market = await createMarket(database.db);
    await database.db`insert into positions (instrument, exposure) values (${market.instrument}, 5)`;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written: () => void = () => undefined;
    const wrote = new Promise<void>((resolve) => {
      written = resolve;
    });
    const writer = database.db.begin(async (tx) => {
      await tx`update positions set exposure = 9 where instrument = ${market.instrument}`;
      written();
      await held;
    });
    await wrote;
    // Read while the write is in progress: it does not see it.
    const during = await getHedgeInstrument(database.db, market.instrument);
    release();
    await writer;
    const after = await getHedgeInstrument(database.db, market.instrument);
    expect(during?.exposure).toBe(5n);
    expect(after?.exposure).toBe(9n);
    expect(after?.asOf ?? 0n).toBeGreaterThan(during?.asOf ?? 0n);
  });
});
