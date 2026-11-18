import { copy } from "@/lib/copy";

import { AuthError } from "./auth-context";

/** The `privyErrorCode` Privy puts on its errors, when there is one. */
export function privyErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("privyErrorCode" in error)) return null;
  const code = (error as { privyErrorCode?: unknown }).privyErrorCode;
  return typeof code === "string" ? code : null;
}

/** `sendCode` failed: say what the person can do about it. */
export function sendCodeError(error: unknown): AuthError {
  const code = privyErrorCode(error);
  if (code === "too_many_requests") return new AuthError("send_failed", copy.signIn.tooManyTries);
  if (code === "disallowed_plus_email" || code === "invalid_data") {
    return new AuthError("invalid_email", copy.signIn.invalidEmail);
  }
  return new AuthError("send_failed", copy.signIn.sendFailed);
}

/**
 * `loginWithCode` failed. A wrong, an expired and a used-up code (Privy accepts 5 tries per code)
 * all end the same way for the person: ask for a new one. Anything else (no network, a refused
 * sign-in) is not about the code and says so.
 */
export function verifyCodeError(error: unknown): AuthError {
  const code = privyErrorCode(error);
  if (code === "invalid_credentials" || code === "invalid_data") {
    return new AuthError("invalid_code", copy.signIn.wrongCode);
  }
  if (code === "too_many_requests") return new AuthError("send_failed", copy.signIn.tooManyTries);
  return new AuthError("sign_in_failed", copy.signIn.signInFailed);
}

/** A passkey failure, whatever the cause: the person falls back to the e-mail code. */
export function passkeyError(): AuthError {
  return new AuthError("passkey_failed", copy.signIn.passkeyFailed);
}
