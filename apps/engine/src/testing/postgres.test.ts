import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "./postgres";

describe("test database", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });

  it("has the schema applied and returns bigint columns as bigint", async () => {
    const [job] = await database.db<{ id: string; attempts: number }[]>`
      insert into jobs (kind, payload) values ('probe', '{}'::jsonb) returning id, attempts
    `;
    expect(job?.attempts).toBe(0);

    const [row] = await database.db<{ value: bigint }[]>`select 20000000::bigint as value`;
    expect(row?.value).toBe(20_000_000n);
  });

  it("is isolated from other test databases", async () => {
    const other = await createTestDatabase();
    try {
      const [count] = await other.db<{ n: bigint }[]>`select count(*) as n from jobs`;
      expect(count?.n).toBe(0n);
    } finally {
      await other.drop();
    }
  });
});
