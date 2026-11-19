"use client";

import type { ReactNode } from "react";

import { AuthContextProvider, type AuthApi } from "./auth-context";

/**
 * The auth context of the pages that need no sign-in (a fan's campaign page and ticket). Nobody is
 * signed in there and nothing can sign in, so the Privy SDK is not loaded at all (see
 * `isSignInFreePath`). A screen that asked to sign in here would be a mistake: it fails loudly.
 */

function unavailable(): Promise<never> {
  return Promise.reject(new Error("Signing in is not available on this page."));
}

const SIGNED_OUT: AuthApi = {
  status: "anonymous",
  me: null,
  pendingEmail: null,
  simulated: false,
  passkeyAvailable: false,
  sendCode: unavailable,
  verifyCode: unavailable,
  loginWithPasskey: unavailable,
  signOut: () => Promise.resolve(),
  refreshMe: unavailable,
  reconnect: () => undefined,
  adoptMerchant: () => undefined,
};

export function SignedOutAuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <AuthContextProvider value={SIGNED_OUT}>{children}</AuthContextProvider>;
}
