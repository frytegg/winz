import type { ApiRouteName } from "@winz/shared";

import { authenticateRequest } from "./auth";
import { serverDeps, type ServerDeps } from "./deps";
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

/** A route implementation that also receives the server's dependencies. */
export type ApiImplementation<N extends ApiRouteName> = (
  context: RouteContext<N>,
  deps: ServerDeps,
) => Promise<RouteResponse<N>> | RouteResponse<N>;

/**
 * What every file under `app/api` calls instead of `defineRoute`, so that no route can be
 * registered without `API_ROUTE_OPTIONS`. Without an implementation the route answers 501 outside
 * mock mode, as before.
 */
export function apiRoute<N extends ApiRouteName>(
  name: N,
  implementation?: ApiImplementation<N>,
): RouteHandler {
  return defineRoute(
    name,
    implementation && ((context: RouteContext<N>) => implementation(context, serverDeps())),
    API_ROUTE_OPTIONS,
  );
}
