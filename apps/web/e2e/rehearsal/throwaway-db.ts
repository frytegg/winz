import { randomBytes } from "node:crypto";

import postgres from "postgres";
import type { TestProject } from "vitest/node";

import setupPostgres, { TEMPLATE_DATABASE } from "../../../engine/src/testing/pg-global-setup";

/**
 * A throwaway Postgres for a rehearsal on a machine without a hosted database: the engine's test
 * helper starts a local server with every migration applied to a template, and one database is
 * cloned from it. `drop` removes the database and stops the server.
 */
export interface ThrowawayDatabase {
  url: string;
  drop: () => Promise<void>;
  /** Where the server keeps its files, for whoever recovers a stranded campaign from it. */
  dataDirectory: () => Promise<string>;
}

/**
 * Whether the command must keep the throwaway database instead of dropping it: the run ended with
 * its campaign unreleased on-chain, and this database is the only one that knows that campaign.
 */
export function keepsThrowawayDatabase(receipt: { stranded: boolean }): boolean {
  return receipt.stranded;
}

export async function createThrowawayDatabase(): Promise<ThrowawayDatabase> {
  let adminUrl: string | null = null;
  // The helper is Vitest's global setup: it hands its admin URL over through `provide`.
  const project = {
    provide: (key: string, value: unknown): void => {
      if (key === "pgAdminUrl" && typeof value === "string") adminUrl = value;
    },
  } as unknown as TestProject;
  const stopServer = await setupPostgres(project);
  const admin = adminUrl as string | null;
  if (admin === null) {
    await stopServer();
    throw new Error("the Postgres helper did not provide its admin URL");
  }
  const name = `rehearsal_${randomBytes(6).toString("hex")}`;
  const sql = postgres(admin, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(`create database ${name} template ${TEMPLATE_DATABASE}`);
  } catch (error: unknown) {
    await sql.end();
    await stopServer();
    throw error;
  }
  await sql.end();
  const url = admin.replace(/\/postgres$/, `/${name}`);
  return {
    url,
    dataDirectory: async (): Promise<string> => {
      const reader = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        const [row] = await reader<{ data_directory: string }[]>`show data_directory`;
        return row?.data_directory ?? "unknown";
      } finally {
        await reader.end();
      }
    },
    drop: async (): Promise<void> => {
      const dropper = postgres(admin, { max: 1, onnotice: () => undefined });
      try {
        await dropper.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await dropper.end();
        await stopServer();
      }
    },
  };
}
