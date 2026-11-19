import { lookup } from "node:dns/promises";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { hostname } from "node:os";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createDb, databaseSsl, isLocalDatabaseHost, type Db } from "./db";
import { createTestDatabase, type TestDatabase } from "./testing/postgres";

const POOLER =
  "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the TLS option of each URL shape", () => {
  const cases: [string, string, "require" | undefined][] = [
    ["the Supabase session pooler", POOLER, "require"],
    ["a private address", "postgres://u:p@10.0.0.5:5432/db", "require"],
    [
      "a host list with one remote host",
      "postgres://u@localhost:5432,db.example.com:5432/db",
      "require",
    ],
    ["localhost", "postgres://u:p@localhost:5432/db", undefined],
    ["127.0.0.1", "postgres://u:p@127.0.0.1:5432/db", undefined],
    ["::1", "postgres://u:p@[::1]:5432/db", undefined],
    [
      "a socket directory in the host parameter",
      "postgres://u@/db?host=/var/run/postgresql",
      undefined,
    ],
    [
      "a socket directory, percent-encoded as the host",
      "postgres://u@%2Fvar%2Frun%2Fpostgresql/db",
      undefined,
    ],
    ["sslmode=disable on the pooler: kept", `${POOLER}?sslmode=disable`, undefined],
    [
      "sslmode=require on localhost: kept",
      "postgres://u@localhost:5432/db?sslmode=require",
      undefined,
    ],
    ["sslmode=verify-full on the pooler: kept", `${POOLER}?sslmode=verify-full`, undefined],
  ];

  it.each(cases)("%s", (_label, url, expected) => {
    expect(databaseSsl(url, {})).toBe(expected);
  });

  it("leaves PGSSLMODE, when set, to Postgres.js", () => {
    expect(databaseSsl(POOLER, { PGSSLMODE: "verify-full" })).toBeUndefined();
  });

  it("gives the client the option Postgres.js then uses", async () => {
    vi.stubEnv("PGSSLMODE", undefined);
    vi.stubEnv("PGSSL", undefined);
    const effective: [string, unknown][] = [
      [POOLER, "require"],
      ["postgres://u:p@localhost:5432/db", false],
      ["postgres://u:p@127.0.0.1:5432/db", false],
      ["postgres://u:p@[::1]:5432/db", false],
      ["postgres://u@/db?host=/var/run/postgresql", false],
      [`${POOLER}?sslmode=disable`, false],
      ["postgres://u@localhost:5432/db?sslmode=require", "require"],
    ];
    for (const [url, ssl] of effective) {
      const db = createDb(url);
      expect(db.options.ssl, url).toBe(ssl);
      await db.end();
    }
  });
});

describe("connections, with the TLS option", () => {
  let database: TestDatabase;
  let forwarder: Server | undefined;
  const sockets = new Set<Socket>();
  const clients: Db[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await Promise.all(clients.map((db) => db.end({ timeout: 1 })));
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      forwarder ? forwarder.close(() => resolve()) : resolve(),
    );
    await database.drop();
  });

  function client(url: string): Db {
    const db = createDb(url, { max: 1 });
    clients.push(db);
    return db;
  }

  it("reaches the local test Postgres, which has no TLS, through loopback URLs", async () => {
    const [setting] = await database.db<{ ssl: string }[]>`select current_setting('ssl') as ssl`;
    expect(setting?.ssl).toBe("off");
    for (const url of [database.url, database.url.replace("@127.0.0.1:", "@localhost:")]) {
      const [row] = await client(url)<{ one: number }[]>`select 1 as one`;
      expect(row?.one, url).toBe(1);
    }
  });

  it("refuses to talk in clear to a host that is not local, with a clear error", async () => {
    // No network: the URL names this machine by its hostname, which the system resolver maps to
    // one of its own addresses; a TCP forwarder on that address pipes to the test Postgres.
    const name = hostname();
    expect(isLocalDatabaseHost(name), `the hostname "${name}" must not look local`).toBe(false);
    const { address } = await lookup(name);
    const target = new URL(database.url.replace(/^postgres:/, "http:"));
    forwarder = createServer((incoming) => {
      const outgoing = connect(Number(target.port), "127.0.0.1");
      for (const socket of [incoming, outgoing]) {
        sockets.add(socket);
        socket.on("error", () => socket.destroy());
        socket.on("close", () => sockets.delete(socket));
      }
      incoming.pipe(outgoing).pipe(incoming);
    });
    await new Promise<void>((resolve) => forwarder?.listen(0, address, () => resolve()));
    const port = (forwarder.address() as AddressInfo).port;
    const remoteLooking = database.url.replace(
      `@127.0.0.1:${target.port}`,
      `@${name}:${String(port)}`,
    );

    const refused = await client(remoteLooking)`select 1`.then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toMatchObject({
      code: "SSL_NOT_SUPPORTED",
      message: expect.stringContaining("does not support SSL") as unknown,
    });

    // Positive control: the same path works once the URL explicitly says no TLS.
    const [row] = await client(`${remoteLooking}?sslmode=disable`)<
      { one: number }[]
    >`select 1 as one`;
    expect(row?.one).toBe(1);
  });
});
