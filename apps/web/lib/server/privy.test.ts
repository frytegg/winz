import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AUTH_OUTAGE_LOG_WINDOW_MS,
  AuthUnavailableError,
  InvalidAccessTokenError,
  ThrottledOutageLog,
  authenticateRequest,
  type AuthDeps,
  type OutageSink,
} from "./auth";
import type { Db } from "./db";
import { PrivyIdentity, PrivyKeySet, PrivyKeysUnavailableError } from "./privy";
import { ApiRouteError } from "./route";

// The real @privy-io/node SDK checks the tokens; the key set it needs is served by a local HTTP
// server standing in for Privy (nothing here reaches the network). Tokens are signed here with
// ES256 keys made for the test.

const APP_ID = "privytestappid00000000025";
const KID = "test-key-1";

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

interface Signer {
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}

function newSigner(kid: string): Signer {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" },
  };
}

function token(
  signer: Signer,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(
    JSON.stringify({ alg: "ES256", typ: "JWT", kid: signer.jwk.kid, ...header }),
  );
  const body = base64url(
    JSON.stringify({
      iss: "privy.io",
      aud: APP_ID,
      sub: "did:privy:joe",
      sid: "session-1",
      iat: now - 10,
      exp: now + 3600,
      ...claims,
    }),
  );
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), {
    key: signer.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${head}.${body}.${base64url(signature)}`;
}

type Mode = "ok" | "error" | "slow" | "not-json";

describe("PrivyIdentity.verify against a stand-in for Privy", () => {
  const signer = newSigner(KID);
  let server: Server;
  let apiUrl: string;
  let mode: Mode = "ok";
  let requests = 0;

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      requests += 1;
      if (request.url !== `/v1/apps/${APP_ID}/jwks.json`) {
        response.writeHead(404).end();
        return;
      }
      if (mode === "error") {
        response.writeHead(503).end("upstream unavailable");
        return;
      }
      if (mode === "not-json") {
        response.writeHead(200, { "content-type": "text/html" }).end("<html>maintenance</html>");
        return;
      }
      const send = (): void => {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ keys: [signer.jwk] }));
      };
      if (mode === "slow") setTimeout(send, 600);
      else send();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    apiUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    mode = "ok";
    requests = 0;
  });

  function identity(url = apiUrl): PrivyIdentity {
    return new PrivyIdentity(() => ({ appId: APP_ID, appSecret: "dummy-secret", apiUrl: url }), {
      keys: { timeoutMs: 200 },
    });
  }

  it("accepts a valid token, and fetches the key set once", async () => {
    const privy = identity();
    await expect(privy.verify(token(signer))).resolves.toEqual({ privyUserId: "did:privy:joe" });
    await expect(privy.verify(token(signer))).resolves.toEqual({ privyUserId: "did:privy:joe" });
    expect(requests).toBe(1);
  });

  const invalid: [string, () => string, RegExp][] = [
    [
      "an expired token",
      () => token(signer, { exp: Math.floor(Date.now() / 1000) - 60 }),
      /expired/,
    ],
    [
      "a token of another app",
      () => token(signer, { aud: "anotherappid0000000000025" }),
      /invalid/,
    ],
    ["a token of another issuer", () => token(signer, { iss: "evil.example" }), /invalid/],
    [
      "a token signed by a key Privy does not have",
      () => token(newSigner(KID)),
      /Failed to verify/,
    ],
    [
      "a token naming a key Privy does not have",
      () => token(newSigner("unknown-kid")),
      /Failed to verify/,
    ],
    ["a token that is not a JWT", () => "not-a-token", /Failed to verify/],
    [
      "a token whose payload was changed after signing",
      () => {
        const [head, , signature] = token(signer).split(".");
        return `${head ?? ""}.${base64url(JSON.stringify({ sub: "did:privy:mallory" }))}.${signature ?? ""}`;
      },
      /Failed to verify/,
    ],
  ];

  it.each(invalid)(
    "refuses %s as invalid (401), while the keys are reachable",
    async (_label, make, reason) => {
      const error = await identity()
        .verify(make())
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InvalidAccessTokenError);
      expect((error as Error).message).toMatch(reason);
    },
  );

  const outages: [string, Mode | "unreachable"][] = [
    ["Privy answers an error", "error"],
    ["Privy is too slow", "slow"],
    ["Privy answers something that is not a key set", "not-json"],
    ["Privy cannot be reached", "unreachable"],
  ];

  it.each(outages)("says the token could not be checked when %s", async (_label, outage) => {
    let privy: PrivyIdentity;
    if (outage === "unreachable") {
      // A port nothing listens on: connection refused.
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", () => resolve()));
      const port = (closed.address() as AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      privy = identity(`http://127.0.0.1:${String(port)}`);
    } else {
      mode = outage;
      privy = identity();
    }
    const error = await privy.verify(token(signer)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthUnavailableError);
    expect(error).not.toBeInstanceOf(InvalidAccessTokenError);
    expect((error as AuthUnavailableError).cause).toBeInstanceOf(PrivyKeysUnavailableError);
  });

  it("checks a valid token again once Privy is back, without a restart", async () => {
    const privy = identity();
    mode = "error";
    await expect(privy.verify(token(signer))).rejects.toBeInstanceOf(AuthUnavailableError);
    mode = "slow";
    await expect(privy.verify(token(signer))).rejects.toBeInstanceOf(AuthUnavailableError);
    mode = "ok";
    await expect(privy.verify(token(signer))).resolves.toEqual({ privyUserId: "did:privy:joe" });
    expect(requests).toBe(3);
  });

  it("does not fetch the key set for a token it can refuse by itself", async () => {
    mode = "error";
    const error = await identity()
      .verify("not-a-token")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidAccessTokenError);
    expect(requests).toBe(0);
  });
});

