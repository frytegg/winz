import postgres, { type Sql } from "postgres";

export type Db = Sql;

/**
 * Postgres client of the engine. `bigint` columns (money, quantities, on-chain ids) come back as
 * JavaScript `bigint`, never as `number`. Prepared statements are off so the client also works
 * through Supabase's transaction pooler.
 */
export function createDb(url: string, options: { max?: number } = {}): Db {
  return postgres(url, {
    max: options.max ?? 10,
    prepare: false,
    types: { bigint: postgres.BigInt },
    onnotice: () => undefined,
  });
}
