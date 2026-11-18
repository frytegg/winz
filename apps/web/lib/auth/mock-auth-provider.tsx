"use client";

import { API_ROUTES, type ApiRouteName } from "@winz/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";

import {
  ApiError,
  apiFetch,
  setAccessTokenProvider,
  setUnauthenticatedHandler,
} from "@/lib/api/client";
import { copy } from "@/lib/copy";

import {
  AuthContextProvider,
  AuthError,
  type AuthApi,
  type AuthStatus,
  type Me,
  type MerchantProfile,
} from "./auth-context";
import { withMerchant } from "./me";

/**
 * The simulated sign-in, used while the mock API is on (`NEXT_PUBLIC_APP_API_MOCK=true`, see
 * `provider-choice.ts`). It pretends to send and to
 * check a 6-digit code: any code works, except `000000`, which is refused so the error state can
 * be seen. The session lives in `localStorage`.
 *
 * The mock API has no memory (SPEC: "Elle n'a pas d'état"), so a merchant created on M2 would be
 * forgotten by the next `GET /api/me`. The merchant is therefore also kept here and laid over the
 * answer, which lets the whole journey be walked with `?scenario=newUser`.
 */

export const REFUSED_CODE = "000000";

const SESSION_KEY = "winz.sim-session";
const MERCHANT_KEY = "winz.sim-merchant";
const SIMULATED_LATENCY_MS = 600;

const emailCheck = z.email();

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked (private window): the session then lasts until the page is reloaded.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const merchantCache = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(["bar", "pizza", "burger", "retail", "other"]),
  logoUrl: z.string().nullable(),
  defaultUsualMarginBps: z.number().int(),
});

function storedMerchant(): MerchantProfile | null {
  const raw = readStorage(MERCHANT_KEY);
  if (raw === null) return null;
  try {
    const parsed = merchantCache.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as MerchantProfile) : null;
  } catch {
    return null;
  }
}

/** `GET /api/me`, with the merchant of this browser laid over it when the API does not know it. */
async function fetchMe(): Promise<Me> {
  const me = await apiFetch("me");
  if (me.merchant !== null) return me;
  const stored = storedMerchant();
  return stored === null ? me : withMerchant(me, stored);
}

export function MockAuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const signedIn = useRef(false);

  const finishSignIn = useCallback(async (): Promise<Me> => {
    signedIn.current = true;
    const next = await fetchMe();
    setMe(next);
    setPendingEmail(null);
    setStatus("authenticated");
    return next;
  }, []);

  // Restore the session, and wire the API client to it.
  useEffect(() => {
    setAccessTokenProvider(() => Promise.resolve(signedIn.current ? "simulated-session" : null));
    setUnauthenticatedHandler((route: ApiRouteName) => {
      if (API_ROUTES[route].auth !== "merchant") return;
      signedIn.current = false;
      writeStorage(SESSION_KEY, null);
      setMe(null);
      setStatus("anonymous");
      router.replace("/start");
    });

    let cancelled = false;
    if (readStorage(SESSION_KEY) === null) {
      setStatus("anonymous");
    } else {
      signedIn.current = true;
      fetchMe().then(
        (restored) => {
          if (cancelled) return;
          setMe(restored);
          setStatus("authenticated");
        },
        (error: unknown) => {
          if (cancelled) return;
          // An expired session (401) or an unreachable API: start from the sign-in screen.
          signedIn.current = false;
          if (error instanceof ApiError && error.status === 401) writeStorage(SESSION_KEY, null);
          setStatus("anonymous");
        },
      );
    }
    return () => {
      cancelled = true;
      setAccessTokenProvider(null);
      setUnauthenticatedHandler(null);
    };
  }, [router]);

  const sendCode = useCallback(async (email: string): Promise<void> => {
    const address = email.trim();
    if (!emailCheck.safeParse(address).success) {
      throw new AuthError("invalid_email", copy.signIn.invalidEmail);
    }
    await wait(SIMULATED_LATENCY_MS);
    setPendingEmail(address);
  }, []);

  const verifyCode = useCallback(
    async (code: string): Promise<Me> => {
      await wait(SIMULATED_LATENCY_MS);
      if (!/^\d{6}$/.test(code) || code === REFUSED_CODE) {
        throw new AuthError("invalid_code", copy.signIn.wrongCode);
      }
      writeStorage(SESSION_KEY, JSON.stringify({ at: Date.now() }));
      return finishSignIn();
    },
    [finishSignIn],
  );

  const loginWithPasskey = useCallback(async (): Promise<Me> => {
    await wait(SIMULATED_LATENCY_MS + 200);
    writeStorage(SESSION_KEY, JSON.stringify({ at: Date.now() }));
    return finishSignIn();
  }, [finishSignIn]);

  const signOut = useCallback((): Promise<void> => {
    signedIn.current = false;
    writeStorage(SESSION_KEY, null);
    writeStorage(MERCHANT_KEY, null);
    setMe(null);
    setPendingEmail(null);
    setStatus("anonymous");
    return Promise.resolve();
  }, []);

  const refreshMe = useCallback(async (): Promise<Me> => {
    const next = await fetchMe();
    setMe(next);
    return next;
  }, []);

  const adoptMerchant = useCallback((merchant: MerchantProfile): void => {
    writeStorage(MERCHANT_KEY, JSON.stringify(merchant));
    setMe((current) => (current === null ? current : withMerchant(current, merchant)));
  }, []);

  const value = useMemo<AuthApi>(
    () => ({
      status,
      me,
      pendingEmail,
      simulated: true,
      passkeyAvailable: true,
      sendCode,
      verifyCode,
      loginWithPasskey,
      signOut,
      refreshMe,
      adoptMerchant,
    }),
    [
      status,
      me,
      pendingEmail,
      sendCode,
      verifyCode,
      loginWithPasskey,
      signOut,
      refreshMe,
      adoptMerchant,
    ],
  );

  return <AuthContextProvider value={value}>{children}</AuthContextProvider>;
}
