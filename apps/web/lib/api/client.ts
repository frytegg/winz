import {
  ADMIN_KEY_HEADER,
  API_ROUTES,
  MOCK_SCENARIO_HEADER,
  apiErrorSchema,
  type ApiErrorCode,
  type ApiRouteName,
} from "@winz/shared";
import type { z, ZodType } from "zod";

import { readDemoFlag, setDemoMode } from "@/lib/demo/store";

import { getMockScenario, scenarioFor } from "./mock-scenario";

/**
 * The typed client of the HTTP API (SPEC section 10). Everything comes from `API_ROUTES`: the URL,
 * the method, the schema of the request and the schema of the answer. Every answer is validated, so
 * a screen never reads a field the back does not send.
 *
 *   const me = await apiFetch("me");
 *   const preview = await apiFetch("campaignPreview", { body: terms, signal });
 *   const campaign = await apiFetch("campaignDetail", { params: { id } });
 */

type Routes = typeof API_ROUTES;

export type RouteResponse<K extends ApiRouteName> = z.output<Routes[K]["response"]>;
export type RouteBody<K extends ApiRouteName> = Routes[K] extends {
  request: infer R extends ZodType;
}
  ? z.input<R>
  : undefined;
export type RouteQuery<K extends ApiRouteName> = Routes[K] extends {
  query: infer Q extends ZodType;
}
  ? z.input<Q>
  : undefined;

/** `"/api/campaigns/:id/top-up"` → `"id"`. */
type PathParams<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

type ParamsOption<K extends ApiRouteName> = [PathParams<Routes[K]["path"]>] extends [never]
  ? { params?: undefined }
  : { params: Record<PathParams<Routes[K]["path"]>, string> };

type BodyOption<K extends ApiRouteName> = Routes[K] extends { request: ZodType }
  ? { body: RouteBody<K> }
  : { body?: undefined };

type QueryOption<K extends ApiRouteName> = Routes[K] extends { query: ZodType }
  ? { query?: RouteQuery<K> }
  : { query?: undefined };

export type ApiFetchOptions<K extends ApiRouteName> = ParamsOption<K> &
  BodyOption<K> &
  QueryOption<K> & {
    signal?: AbortSignal;
    /** Absolute origin, for a request made on the server (a Server Component). */
    baseUrl?: string;
    /** `x-admin-key`, for the demo routes. */
    adminKey?: string;
    /**
     * The mock scenario to ask for, when the request is made on the server (a Server Component has
     * no `sessionStorage`). Only honored in mock mode; the browser reads its own.
     */
    scenario?: string | null;
  };

type OptionsArgument<K extends ApiRouteName> =
  Partial<ApiFetchOptions<K>> extends ApiFetchOptions<K>
    ? [options?: ApiFetchOptions<K>]
    : [options: ApiFetchOptions<K>];

/** `status` is the HTTP status, 0 when the request never got an answer. */
export type ApiClientErrorCode = ApiErrorCode | "network" | "invalid_response";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiClientErrorCode;
  /**
   * What went wrong inside, for a developer (a schema's first failing field): never in `message`,
   * which a screen may show as it is. `null` when the message says it all.
   */
  readonly detail: string | null;

  constructor(
    status: number,
    code: ApiClientErrorCode,
    message: string,
    detail: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** What a person reads when the app itself got something wrong: a plain sentence, no field name. */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong. Try again.";

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** True for a request cancelled with an `AbortController` (a stale answer of a debounced call). */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** The message to show: the API's own for an `ApiError`, otherwise `fallback`. */
export function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}

type AccessTokenProvider = () => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;
let unauthenticatedHandler: ((route: ApiRouteName) => void) | null = null;

/** Injected by the auth layer (I-01): the Privy access token, for the `user` and `merchant` routes. */
export function setAccessTokenProvider(provider: AccessTokenProvider | null): void {
  accessTokenProvider = provider;
}

/** Called on a 401: the merchant goes back to `/start`, a fan gets the sign-in sheet. */
export function setUnauthenticatedHandler(handler: ((route: ApiRouteName) => void) | null): void {
  unauthenticatedHandler = handler;
}

/** `"/api/c/:slug"` + `{ slug: "joes" }` + `{ a: 1 }` → `"/api/c/joes?a=1"`. */
export function buildPath(
  template: string,
  params: Record<string, string> | undefined,
  query: Record<string, unknown> | undefined,
): string {
  const path = template.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined)
      throw new RangeError(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text === "" ? path : `${path}?${text}`;
}

function describeIssues(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid data";
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}

export async function apiFetch<K extends ApiRouteName>(
  route: K,
  ...args: OptionsArgument<K>
): Promise<RouteResponse<K>> {
  const spec = API_ROUTES[route] as {
    method: "GET" | "POST";
    path: string;
    auth: string;
    request?: ZodType;
    response: ZodType;
  };
  const options = (args[0] ?? {}) as {
    params?: Record<string, string>;
    body?: unknown;
    query?: Record<string, unknown>;
    signal?: AbortSignal;
    baseUrl?: string;
    adminKey?: string;
    scenario?: string | null;
  };

  let body: string | undefined;
  if (spec.request !== undefined) {
    const parsed = spec.request.safeParse(options.body);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        INTERNAL_ERROR_MESSAGE,
        `Invalid body.${describeIssues(parsed.error)}`,
      );
    }
    body = JSON.stringify(parsed.data);
  }

  const url = `${options.baseUrl ?? ""}${buildPath(spec.path, options.params, options.query)}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";

  if (spec.auth === "user" || spec.auth === "merchant") {
    const token = accessTokenProvider === null ? null : await accessTokenProvider();
    if (token !== null) headers.authorization = `Bearer ${token}`;
  }
  if (spec.auth === "admin" && options.adminKey !== undefined) {
    headers[ADMIN_KEY_HEADER] = options.adminKey;
  }
  const scenario = scenarioFor(route, options.scenario ?? getMockScenario());
  if (scenario !== null) headers[MOCK_SCENARIO_HEADER] = scenario;

  let response: Response;
  try {
    response = await fetch(url, {
      method: spec.method,
      headers,
      body,
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error: unknown) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, "network", "Can't reach Winz right now. Check your connection.");
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    if (response.status === 401 && unauthenticatedHandler !== null) unauthenticatedHandler(route);
    const parsedError = apiErrorSchema.safeParse(json);
    if (parsedError.success) {
      throw new ApiError(
        response.status,
        parsedError.data.error.code,
        parsedError.data.error.message,
      );
    }
    throw new ApiError(response.status, "internal", INTERNAL_ERROR_MESSAGE);
  }

  const parsed = spec.response.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      "invalid_response",
      INTERNAL_ERROR_MESSAGE,
      `Unexpected answer from ${spec.path}: ${describeIssues(parsed.error)}`,
    );
  }

  if (typeof window !== "undefined") {
    const demo = readDemoFlag(parsed.data);
    if (demo !== null) setDemoMode(demo);
  }
  return parsed.data as RouteResponse<K>;
}
