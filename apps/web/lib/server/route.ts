import {
  API_ROUTES,
  MOCK_SCENARIO_HEADER,
  type ApiError,
  type ApiErrorCode,
  type ApiRouteName,
  type RouteAuth,
  type RouteSpec,
} from "@winz/shared";
import type { ZodType, z } from "zod";

import { isApiMock } from "./env";
import { serverLogger } from "./logger";
import { mockAnswer } from "./mock-answers";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

type RouteOf<N extends ApiRouteName> = (typeof API_ROUTES)[N];

/** Parsed JSON body of a route; `undefined` when the route table declares no `request` schema. */
export type RouteBody<N extends ApiRouteName> =
  RouteOf<N> extends { request: infer S extends ZodType } ? z.output<S> : undefined;

/** Parsed query string of a route; `undefined` when the route table declares no `query` schema. */
export type RouteQuery<N extends ApiRouteName> =
  RouteOf<N> extends { query: infer S extends ZodType } ? z.output<S> : undefined;

/** What an implementation must return: the input type of the route's response schema. */
export type RouteResponse<N extends ApiRouteName> = z.input<RouteOf<N>["response"]>;

export interface RouteContext<N extends ApiRouteName> {
  /** The raw request. Webhooks read their body from here: it is never consumed by the helper. */
  request: Request;
  /** Dynamic path segments (`:id`, `:slug`, `:pi`, `:token`), already awaited. */
  params: Record<string, string>;
  body: RouteBody<N>;
  query: RouteQuery<N>;
  /** Whatever `options.authenticate` returned; `undefined` while no authenticator is registered. */
  principal: unknown;
}

export type RouteImplementation<N extends ApiRouteName> = (
  context: RouteContext<N>,
) => Promise<RouteResponse<N>> | RouteResponse<N>;

export interface RouteOptions {
  /**
   * Hook point for authentication, left empty by this task. A later task registers here the
   * check matching the route's `auth` kind (Privy token, admin key, provider signature). It runs
   * outside mock mode only, before the body is read, and rejects by throwing an `ApiRouteError`
   * (401 `unauthenticated` or 403 `forbidden`). Its return value reaches the implementation as
   * `principal`.
   */
  authenticate?: (input: { request: Request; auth: RouteAuth }) => Promise<unknown> | unknown;
}

/** Next.js 15 App Router handler: `params` is a Promise. */
export type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** Thrown by an implementation to answer a non-2xx status with the standard error envelope. */
export class ApiRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRouteError";
  }
}

