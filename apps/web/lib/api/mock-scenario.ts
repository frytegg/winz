import { API_ROUTES, type ApiRouteName } from "@winz/shared";

/**
 * Mock scenarios, in development only (`NEXT_PUBLIC_APP_API_MOCK=true`). A scenario is chosen with
 * `?scenario=<name>` in the URL or with the floating picker; it is kept for the browser tab and
 * relayed to the mock API in the `x-mock-scenario` header.
 */

const STORAGE_KEY = "winz.mock-scenario";
const QUERY_KEY = "scenario";

export function isMockApi(): boolean {
  return process.env.NEXT_PUBLIC_APP_API_MOCK === "true";
}

function safeSession(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The scenario asked for by the URL (and remembered), or the one remembered, or `null`. */
export function getMockScenario(): string | null {
  if (!isMockApi() || typeof window === "undefined") return null;
  const session = safeSession();
  const fromUrl = new URLSearchParams(window.location.search).get(QUERY_KEY);
  if (fromUrl !== null) {
    try {
      if (fromUrl === "") session?.removeItem(STORAGE_KEY);
      else session?.setItem(STORAGE_KEY, fromUrl);
    } catch {
      // Storage can be blocked (private window): the scenario then only lives in the URL.
    }
    return fromUrl === "" ? null : fromUrl;
  }
  try {
    return session?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setMockScenario(name: string | null): void {
  const session = safeSession();
  try {
    if (name === null) session?.removeItem(STORAGE_KEY);
    else session?.setItem(STORAGE_KEY, name);
  } catch {
    // See getMockScenario.
  }
}

/**
 * Scenarios that only the mock API knows: they answer an error, not an example, so they are not in
 * `API_ROUTES` (the back keeps them in `MOCK_REFUSALS`). The front lists them to be able to ask for
 * them: a fan refused at checkout because the promo paused or closed in the meantime.
 */
const MOCK_REFUSALS: Partial<Record<ApiRouteName, readonly string[]>> = {
  checkout: ["salesPaused", "salesClosed"],
};

/** The scenario to send for `route`: only when that route has an example or a refusal of this name. */
export function scenarioFor(route: ApiRouteName, scenario: string | null): string | null {
  if (scenario === null) return null;
  const known =
    Object.prototype.hasOwnProperty.call(API_ROUTES[route].examples, scenario) ||
    (MOCK_REFUSALS[route]?.includes(scenario) ?? false);
  return known ? scenario : null;
}

/** Every scenario name of every route, for the picker. */
export function allScenarioNames(): string[] {
  const names = new Set<string>();
  for (const [name, route] of Object.entries(API_ROUTES)) {
    for (const scenario of Object.keys(route.examples)) names.add(scenario);
    for (const scenario of MOCK_REFUSALS[name as ApiRouteName] ?? []) names.add(scenario);
  }
  names.delete("default");
  return [...names].sort();
}
