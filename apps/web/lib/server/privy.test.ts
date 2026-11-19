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
  type AuthVerifier,
  type OutageSink,
} from "./auth";
import type { Db } from "./db";
import {
  PRIVY_KEYS_REFUSED_STATUSES,
  PrivyIdentity,
  PrivyKeySet,
  PrivyKeysRefusedError,
  PrivyKeysUnavailableError,
  ThrottledPrivyConfigurationLog,
  type PrivyConfigurationSink,
} from "./privy";
import { ApiRouteError } from "./route";

// The real @privy-io/node SDK checks the tokens; the key set it needs is served by a local HTTP
// server standing in for Privy (nothing here reaches the network). Tokens are signed here with
// ES256 keys made for the test.

const APP_ID = "privytestappid00000000025";
/** Made for this run: a log line must never contain it. */
const APP_SECRET = `test-secret-${randomBytes(16).toString("hex")}`;
const KID = "test-key-1";

/** Records what `ThrottledPrivyConfigurationLog` writes at ERROR. */
class RecordingErrorSink implements PrivyConfigurationSink {
  readonly lines: { details: Record<string, unknown>; message: string }[] = [];
  error(details: Record<string, unknown>, message: string): void {
    this.lines.push({ details, message });
  }
}

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

type Mode = "ok" | "error" | "slow" | "not-json" | number;

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
      if (typeof mode === "number") {
        response.writeHead(mode, { "content-type": "application/json" }).end('{"error":"no"}');
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

  let errors: RecordingErrorSink;
  beforeEach(() => {
    errors = new RecordingErrorSink();
  });

  function identity(url = apiUrl, appId = APP_ID): PrivyIdentity {
    return new PrivyIdentity(() => ({ appId, appSecret: APP_SECRET, apiUrl: url }), {
      keys: { timeoutMs: 200 },
      configurationLog: new ThrottledPrivyConfigurationLog(errors),
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
    ["Privy answers 500", 500],
    ["Privy answers 502", 502],
    ["Privy answers 408 (request timeout)", 408],
    ["Privy answers 429 (rate limited)", 429],
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
    // An outage, not a configuration error: only the warning of authenticateRequest, no ERROR.
    expect((error as AuthUnavailableError).cause).not.toBeInstanceOf(PrivyKeysRefusedError);
    expect(errors.lines).toHaveLength(0);
  });

  it("takes 400, 401, 403 and 404 as the request being wrong, and nothing else", () => {
    expect([...PRIVY_KEYS_REFUSED_STATUSES].sort()).toEqual([400, 401, 403, 404]);
  });

  it.each([400, 401, 403, 404])(
    "says the token could not be checked when Privy refuses the request (HTTP %i), and logs a configuration error",
    async (status) => {
      mode = status;
      const error = await identity()
        .verify(token(signer))
        .catch((caught: unknown) => caught);
      // The client still gets the 503 of a token that could not be checked.
      expect(error).toBeInstanceOf(AuthUnavailableError);
      expect(error).not.toBeInstanceOf(InvalidAccessTokenError);
      const cause = (error as AuthUnavailableError).cause;
      expect(cause).toBeInstanceOf(PrivyKeysRefusedError);
      expect(cause).toMatchObject({ status });
      expect(errors.lines).toHaveLength(1);
      expect(errors.lines[0]?.details).toMatchObject({
        status,
        variable: "NEXT_PUBLIC_PRIVY_APP_ID",
        heldBack: 0,
      });
      expect(errors.lines[0]?.message).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
      expect(errors.lines[0]?.message).toContain(`HTTP ${String(status)}`);
    },
  );

  it("logs a mistyped app id (Privy's 404 for an unknown app) at ERROR, never its secret or the token", async () => {
    const sent = token(signer);
    const error = await identity(apiUrl, "mistypedappid000000000025")
      .verify(sent)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthUnavailableError);
    expect((error as AuthUnavailableError).cause).toMatchObject({ status: 404 });
    expect(requests).toBe(1);
    expect(errors.lines).toHaveLength(1);
    const logged = JSON.stringify(errors.lines);
    expect(logged).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
    expect(logged).not.toContain(sent);
    expect(logged).not.toContain(APP_SECRET);
    expect(logged).not.toContain("mistypedappid");
  });

  it("logs the configuration error once per window, with the refusals held back", async () => {
    let clock = 0;
    const privy = new PrivyIdentity(() => ({ appId: APP_ID, appSecret: APP_SECRET, apiUrl }), {
      keys: { timeoutMs: 200 },
      configurationLog: new ThrottledPrivyConfigurationLog(
        errors,
        AUTH_OUTAGE_LOG_WINDOW_MS,
        () => clock,
      ),
    });
    mode = 404;
    for (let i = 0; i < 5; i += 1) {
      clock += 1000;
      await expect(privy.verify(token(signer))).rejects.toBeInstanceOf(AuthUnavailableError);
    }
    expect(requests).toBe(5);
    expect(errors.lines).toHaveLength(1);
    clock += AUTH_OUTAGE_LOG_WINDOW_MS;
    await expect(privy.verify(token(signer))).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(errors.lines).toHaveLength(2);
    expect(errors.lines[1]?.details).toMatchObject({ status: 404, heldBack: 4 });
  });

  it("checks a valid token again once Privy accepts the request, without a restart", async () => {
    const privy = identity();
    mode = 404;
    await expect(privy.verify(token(signer))).rejects.toBeInstanceOf(AuthUnavailableError);
    mode = 403;
    await expect(privy.verify(token(signer))).rejects.toBeInstanceOf(AuthUnavailableError);
    mode = "ok";
    await expect(privy.verify(token(signer))).resolves.toEqual({ privyUserId: "did:privy:joe" });
    expect(requests).toBe(3);
    // Within one window: the second refusal was held back, not logged again.
    expect(errors.lines).toHaveLength(1);
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

  function deps(verify: AuthVerifier["verify"], outageLog: ThrottledOutageLog): AuthDeps {
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

  function request(accessToken = randomBytes(8).toString("hex")): Request {
    return new Request("http://localhost/api/me", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  const signer = newSigner(KID);

  /** A well-formed token of its own each time, so that the real verifier fetches the key set. */
  function freshToken(): string {
    return token(signer, { sid: `session-${randomBytes(8).toString("hex")}` });
  }

  /** The real verifier, with Privy's key set answering `status` (no network: a fetch of its own). */
  function privyAnswering(status: number, errors: RecordingErrorSink): PrivyIdentity {
    return new PrivyIdentity(
      () => ({ appId: APP_ID, appSecret: APP_SECRET, apiUrl: "http://privy.invalid" }),
      {
        keys: {
          fetch: (() => Promise.resolve(new Response("{}", { status }))) as typeof fetch,
        },
        configurationLog: new ThrottledPrivyConfigurationLog(errors),
      },
    );
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
    const errors = new RecordingErrorSink();
    let clock = 0;
    const log = new ThrottledOutageLog(sink, AUTH_OUTAGE_LOG_WINDOW_MS, () => clock);
    // The real verifier, whose key set answers 503: an outage.
    const privy = privyAnswering(503, errors);
    const outage = deps((accessToken) => privy.verify(accessToken), log);
    const sent: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      clock += 1000;
      const accessToken = freshToken();
      sent.push(accessToken);
      const error = await authenticateRequest(request(accessToken), "user", outage).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiRouteError);
      expect(error).toMatchObject({ status: 503, code: "internal" });
      expect((error as Error).message).toMatch(/try again/i);
      expect((error as Error).message).not.toMatch(/expired|sign in again/i);
    }
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.details).toMatchObject({ heldBack: 0 });
    expect(sink.lines[0]?.details.cause).toMatch(/HTTP 503/);

    clock += AUTH_OUTAGE_LOG_WINDOW_MS;
    const last = freshToken();
    sent.push(last);
    await authenticateRequest(request(last), "user", outage).catch(() => undefined);
    expect(sink.lines).toHaveLength(2);
    expect(sink.lines[1]?.details).toMatchObject({ heldBack: 4 });
    // An outage is a warning only: nothing at ERROR.
    expect(errors.lines).toHaveLength(0);

    // Never a token, nor the app secret, in a log line: each line serialised as pino would.
    const logged = [...sink.lines, ...errors.lines].map((line) => JSON.stringify(line));
    expect(logged).toHaveLength(2);
    for (const line of logged) {
      for (const accessToken of sent) {
        expect(line).not.toContain(accessToken);
        expect(line).not.toContain(accessToken.split(".")[2] ?? accessToken);
      }
      expect(line).not.toContain(APP_SECRET);
      expect(line).not.toMatch(/Bearer/);
    }
  });

  it("answers 503 for a wrong app id too, and logs it at ERROR with the variable to check", async () => {
    const sink = new RecordingSink();
    const errors = new RecordingErrorSink();
    const privy = privyAnswering(404, errors);
    const accessToken = freshToken();
    const error = await authenticateRequest(
      request(accessToken),
      "user",
      deps((given) => privy.verify(given), new ThrottledOutageLog(sink)),
    ).catch((caught: unknown) => caught);
    // The client's answer is unchanged: the token really could not be checked.
    expect(error).toBeInstanceOf(ApiRouteError);
    expect(error).toMatchObject({ status: 503, code: "internal" });
    expect(errors.lines).toHaveLength(1);
    expect(errors.lines[0]?.message).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
    expect(errors.lines[0]?.details).toMatchObject({ status: 404 });
    // One trace, not two: the ERROR line above is it, and the outage warning stays silent.
    expect(sink.lines).toHaveLength(0);
    expect(errors.lines[0]?.message).toContain("probably not the id of a Privy app");
    for (const line of [...sink.lines, ...errors.lines].map((entry) => JSON.stringify(entry))) {
      expect(line).not.toContain(accessToken);
      expect(line).not.toContain(APP_SECRET);
    }
  });

  it.each([401, 403])(
    "words an HTTP %i so that it is true for a wrong app id and for a blocked request alike",
    async (status) => {
      const sink = new RecordingSink();
      const errors = new RecordingErrorSink();
      const privy = privyAnswering(status, errors);
      const error = await authenticateRequest(
        request(freshToken()),
        "user",
        deps((given) => privy.verify(given), new ThrottledOutageLog(sink)),
      ).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ status: 503, code: "internal" });
      expect(errors.lines).toHaveLength(1);
      expect(errors.lines[0]?.message).toContain("NEXT_PUBLIC_PRIVY_APP_ID");
      expect(errors.lines[0]?.message).toContain("blocked before it reached Privy");
      expect(errors.lines[0]?.message).not.toContain("probably not the id");
      expect(sink.lines).toHaveLength(0);
    },
  );

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
