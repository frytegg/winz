/**
 * Which sign-in the app runs on. One pure function, so each case can be tested.
 *
 * - The mock API is on (`NEXT_PUBLIC_APP_API_MOCK=true`): the simulated sign-in, whatever else is
 *   set. Every screen stays testable without Privy, and a mock API would not accept a Privy token.
 * - The mock API is off and `NEXT_PUBLIC_PRIVY_APP_ID` is set: Privy.
 * - The mock API is off and there is no app id: nothing can sign anybody in. That is a deployment
 *   mistake, so it is reported (`misconfigured`) instead of quietly falling back to a fake sign-in
 *   that a real user could walk through with any code.
 */
export type AuthProviderChoice =
  | { kind: "simulated" }
  | { kind: "privy"; appId: string }
  | { kind: "misconfigured"; reason: string };

export interface AuthEnvironment {
  mockApi: boolean;
  privyAppId: string | undefined;
}

export function chooseAuthProvider(env: AuthEnvironment): AuthProviderChoice {
  if (env.mockApi) return { kind: "simulated" };
  const appId = (env.privyAppId ?? "").trim();
  if (appId === "") {
    return {
      kind: "misconfigured",
      reason:
        "NEXT_PUBLIC_PRIVY_APP_ID is empty and the mock API is off, so nobody can sign in. " +
        "Set the Privy app id, or set NEXT_PUBLIC_APP_API_MOCK=true to use the simulated sign-in.",
    };
  }
  return { kind: "privy", appId };
}

/**
 * Pages that never ask for a sign-in: what a fan opens from a shared link or a QR code (SPEC, C1 to C3),
 * and the public Hedge desk the jury opens (MDB-3).
 */
const SIGN_IN_FREE_PREFIXES = ["/c/", "/t/", "/hedge-desk"] as const;

/**
 * True for the pages that need no sign-in at all. The Privy SDK is not even loaded there: a fan
 * who scans a QR code goes straight to the payment, and the SDK would only add weight and requests
 * to that path (the journey from scan to ticket has a 30-second budget).
 */
export function isSignInFreePath(pathname: string | null): boolean {
  if (pathname === null) return false;
  return SIGN_IN_FREE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
