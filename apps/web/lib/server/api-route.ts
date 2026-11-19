import type { ApiRouteName } from "@winz/shared";
import { after } from "next/server";

import { authenticateRequest } from "./auth";
import { untilIdleConnectionsClosed, type Db } from "./db";
import { serverDeps, type ServerDeps } from "./deps";
import { isApiMock } from "./env";
import { serverLogger } from "./logger";
import {
  defineRoute,
  type RouteContext,
  type RouteHandler,
  type RouteOptions,
  type RouteResponse,
} from "./route";

/**
 * The options every route file passes to `defineRoute`, through `apiRoute`: authentication by the
 * route's auth kind (see `authenticateRequest`). Mock mode never reaches it.
 */
export const API_ROUTE_OPTIONS: RouteOptions = {
  authenticate: ({ request, auth }) => {
    const deps = serverDeps();
    return authenticateRequest(request, auth, {
      db: deps.db,
      verifier: deps.verifier,
      directory: deps.directory,
      adminKey: () => deps.config().adminKey,
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Keeping a deployed instance awake until its database connections are closed
// ---------------------------------------------------------------------------------------------

/**
 * Runs `task` once the response has been sent, and keeps the instance alive until `task`
 * settles. On Vercel this is next's `after`, which hands the task to the platform's `waitUntil`.
 */
export type AfterResponse = (task: () => Promise<void>) => void;

/**
 * Where an instance is frozen after its responses, the hook that keeps it awake; elsewhere null.
 *
 * Only Vercel freezes the process (its system variable `VERCEL` is "1" at build and run time).
 * `next dev`, `next start` in the end-to-end harness and Vitest never do: their idle timers run,
 * so nothing is scheduled and nothing is waited for there. Any other value of `VERCEL` (unset,
 * empty, "0") means no hook.
 *
 * `env` and `schedule` (next's `after` by default) are parameters so that tests can check the
 * rule without a request scope; the server calls it without arguments.
 */
export function platformAfterResponse(
  env: Record<string, string | undefined> = process.env,
  schedule: AfterResponse = (task) => {
    after(task);
  },
): AfterResponse | null {
  if (env.VERCEL !== "1") return null;
  return schedule;
}

let afterResponseOverride: AfterResponse | null | undefined;

/** Test only: replaces the platform's hook (`null`: none); `undefined` restores the real one. */
export function setAfterResponseForTesting(hook: AfterResponse | null | undefined): void {
  afterResponseOverride = hook;
}

const log = serverLogger("api");
let warnedNoAfter = false;

/**
 * After a response that may have used the database, keeps the instance awake until the client has
 * closed the connections it no longer uses (`untilIdleConnectionsClosed`: at most its idle timeout
 * plus a margin, and one shared wait for overlapping requests). Never throws: the response is
 * already decided.
 */
function keepAwakeUntilConnectionsClose(): void {
  if (isApiMock()) return;
  const schedule =
    afterResponseOverride === undefined ? platformAfterResponse() : afterResponseOverride;
  if (schedule === null) return;
  let db: Db;
  try {
    db = serverDeps().db;
  } catch {
    // The environment is invalid: the route has answered 500 (and logged it) without a client.
    return;
  }
  try {
    schedule(() => untilIdleConnectionsClosed(db));
  } catch (error: unknown) {
    // `after` outside a request scope, or a platform without `waitUntil`: the connections then
    // close only when the instance runs again. Said once per instance, not once per request.
    if (!warnedNoAfter) {
      warnedNoAfter = true;
      log.warn(
        { err: error },
        "could not keep the instance awake until its database connections close",
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// apiRoute
// ---------------------------------------------------------------------------------------------

/** A route implementation that also receives the server's dependencies. */
export type ApiImplementation<N extends ApiRouteName> = (
  context: RouteContext<N>,
  deps: ServerDeps,
) => Promise<RouteResponse<N>> | RouteResponse<N>;

/**
 * What every file under `app/api` calls instead of `defineRoute`, so that no route can be
 * registered without `API_ROUTE_OPTIONS`. Without an implementation the route answers 501 outside
 * mock mode, as before.
 *
 * Every answer of an implemented route, an error included, is followed by the wait of
 * `keepAwakeUntilConnectionsClose` where the platform freezes instances: the API routes are the
 * only server code of the web app that reaches the database.
 */
export function apiRoute<N extends ApiRouteName>(
  name: N,
  implementation?: ApiImplementation<N>,
): RouteHandler {
  const handler = defineRoute(
    name,
    implementation && ((context: RouteContext<N>) => implementation(context, serverDeps())),
    API_ROUTE_OPTIONS,
  );
  if (!implementation) return handler;
  return async (request, context) => {
    try {
      return await handler(request, context);
    } finally {
      keepAwakeUntilConnectionsClose();
    }
  };
}
