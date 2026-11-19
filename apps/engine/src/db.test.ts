import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createDb, databaseSsl, isLocalDatabaseHost, type Db } from "./db";
import { createTestDatabase, type TestDatabase } from "./testing/postgres";

const POOLER =
  "postgres://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

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
    const plain = client(`${remoteLooking}?sslmode=disable`);
    throughForwarder(plain, forwarderPort, dialled);
    const [row] = await plain<{ one: number }[]>`select 1 as one`;
    expect(row?.one).toBe(1);
    expect(sent).toHaveLength(1);
    const startup = Buffer.concat(sent[0] ?? []);
    expect(startup.length).toBeGreaterThan(SSL_REQUEST.length);
    expect(startup.subarray(0, SSL_REQUEST.length)).not.toEqual(SSL_REQUEST);
  });
});
