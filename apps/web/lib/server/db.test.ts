import { randomBytes } from "node:crypto";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";

import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../../engine/src/testing/postgres";
import {
  IDLE_CLOSE_MARGIN_MS,
  IdleConnectionWait,
  WEB_DB_APPLICATION_NAME,
  WEB_DB_IDLE_TIMEOUT_S,
  createWebDb,
  databaseHosts,
  databaseSsl,
  isLocalDatabaseHost,
  untilIdleConnectionsClosed,
  type Db,
  type IdleWatchedDb,
} from "./db";

const POOLER =
  "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

/** A URL with its host replaced (the test database listens on 127.0.0.1). */
function withHost(url: string, host: string): string {
  return url.replace("@127.0.0.1:", `@${host}:`);
}

function withParameter(url: string, parameter: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${parameter}`;
}

/** A host name that is not local and resolves nowhere: `.invalid` is reserved by RFC 6761. */
const NOT_LOCAL_HOST = "db.winz-tls-test.invalid";

/** Postgres's SSLRequest: length 8, code 80877103 (node_modules/postgres/src/protocol.js). */
const SSL_REQUEST = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);

/**
 * Makes `db` open its connections to the forwarder on 127.0.0.1:`port`, whatever host and port it
 * was given, through Postgres.js's `socket` option (read from the client's options each time a
 * connection opens, src/socket.js `Socket`). Records each `host:port` the client asked for.
 */
function throughForwarder(db: Db, port: number, dialled: string[]): void {
  const socket = (_options: unknown, host: string, wanted: number): Promise<Socket> => {
    dialled.push(`${host}:${String(wanted)}`);
    return new Promise((resolve, reject) => {
      const opened = connect(port, "127.0.0.1");
      opened.once("error", reject);
      opened.once("connect", () => {
        opened.off("error", reject);
        resolve(opened);
      });
    });
  };
  Object.assign(db.options, { socket });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------------------------

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
    ["LOCALHOST", "postgres://u:p@LOCALHOST:5432/db", undefined],
    ["127.0.0.1", "postgres://u:p@127.0.0.1:5432/db", undefined],
    ["another loopback address", "postgres://u:p@127.0.0.2:5432/db", undefined],
    ["::1", "postgres://u:p@[::1]:5432/db", undefined],
    ["::1 written in full", "postgres://u:p@[0:0:0:0:0:0:0:1]:5432/db", undefined],
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
    ["no host at all (Postgres.js then uses localhost)", "postgres:///db", undefined],
    ["sslmode=disable on the pooler: kept", `${POOLER}?sslmode=disable`, undefined],
    [
      "sslmode=require on localhost: kept",
      "postgres://u@localhost:5432/db?sslmode=require",
      undefined,
    ],
    ["sslmode=verify-full on the pooler: kept", `${POOLER}?sslmode=verify-full`, undefined],
    ["ssl=false on the pooler: kept", `${POOLER}?ssl=false`, undefined],
    ["a root certificate on the pooler: kept", `${POOLER}?sslrootcert=system`, undefined],
  ];

  it.each(cases)("%s", (_label, url, expected) => {
    expect(databaseSsl(url, {})).toBe(expected);
  });

  it("reads the hosts as Postgres.js does", () => {
    expect(databaseHosts(POOLER, {})).toEqual(["aws-0-eu-central-1.pooler.supabase.com"]);
    expect(databaseHosts("postgres://u@[::1]:5432,b.example:6543/db", {})).toEqual([
      "::1",
      "b.example",
    ]);
    expect(databaseHosts("postgres://u@%2Ftmp%2Fpg/db", {})).toEqual(["/tmp/pg"]);
    expect(databaseHosts("postgres://u@a.example/db?host=/tmp/pg", {})).toEqual(["/tmp/pg"]);
    expect(databaseHosts("postgres:///db", { PGHOST: "db.example" })).toEqual(["db.example"]);
    expect(databaseSsl("postgres:///db", { PGHOST: "db.example" })).toBe("require");
  });

  it("leaves PGSSLMODE or PGSSL, when set, to Postgres.js", () => {
    expect(databaseSsl(POOLER, { PGSSLMODE: "verify-full" })).toBeUndefined();
    expect(databaseSsl(POOLER, { PGSSL: "true" })).toBeUndefined();
    expect(databaseSsl(POOLER, { PGSSLMODE: "" })).toBe("require");
  });

  it("knows what is local", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "127.255.0.9",
      "::1",
      "::ffff:127.0.0.1",
      "/tmp/pg",
    ]) {
      expect(isLocalDatabaseHost(host), host).toBe(true);
    }
    for (const host of [
      "db.example.com",
      "10.0.0.1",
      "::ffff:10.0.0.1",
      "192.0.2.2",
      "localhost.example",
    ]) {
      expect(isLocalDatabaseHost(host), host).toBe(false);
    }
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
      [`${POOLER}?sslmode=verify-full`, "verify-full"],
    ];
    for (const [url, ssl] of effective) {
      const db = createWebDb(url);
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
    const db = createWebDb(url, { max: 1 });
    clients.push(db);
    return db;
  }

  it("reaches the local test Postgres, which has no TLS, through loopback URLs", async () => {
    // The test Postgres runs with ssl off: a TLS request would be refused.
    const [setting] = await database.db<{ ssl: string }[]>`select current_setting('ssl') as ssl`;
    expect(setting?.ssl).toBe("off");
    for (const url of [database.url, withHost(database.url, "localhost")]) {
      const [row] = await client(url)<{ one: number }[]>`select 1 as one`;
      expect(row?.one, url).toBe(1);
    }
  });

  it("refuses to talk in clear to a host that is not local, with a clear error", async () => {
    // Built without the machine's name, DNS or any network. The URL names a host under `.invalid`,
    // which RFC 6761 reserves so that it never resolves anywhere. The real client is given a socket
    // of its own (Postgres.js's `socket` option, which src/socket.js `Socket` calls with the host
    // and port in place of its own `net.connect`, so nothing resolves the name): a TCP connection
    // to a forwarder on 127.0.0.1 that records every byte the client sends and pipes them to the
    // test Postgres. The client still reasons on the URL's host, which is not local: it asks for
    // TLS first, and Postgres says no.
    expect(isLocalDatabaseHost(NOT_LOCAL_HOST)).toBe(false);
    const target = new URL(database.url.replace(/^postgres:/, "http:"));
    const sent: Buffer[][] = [];
    forwarder = createServer((incoming) => {
      const received: Buffer[] = [];
      sent.push(received);
      incoming.on("data", (chunk: Buffer) => received.push(chunk));
      const outgoing = connect(Number(target.port), "127.0.0.1");
      for (const socket of [incoming, outgoing]) {
        sockets.add(socket);
        socket.on("error", () => socket.destroy());
        socket.on("close", () => sockets.delete(socket));
      }
      incoming.pipe(outgoing).pipe(incoming);
    });
    await new Promise<void>((resolve) => forwarder?.listen(0, "127.0.0.1", () => resolve()));
    const forwarderPort = (forwarder.address() as AddressInfo).port;
    const remoteLooking = database.url.replace(
      `@127.0.0.1:${target.port}`,
      `@${NOT_LOCAL_HOST}:5432`,
    );
    expect(databaseSsl(remoteLooking, {})).toBe("require");

    const dialled: string[] = [];
    const refusing = client(remoteLooking);
    throughForwarder(refusing, forwarderPort, dialled);
    const refused = await refusing`select 1`.then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toMatchObject({
      code: "SSL_NOT_SUPPORTED",
      message: expect.stringContaining("does not support SSL") as unknown,
    });
    // The client dialled the name of the URL, and sent nothing but its request for TLS.
    expect(dialled.length).toBeGreaterThan(0);
    expect(new Set(dialled)).toEqual(new Set([`${NOT_LOCAL_HOST}:5432`]));
    expect(sent).toHaveLength(dialled.length);
    for (const received of sent) expect(Buffer.concat(received)).toEqual(SSL_REQUEST);

    // Positive control: the same path works once the URL explicitly says no TLS, and the recorder
    // then sees the start-up message in clear (it would see one above, had it been sent).
    sent.length = 0;
    const plain = client(withParameter(remoteLooking, "sslmode=disable"));
    throughForwarder(plain, forwarderPort, dialled);
    const [row] = await plain<{ one: number }[]>`select 1 as one`;
    expect(row?.one).toBe(1);
    expect(sent).toHaveLength(1);
    const startup = Buffer.concat(sent[0] ?? []);
    expect(startup.length).toBeGreaterThan(SSL_REQUEST.length);
    expect(startup.subarray(0, SSL_REQUEST.length)).not.toEqual(SSL_REQUEST);
  });
});

// ---------------------------------------------------------------------------------------------
// Closing idle connections
// ---------------------------------------------------------------------------------------------

describe("IdleConnectionWait", () => {
  function fakeDb(
    connections: number,
    idleTimeout: number | null,
  ): IdleWatchedDb & {
    stats: { connections: number; opening: number; idle: number; leased: number; waiting: number };
  } {
    return {
      stats: { connections, opening: 0, idle: connections, leased: 0, waiting: 0 },
      options: { idle_timeout: idleTimeout },
    };
  }

  it("is bounded by the idle timeout plus a margin; the server's is 5 s", () => {
    expect(new IdleConnectionWait(fakeDb(1, WEB_DB_IDLE_TIMEOUT_S)).boundMs()).toBe(
      WEB_DB_IDLE_TIMEOUT_S * 1000 + IDLE_CLOSE_MARGIN_MS,
    );
    expect(WEB_DB_IDLE_TIMEOUT_S).toBe(5);
    expect(new IdleConnectionWait(fakeDb(1, null)).boundMs()).toBe(0);
  });

  it("ends at once when the pool holds no connection, or the client has no idle timeout", async () => {
    const started = performance.now();
    await new IdleConnectionWait(fakeDb(0, 5)).wait();
    await new IdleConnectionWait(fakeDb(2, null)).wait();
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("ends as soon as the last connection is closed", async () => {
    const db = fakeDb(2, 5);
    setTimeout(() => (db.stats.connections = 0), 200);
    const started = performance.now();
    await new IdleConnectionWait(db).wait();
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(1000);
  });

  it("gives up at its bound when a connection never closes", async () => {
    const db = fakeDb(1, 0.2); // bound: 200 ms + the margin
    const started = performance.now();
    await new IdleConnectionWait(db).wait();
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(200 + IDLE_CLOSE_MARGIN_MS - 5);
    expect(elapsed).toBeLessThan(200 + IDLE_CLOSE_MARGIN_MS + 500);
  });

  it("shares one wait between overlapping calls, each pushing the end back once", async () => {
    let clock = 0;
    const db = fakeDb(1, 1);
    const wait = new IdleConnectionWait(db, () => clock);
    const first = wait.wait();
    clock = 500;
    const second = wait.wait();
    expect(second).toBe(first);
    // Deadline: 500 + 1000 + margin. Before it, the wait goes on; after it, it ends.
    clock = 500 + 1000 + IDLE_CLOSE_MARGIN_MS - 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
    let settled = false;
    void first.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(false);
    clock += 2;
    await first;
    // A call after the end starts a new wait.
    expect(wait.wait()).not.toBe(first);
    db.stats.connections = 0;
  });
});

describe("untilIdleConnectionsClosed on a real client", () => {
  let database: TestDatabase;
  let admin: Db;

  beforeAll(async () => {
    database = await createTestDatabase();
    admin = postgres(inject("pgAdminUrl"), { max: 1, onnotice: () => undefined });
  });
  afterAll(async () => {
    await admin.end();
    await database.drop();
  });

  async function openConnections(application: string): Promise<number> {
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from pg_stat_activity where application_name = ${application}
    `;
    return row?.count ?? 0;
  }

  async function closedWithin(application: string, ms: number): Promise<boolean> {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      if ((await openConnections(application)) === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return (await openConnections(application)) === 0;
  }

  it("names the web's connections in pg_stat_activity", async () => {
    vi.stubEnv("PGAPPNAME", undefined);
    const db = createWebDb(database.url, { max: 1 });
    const [row] = await db<{ name: string }[]>`select current_setting('application_name') as name`;
    expect(row?.name).toBe(WEB_DB_APPLICATION_NAME);
    await db.end();
  });

  it("resolves once the client has closed its connections, within the bound", async () => {
    const application = `idle-${randomBytes(4).toString("hex")}`;
    const db = createWebDb(withParameter(database.url, `application_name=${application}`), {
      max: 3,
      idleTimeoutS: 1,
    });
    await Promise.all([
      db`select pg_sleep(0.1)`,
      db`select pg_sleep(0.1)`,
      db`select pg_sleep(0.1)`,
    ]);
    // Positive control: the three connections are open after the "response".
    expect(await openConnections(application)).toBe(3);

    const started = performance.now();
    await untilIdleConnectionsClosed(db);
    const elapsed = performance.now() - started;
    expect(db.stats.connections).toBe(0);
    // Closed by the idle timer (about 1 s), and before the bound (1 s + the margin).
    expect(elapsed).toBeGreaterThanOrEqual(800);
    expect(elapsed).toBeLessThan(1000 + IDLE_CLOSE_MARGIN_MS);
    // The server has seen them go (its backends exit a few ms after the client's goodbye).
    expect(await closedWithin(application, 500)).toBe(true);
    await db.end();
  });
});