function errorResponse(status: number, code: ApiErrorCode, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

// ---------------------------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------------------------

interface MockRefusal {
  status: number;
  code: ApiErrorCode;
  message: string;
}

/**
 * Scenarios that exist only in the mock API: they answer an error instead of an example, so the
 * front can build its refusal screens. They are not in `API_ROUTES` because they are not
 * examples of the response schema.
 */
export const MOCK_REFUSALS: Partial<Record<ApiRouteName, Record<string, MockRefusal>>> = {
  checkout: {
    salesPaused: {
      status: 409,
      code: "sales_paused",
      message: "This promo is paused right now, you were not charged",
    },
    salesClosed: {
      status: 409,
      code: "sales_closed",
      message: "Sales are closed for this promo, you were not charged",
    },
  },
  // The demo panel's refusals, each with the real route's own words (lib/server/auth.ts and
  // lib/server/demo.ts): the browser suite drives them in e2e/ui/demo-admin.spec.ts.
  demoBook: {
    wrongKey: { status: 401, code: "unauthenticated", message: "Missing or invalid admin key" },
    offTick: {
      status: 400,
      code: "invalid_request",
      message: "Invalid body.bidBps: must be a multiple of 100 between 100 and 9900",
    },
  },
  demoResult: {
    wrongKey: { status: 401, code: "unauthenticated", message: "Missing or invalid admin key" },
    unknownInstrument: { status: 404, code: "not_found", message: "Instrument not found" },
  },
  demoSale: {
    wrongKey: { status: 401, code: "unauthenticated", message: "Missing or invalid admin key" },
    salesPaused: {
      status: 409,
      code: "sales_paused",
      message: "This promo is paused right now, you were not charged",
    },
  },
  demoReset: {
    wrongKey: { status: 401, code: "unauthenticated", message: "Missing or invalid admin key" },
  },
  me: {
    // The API refuses this person (a 403): the sign-in ends, the session with it.
    meRefused: {
      status: 403,
      code: "forbidden",
      message: "This account can't sign in right now",
    },
    // The API cannot say who is signed in (a cold start, a token it cannot check): the session stays.
    meUnavailable: {
      status: 503,
      code: "internal",
      message: "We couldn't check your sign-in. Try again in a moment",
    },
  },
  tickets: {
    ticketsUnavailable: {
      status: 503,
      code: "internal",
      message: "Your tickets are not available right now. Try again in a moment",
    },
  },
};

/** Every scenario name the mock API accepts for a route, `default` first. */
export function mockScenarios(name: ApiRouteName): string[] {
  const route: RouteSpec = API_ROUTES[name];
  return [...Object.keys(route.examples), ...Object.keys(MOCK_REFUSALS[name] ?? {})];
}

function mockResponse(
  name: ApiRouteName,
  route: RouteSpec,
  request: Request,
  input: { params: Record<string, string>; body: unknown },
): Response {
  const scenario = request.headers.get(MOCK_SCENARIO_HEADER)?.trim() || "default";
  // Own names only: `toString` or `constructor` would otherwise be found on the object's prototype
  // and answered as a refusal with no status.
  const refusals = MOCK_REFUSALS[name];
  const refusal =
    refusals !== undefined && Object.hasOwn(refusals, scenario) ? refusals[scenario] : undefined;
  if (refusal) return errorResponse(refusal.status, refusal.code, refusal.message);
  if (!Object.hasOwn(route.examples, scenario)) {
    throw new ApiRouteError(
      400,
      "invalid_request",
      `Unknown mock scenario "${scenario}" for ${route.method} ${route.path}. ` +
        `Valid scenarios: ${mockScenarios(name).join(", ")}`,
    );
  }
  // A few answers follow the request or the clock (the ticket of the token, M6's figures, the dates
  // of the games): mock-answers.ts. The others are the example as it is.
  const answer = mockAnswer(
    name,
    { scenario, params: input.params, body: input.body, now: new Date() },
    route.examples[scenario],
  );
  return answer.kind === "json"
    ? Response.json(answer.body)
    : errorResponse(answer.status, answer.code, answer.message);
}

// ---------------------------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------------------------

/** Parses `value`, or throws a 400 naming the first failing field. */
function validate(schema: ZodType, value: unknown, where: "body" | "query"): unknown {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue && issue.path.length > 0 ? `${where}.${issue.path.join(".")}` : where;
  throw new ApiRouteError(
    400,
    "invalid_request",
    `Invalid ${field}: ${issue?.message ?? "invalid value"}`,
  );
}

async function readBody(route: RouteSpec, request: Request): Promise<unknown> {
  if (!route.request) return undefined;
  let json: unknown;
  try {
    // A POST without any body means "no fields"; the schema then says which ones are required.
    const text = await request.text();
    json = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    // Not valid JSON: an expected client error, nothing to log.
    throw new ApiRouteError(400, "invalid_request", "Invalid body: expected a JSON document");
  }
  return validate(route.request, json, "body");
}

function readQuery(route: RouteSpec, request: Request): unknown {
  if (!route.query) return undefined;
  return validate(route.query, Object.fromEntries(new URL(request.url).searchParams), "query");
}

// ---------------------------------------------------------------------------------------------
// defineRoute
// ---------------------------------------------------------------------------------------------

/**
 * Builds the handler of one entry of `API_ROUTES`.
 *
 * - Mock mode (`APP_API_MOCK=true`): validates the input, then answers the example named by the
 *   `x-mock-scenario` header (`default` when absent), or for the few routes of `mock-answers.ts`
 *   what that example becomes for this request. No backing service, no secret needed.
 * - Otherwise: runs `implementation` and validates what it returns against the route's response
 *   schema, or answers 501 while none is registered.
 *
 * Nothing here reads the environment at import time, so `next build` works without secrets.
 */
export function defineRoute<N extends ApiRouteName>(
  name: N,
  implementation?: RouteImplementation<N>,
  options: RouteOptions = {},
): RouteHandler {
  const route: RouteSpec = API_ROUTES[name];

  return async (request, context) => {
    try {
      if (isApiMock()) {
        const body = await readBody(route, request);
        readQuery(route, request);
        return mockResponse(name, route, request, { params: await context.params, body });
      }

      if (!implementation) return errorResponse(501, "internal", "Not implemented yet");

      const principal = await options.authenticate?.({ request, auth: route.auth });
      const query = readQuery(route, request);
      const body = await readBody(route, request);
      const params = await context.params;
      const result = await implementation({
        request,
        params,
        body,
        query,
        principal,
      } as RouteContext<N>);

      const checked = route.response.safeParse(result);
      if (!checked.success) {
        serverLogger("api").error(
          { route: name, issues: checked.error.issues },
          "implementation returned a payload that does not match the response schema",
        );
        return errorResponse(500, "internal", "Internal error");
      }
      return Response.json(checked.data);
    } catch (error: unknown) {
      if (error instanceof ApiRouteError) {
        return errorResponse(error.status, error.code, error.message);
      }
      serverLogger("api").error({ route: name, err: error }, "unhandled error in route");
      return errorResponse(500, "internal", "Internal error");
    }
  };
}
