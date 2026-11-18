"use client";

import { createContext, useContext } from "react";

import type { RouteResponse } from "@/lib/api/client";

/**
 * What a screen knows about the signed-in user. The screens only ever talk to this interface:
 * the simulated provider (`mock-auth-provider.tsx`) and the Privy one (task I-01) both implement
 * it, so swapping them touches no screen.
 */
export type Me = RouteResponse<"me">;
export type MerchantProfile = NonNullable<Me["merchant"]>;

/** `loading` until the stored session (if any) has been checked. */
export type AuthStatus = "loading" | "anonymous" | "authenticated";

export type AuthErrorCode = "invalid_email" | "invalid_code" | "passkey_failed";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface AuthApi {
  status: AuthStatus;
  me: Me | null;
  /** The address a code was just sent to, until it is verified. */
  pendingEmail: string | null;
  /** True for the simulated provider: any 6-digit code works. */
  simulated: boolean;
  /** Whether "Use Face ID instead" can be offered on this device. */
  passkeyAvailable: boolean;
  /** Sends a 6-digit code by e-mail. Throws `AuthError("invalid_email")`. */
  sendCode: (email: string) => Promise<void>;
  /** Checks the code and signs in. Throws `AuthError("invalid_code")`. */
  verifyCode: (code: string) => Promise<Me>;
  loginWithPasskey: () => Promise<Me>;
  signOut: () => Promise<void>;
  /** Reads `GET /api/me` again. */
  refreshMe: () => Promise<Me>;
  /** The merchant just created on M2: the user is a merchant from now on, without another round trip. */
  adoptMerchant: (merchant: MerchantProfile) => void;
}

const AuthContext = createContext<AuthApi | null>(null);

export const AuthContextProvider = AuthContext.Provider;

export function useAuth(): AuthApi {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
