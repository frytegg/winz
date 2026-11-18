import type { Db } from "../db";

/**
 * Test code only: a gate in the middle of a users write, for the tests of SPEC ID-1's races (the
 * engine's `resolveUserWallet` here, the web sign-in in apps/web/lib/server/auth-race.test.ts).
 *
 * A writer of the users table that does not take the e-mail's advisory lock can make a locked
 * write fail with a unique violation, and the writer must then read the row again and decide.
 * The real interleaving lasts microseconds (between the insert's check of its arbiter index and
 * its own index entries), too short to reach from a test on purpose. This wrapper reaches the same
 * point every time: once a statement or a transaction run through it has failed, the next
 * statement it runs first waits for `between()`, in which the test writes the row the way the
 * other writer would have. Every statement still runs on the real database.
 */
export function gateAfterFailedWrite(db: Db, between: () => Promise<void>): Db {
  let failed = false;
  let opened = false;

  async function afterFailure(): Promise<void> {
    if (!failed || opened) return;
    opened = true;
    await between();
  }

  const begin = async (...args: unknown[]): Promise<unknown> => {
    await afterFailure();
    try {
      return await (Reflect.apply(db.begin, db, args) as Promise<unknown>);
    } catch (error: unknown) {
      failed = true;
      throw error;
    }
  };

  return new Proxy(db, {
    get(target: Db, property: string | symbol, receiver: unknown): unknown {
      if (property === "begin") return begin;
      return Reflect.get(target, property, receiver) as unknown;
    },
    apply(target: Db, thisArg: unknown, args: unknown[]): unknown {
      const first: unknown = args[0];
      const isQuery = Array.isArray(first) && "raw" in first;
      // A helper call such as `db(values)` builds a fragment, it runs nothing.
      if (!isQuery) return Reflect.apply(target, thisArg, args) as unknown;
      return (async (): Promise<unknown> => {
        await afterFailure();
        try {
          // A query runs when it is awaited.
          return await (Reflect.apply(target, thisArg, args) as Promise<unknown>);
        } catch (error: unknown) {
          failed = true;
          throw error;
        }
      })();
    },
  });
}
