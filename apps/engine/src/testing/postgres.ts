import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { inject } from "vitest";

import { createDb, type Db } from "../db";
import { TEMPLATE_DATABASE } from "./pg-global-setup";

export interface TestDatabase {
  db: Db;
  url: string;
  /** Closes the connections and drops the database. Call it in `afterAll` / `afterEach`. */
  drop: () => Promise<void>;
}

/**
 * A fresh database with the full schema (every migration applied), isolated from other tests.
 * Cheap: it is cloned from a template prepared once per test run.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject("pgAdminUrl");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`create database ${name} template ${TEMPLATE_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const db = createDb(url, { max: 5 });
  return {
    db,
    url,
    drop: async (): Promise<void> => {
      await db.end({ timeout: 5 });
      const dropper = postgres(adminUrl, { max: 1, onnotice: () => undefined });
      try {
        await dropper.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
