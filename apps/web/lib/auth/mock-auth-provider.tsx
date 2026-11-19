"use client";

import { API_ROUTES, type ApiRouteName } from "@winz/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";

import {
  apiFetch,
  isAbortError,
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
import { loadMeWithRetry, MeLoadError, waitMs } from "./me-retry";
import { UnreachableGate } from "./unreachable-gate";

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
  /** The load of `GET /api/me` in progress, cancelled when a newer one starts or on unmount. */
  const loading = useRef<AbortController | null>(null);

  /**
   * `GET /api/me` with the retries of `me-retry.ts`: a 401 or a 403 ends the session, anything else
   * keeps it and ends `unreachable` (review 2.2). Resolves `null` when a newer load replaced it.
   * A sign-in keeps its screen meanwhile (`showLoading` false): the code screen shows its own wait.
   */
  const loadSession = useCallback(async (showLoading: boolean): Promise<Me | null> => {
    loading.current?.abort();
    const controller = new AbortController();
    loading.current = controller;
    if (showLoading) setStatus("loading");
    try {
      const next = await loadMeWithRetry(fetchMe, { sleep: waitMs, signal: controller.signal });
      if (controller.signal.aborted) return null;
      setMe(next);
      setStatus("authenticated");
      return next;
    } catch (error: unknown) {
      if (controller.signal.aborted || isAbortError(error)) return null;
      if (error instanceof MeLoadError && error.failure === "anonymous") {
        signedIn.current = false;
        writeStorage(SESSION_KEY, null);
        setMe(null);
        setStatus("anonymous");
      } else {
        setStatus("unreachable");
      }
      throw error;
    }
  }, []);

  const finishSignIn = useCallback(async (): Promise<Me> => {
    signedIn.current = true;
    try {
      const next = await loadSession(false);
      if (next === null) throw new AuthError("sign_in_failed", copy.signIn.signInFailed);
      setPendingEmail(null);
      return next;
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("sign_in_failed", copy.signIn.signInFailed);
    }
  }, [loadSession]);

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

    if (readStorage(SESSION_KEY) === null) {
      setStatus("anonymous");
    } else {
      signedIn.current = true;
      // An expired session (401, 403) starts from the sign-in screen; an API that does not answer
      // keeps the session and ends on « can't reach Winz » (`loadSession`).
      loadSession(true).catch(() => undefined);
    }
    return () => {
      loading.current?.abort();
      setAccessTokenProvider(null);
      setUnauthenticatedHandler(null);
    };
  }, [router, loadSession]);

  const sendCode = useCallback(async (email: string): Promise<void> => {
    const address = email.trim();
    if (!emailCheck.safeParse(address).success) {
      throw new AuthError("invalid_email", copy.signIn.invalidEmail);
    }
    await wait(SIMULATED_LATENCY_MS);
    // A real send needs the network: offline, the simulated one fails the same way.
    if (!window.navigator.onLine) throw new AuthError("send_failed", copy.signIn.sendFailed);
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
    loading.current?.abort();
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

  const reconnect = useCallback((): void => {
    loadSession(true).catch(() => undefined);
  }, [loadSession]);

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
      reconnect,
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
      reconnect,
      adoptMerchant,
    ],
  );

  return (
    <AuthContextProvider value={value}>
      <UnreachableGate>{children}</UnreachableGate>
    </AuthContextProvider>
  );
}
