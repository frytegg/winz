/**
 * The version of a read of the exposure ledger (`HedgeInstrumentRow.asOf`, `RestoreState.asOf`):
 * a read that sees a later commit has a higher version, and a read that sees nothing new has the
 * same or a higher one; never a lower one. Real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../testing/postgres";
import { createMarket } from "../allocation/test-support";
import { getHedgeInstrument, loadRestoreState, type HedgeInstrumentRow } from "./store";

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

  it("a writer older than a commit the read sees, still open at the read: its own commit raises the version", async () => {
    const market = await createMarket(database.db);
    const other = await createMarket(database.db);
    await database.db`insert into positions (instrument, exposure) values (${market.instrument}, 5)`;
    await database.db`insert into positions (instrument, exposure) values (${other.instrument}, 1)`;

    // One Postgres serves every test file of the run, so a transaction id assigned elsewhere
    // between two reads raises the second one's xmax, and that alone orders them. Each read is
    // therefore taken with the snapshot it was computed from (one repeatable-read transaction), so
    // that every version is checked against its own snapshot whatever else runs; and the sequence
    // is repeated until one run had nothing else move xmax between the two reads, where only the
    // term of the transactions in progress can tell them apart.
    let decisive = 0;
    for (let attempt = 1; attempt <= 100 && decisive === 0; attempt += 1) {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let written: (xid: string) => void = () => undefined;
      const wrote = new Promise<string>((resolve) => {
        written = resolve;
      });
      // The writer gets its transaction id first: it is the OLDER transaction.
      const writer = database.db.begin(async (tx) => {
        await tx`update positions set exposure = exposure + 1 where instrument = ${market.instrument}`;
        const [row] = await tx<{ xid: string }[]>`select pg_current_xact_id()::text as xid`;
        written(row?.xid ?? "");
        await held;
      });
      try {
        const writerXid = await wrote;
        // A younger transaction commits while the writer is still open.
        await database.db`update positions set exposure = exposure + 1 where instrument = ${other.instrument}`;
        const during = await versionedRead(market.instrument);
        release();
        await writer;
        const after = await versionedRead(market.instrument);
        const again = await versionedRead(market.instrument);

        // The read during the write saw the younger commit and not the writer's, which it saw in
        // progress; the read after saw it committed.
        expect(during.row.exposure).toBe(4n + BigInt(attempt));
        expect(after.row.exposure).toBe(5n + BigInt(attempt));
        expect(during.snapshot.xip).toContain(writerXid);
        expect(after.snapshot.xip).not.toContain(writerXid);
        // Each version is its own snapshot's: xmax × 2^32 minus the transactions in progress.
        for (const read of [during, after, again]) {
          expect(read.row.asOf).toBe(
            read.snapshot.xmax * 4_294_967_296n - BigInt(read.snapshot.xip.length),
          );
        }
        // The later read is newer, and a read that sees the same data again has the same version.
        expect(after.row.asOf).toBeGreaterThan(during.row.asOf);
        expect(again.row.asOf).toBeGreaterThanOrEqual(after.row.asOf);
        if (again.snapshot.text === after.snapshot.text) {
          expect(again.row.asOf).toBe(after.row.asOf);
        }
        // Nothing assigned a transaction id between the two reads: the writer's commit alone made
        // the second read newer.
        if (during.snapshot.xmax === after.snapshot.xmax) decisive += 1;
      } finally {
        release();
        await writer.catch(() => undefined);
      }
    }
    expect(decisive).toBe(1);
  });
});

interface ReadSnapshot {
  text: string;
  xmax: bigint;
  xip: string[];
}

/** A read of an instrument and the snapshot it was computed from, in one repeatable-read transaction. */
async function versionedRead(
  instrument: string,
): Promise<{ row: HedgeInstrumentRow; snapshot: ReadSnapshot }> {
  const [row, text] = await database.db.begin(
    "isolation level repeatable read",
    async (tx): Promise<[HedgeInstrumentRow | null, string]> => {
      const [snapshot] = await tx<{ s: string }[]>`select pg_current_snapshot()::text as s`;
      return [await getHedgeInstrument(tx, instrument), snapshot?.s ?? ""];
    },
  );
  if (row === null) throw new Error(`no row for ${instrument}`);
  const [, xmax = "0", xip = ""] = text.split(":");
  return {
    row,
    snapshot: { text, xmax: BigInt(xmax), xip: xip === "" ? [] : xip.split(",") },
  };
}
