import { describe, expect, it } from "vitest";

import { copy } from "@/lib/copy";

import { AuthError } from "./auth-context";
import { passkeyError, privyErrorCode, sendCodeError, verifyCodeError } from "./privy-errors";

function privyError(privyErrorCode: string): Error {
  return Object.assign(new Error("from privy"), { privyErrorCode });
}

describe("privyErrorCode", () => {
  it("reads the code Privy sets, and nothing from anything else", () => {
    expect(privyErrorCode(privyError("invalid_credentials"))).toBe("invalid_credentials");
    expect(privyErrorCode(new Error("plain"))).toBeNull();
    expect(privyErrorCode("a string")).toBeNull();
    expect(privyErrorCode(null)).toBeNull();
    expect(privyErrorCode({ privyErrorCode: 42 })).toBeNull();
  });
});

describe("sendCodeError", () => {
  it("tells a rate-limited person to wait", () => {
    const error = sendCodeError(privyError("too_many_requests"));
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe("send_failed");
    expect(error.message).toBe(copy.signIn.tooManyTries);
  });

  it("blames the address when Privy refuses it", () => {
    expect(sendCodeError(privyError("disallowed_plus_email")).code).toBe("invalid_email");
    expect(sendCodeError(privyError("invalid_data")).message).toBe(copy.signIn.invalidEmail);
  });

  it("falls back to a plain 'could not send' for anything else", () => {
    expect(sendCodeError(new TypeError("Failed to fetch")).message).toBe(copy.signIn.sendFailed);
  });
});

describe("verifyCodeError", () => {
  it("calls a wrong or used-up code a code that did not work", () => {
    for (const error of [privyError("invalid_credentials"), privyError("invalid_data")]) {
      const result = verifyCodeError(error);
      expect(result.code).toBe("invalid_code");
      expect(result.message).toBe(copy.signIn.wrongCode);
    }
  });

  it("does not blame the code for a rate limit, a lost connection or a refused sign-in", () => {
    expect(verifyCodeError(new TypeError("Failed to fetch")).code).toBe("sign_in_failed");
    expect(verifyCodeError(privyError("too_many_requests")).message).toBe(copy.signIn.tooManyTries);
    expect(verifyCodeError(privyError("allowlist_rejected")).code).toBe("sign_in_failed");
  });
});

describe("passkeyError", () => {
  it("sends the person back to the e-mail code", () => {
    expect(passkeyError().message).toBe(copy.signIn.passkeyFailed);
    expect(passkeyError().code).toBe("passkey_failed");
  });
});