describe("PrivyKeySet", () => {
  it("fetches again for an unknown key at most once per cooldown, and after the maximum age", async () => {
    const first = newSigner("k1");
    const second = newSigner("k2");
    let served = [first.jwk];
    let fetches = 0;
    let clock = 0;
    const keys = new PrivyKeySet("http://keys.invalid/jwks.json", {
      now: () => clock,
      fetch: (() => {
        fetches += 1;
        return Promise.resolve(Response.json({ keys: served }));
      }) as typeof fetch,
    });
    await expect(keys.keyFor({ alg: "ES256", kid: "k1" })).resolves.toMatchObject({ kid: "k1" });
    served = [first.jwk, second.jwk];
    // k2 appeared at Privy: within the cooldown it is not fetched again.
    clock = 60_000;
    await expect(keys.keyFor({ alg: "ES256", kid: "k2" })).rejects.toThrow(/no key/);
    expect(fetches).toBe(1);
    clock = 10 * 60_000;
    await expect(keys.keyFor({ alg: "ES256", kid: "k2" })).resolves.toMatchObject({ kid: "k2" });
    expect(fetches).toBe(2);
    // Kept 60 minutes, then fetched again.
    clock = 10 * 60_000 + 60 * 60_000;
    await keys.keyFor({ alg: "ES256", kid: "k1" });
    expect(fetches).toBe(3);
  });

  it("shares one fetch between concurrent tokens", async () => {
    const signer = newSigner("k1");
    let fetches = 0;
    const keys = new PrivyKeySet("http://keys.invalid/jwks.json", {
      fetch: (async () => {
        fetches += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({ keys: [signer.jwk] });
      }) as typeof fetch,
    });
    await Promise.all(Array.from({ length: 5 }, () => keys.keyFor({ alg: "ES256", kid: "k1" })));
    expect(fetches).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// authenticateRequest: 401 for a bad token, 503 when it could not be checked
// ---------------------------------------------------------------------------------------------

describe("authenticateRequest when the identity provider fails", () => {
  /** Never reached on these paths: the request stops at the token. */
  const db = new Proxy(
    {},
    {
      get: () => {
        throw new Error("the database must not be reached");
      },
    },
  ) as unknown as Db;

  function deps(verify: () => Promise<never>, outageLog: ThrottledOutageLog): AuthDeps {
    const unused = (): never => {
      throw new Error("not reached");
    };
    return {
      db,
      verifier: { verify },
      directory: { getUser: unused, findOrCreateWalletByEmail: unused },
      adminKey: () => "unused-admin-key",
      outageLog,
    };
  }

  function request(): Request {
    return new Request("http://localhost/api/me", {
      headers: { authorization: `Bearer ${randomBytes(8).toString("hex")}` },
    });
  }

  class RecordingSink implements OutageSink {
    readonly lines: { details: Record<string, unknown>; message: string }[] = [];
    warn(details: Record<string, unknown>, message: string): void {
      this.lines.push({ details, message });
    }
  }

  it("answers 401 for a token that is invalid or expired", async () => {
    const sink = new RecordingSink();
    const error = await authenticateRequest(
      request(),
      "merchant",
      deps(
        () => Promise.reject(new InvalidAccessTokenError("Authentication token expired")),
        new ThrottledOutageLog(sink),
      ),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRouteError);
    expect(error).toMatchObject({ status: 401, code: "unauthenticated" });
    expect(sink.lines).toHaveLength(0);
  });

  it("answers 503, retryable, when the token could not be checked, and logs it once per window", async () => {
    const sink = new RecordingSink();
    let clock = 0;
    const log = new ThrottledOutageLog(sink, AUTH_OUTAGE_LOG_WINDOW_MS, () => clock);
    const outage = deps(
      () =>
        Promise.reject(
          new AuthUnavailableError("keys unreachable", {
            cause: new PrivyKeysUnavailableError("HTTP 503"),
          }),
        ),
      log,
    );
    for (let i = 0; i < 5; i += 1) {
      clock += 1000;
      const error = await authenticateRequest(request(), "user", outage).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiRouteError);
      expect(error).toMatchObject({ status: 503, code: "internal" });
      expect((error as Error).message).toMatch(/try again/i);
      expect((error as Error).message).not.toMatch(/expired|sign in again/i);
    }
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.details).toMatchObject({ heldBack: 0 });

    clock += AUTH_OUTAGE_LOG_WINDOW_MS;
    await authenticateRequest(request(), "user", outage).catch(() => undefined);
    expect(sink.lines).toHaveLength(2);
    expect(sink.lines[1]?.details).toMatchObject({ heldBack: 4 });
    // Never the token in the log line.
    expect(JSON.stringify(sink.lines)).not.toMatch(/Bearer/);
  });

  it("lets any other failure through, answered 500 by the route as before", async () => {
    const sink = new RecordingSink();
    const error = await authenticateRequest(
      request(),
      "user",
      deps(() => Promise.reject(new Error("bug")), new ThrottledOutageLog(sink)),
    ).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(ApiRouteError);
    expect(sink.lines).toHaveLength(0);
  });
});
