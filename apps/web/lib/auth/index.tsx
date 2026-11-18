"use client";

import type { ReactNode } from "react";

import { MockAuthProvider } from "./mock-auth-provider";

export {
  AuthError,
  useAuth,
  type AuthApi,
  type AuthStatus,
  type Me,
  type MerchantProfile,
} from "./auth-context";
export { useRouteGuard, resolveGuard, type RouteNeed } from "./route-guard";

/**
 * The one place that decides which sign-in the app uses. Empty `NEXT_PUBLIC_PRIVY_APP_ID`: the
 * simulated one. With a value, the Privy provider of task I-01 must be mounted here: until it
 * exists, failing loudly beats silently signing a real user in with a fake code.
 */
export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  if (privyAppId.trim() === "") return <MockAuthProvider>{children}</MockAuthProvider>;
  throw new Error(
    "NEXT_PUBLIC_PRIVY_APP_ID is set, but the Privy sign-in is not wired yet (task I-01). " +
      "Leave it empty to use the simulated sign-in.",
  );
}
