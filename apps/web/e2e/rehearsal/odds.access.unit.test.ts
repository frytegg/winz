import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../../../engine/src/db";
import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import { liveRowSource } from "./odds";

// The row of the ticket's odds is read as the page reads it: through the anonymous role and the
// table's public policy. Positive and negative controls, and the fallback when the role cannot
// be taken.
describe("the live odds row read as the anonymous role", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db`
      insert into live_instruments (symbol, bid_bps, ask_bps, mid_bps, stale)
      values ('ODDS-ACCESS-X', 4000, 4200, 4100, false)
    `;
  });
  afterAll(async () => {
    await database.drop();
  });

  it("shows the mid, and says it read as the anonymous role", async () => {
    const { source, access } = await liveRowSource(database.db, "ODDS-ACCESS-X");
    expect(access).toMatch(/^read as the anonymous role/);
    expect((await source.read()).valueBps).toBe(4100);
  });

  it("fails without the anonymous role's grant: the read really goes through that role", async () => {
    await database.db`revoke select on live_instruments from anon`;
    try {
      const { source } = await liveRowSource(database.db, "ODDS-ACCESS-X");
      await expect(source.read()).rejects.toThrow(/permission denied/);
    } finally {
      await database.db`grant select on live_instruments to anon`;
    }
  });

  it("sees no row without the public policy", async () => {
    await database.db`drop policy live_instruments_public_read on live_instruments`;
    const { source } = await liveRowSource(database.db, "ODDS-ACCESS-X");
    expect((await source.read()).valueBps).toBeNull();
  });

  it("reads with its own connection, and says so, when it may not take the anonymous role", async () => {
    const role = `odds_access_${randomBytes(4).toString("hex")}`;
    await database.db.unsafe(`create role ${role} login password 'x'`);
    const url = database.url.replace(/\/\/[^@]*@/, `//${role}:x@`);
    const other = createDb(url, { max: 1 });
    try {
      const { access } = await liveRowSource(other, "ODDS-ACCESS-X");
      expect(access).toMatch(/^read with the runner's own connection/);
    } finally {
      await other.end({ timeout: 5 });
      await database.db.unsafe(`drop role ${role}`);
    }
  });
});
