"use client";

import {
  PrivyProvider,
  useCreateWallet,
  useLoginWithEmail,
  useLoginWithPasskey,
  usePrivy,
} from "@privy-io/react-auth";
import { API_ROUTES, type ApiRouteName } from "@winz/shared";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import {
  ApiError,
  apiFetch,
  errorMessage,
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
import { privyClientConfig } from "./privy-config";
import { passkeyError, sendCodeError, verifyCodeError } from "./privy-errors";
import { hasEthereumEmbeddedWallet, isWalletAlreadyThere } from "./privy-wallet";

/**
 * The real sign-in (task I-01), on Privy: an e-mail and a 6-digit code, or a passkey. The screens
 * only know `AuthApi`, exactly as with the simulated provider (`mock-auth-provider.tsx`).
 *
 * - Nothing of Privy is shown: no modal, no wallet screen. The code is typed on M1, and the
 *   embedded wallet is created by Privy at the first sign-in (`privy-config.ts`).
 * - The Privy access token leaves as `Authorization: Bearer …` on every `user` and `merchant`
 *   route, through `setAccessTokenProvider` and `apiFetch`. The server checks it
 *   (`lib/server/privy.ts`); this file never decides who someone is, `GET /api/me` does.
 * - Privy keeps the session (its own storage), so a reload signs the person back in by itself.
 */

const emailCheck = z.email();

export function PrivyAuthProvider({
  appId,
  children,
}: {
  appId: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <PrivyProvider appId={appId} config={privyClientConfig}>
      <PrivyAuthBridge>{children}</PrivyAuthBridge>
    </PrivyProvider>
  );
}

function hasPasskeySupport(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

function PrivyAuthBridge({ children }: { children: ReactNode }): React.JSX.Element {
  const router = useRouter();
  const privy = usePrivy();
  const emailLogin = useLoginWithEmail();
  const passkeyLogin = useLoginWithPasskey();
  const walletCreation = useCreateWallet();

  const [me, setMe] = useState<Me | null>(null);
  /** `GET /api/me` failed while Privy still holds a session: back to the sign-in screen. */
  const [meFailed, setMeFailed] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  // Decided after the first render: the server cannot know whether this browser has passkeys.
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  // The latest Privy functions, read from callbacks that must keep one identity.
  const sdk = useRef({
    authenticated: privy.authenticated,
    user: privy.user,
    createWallet: walletCreation.createWallet,
    getAccessToken: privy.getAccessToken,
    logout: privy.logout,
    sendCode: emailLogin.sendCode,
    loginWithCode: emailLogin.loginWithCode,
    loginWithPasskey: passkeyLogin.loginWithPasskey,
  });
  useEffect(() => {
    sdk.current = {
      authenticated: privy.authenticated,
      user: privy.user,
      createWallet: walletCreation.createWallet,
      getAccessToken: privy.getAccessToken,
      logout: privy.logout,
      sendCode: emailLogin.sendCode,
      loginWithCode: emailLogin.loginWithCode,
      loginWithPasskey: passkeyLogin.loginWithPasskey,
    };
  });

  useEffect(() => {
    setPasskeyAvailable(hasPasskeySupport());
  }, []);

  // Whether this session's wallet is known to exist, so that it is looked for once, not at every `/api/me`.
  const walletReady = useRef(false);
  /**
   * Every signed-in person has an Ethereum wallet, created here, awaited, and never shown: the
   * escrow pays refunds and merchants to it. Privy's own `createOnLogin` is also set, but it runs
   * after the sign-in and is lost if the page moves on first (seen in the real test of I-01), so
   * the sign-in is not finished until the wallet exists. A wallet that already exists is fine.
   */
  const ensureWallet = useCallback(async (): Promise<void> => {
    if (walletReady.current) return;
    const accounts = sdk.current.user?.linkedAccounts ?? [];
    if (!hasEthereumEmbeddedWallet(accounts)) {
      try {
        await sdk.current.createWallet();
      } catch (error: unknown) {
        if (!isWalletAlreadyThere(error)) throw error;
      }
    }
    walletReady.current = true;
  }, []);

  // One `GET /api/me` at a time: a sign-in and the restore of the session would both ask for it.
  const inflight = useRef<Promise<Me> | null>(null);
  const loadMe = useCallback((): Promise<Me> => {
    if (inflight.current !== null) return inflight.current;
    const request = ensureWallet()
      .then(() => apiFetch("me"))
      .then(
        (next) => {
          setMe(next);
          setMeFailed(false);
          return next;
        },
        (error: unknown) => {
          setMeFailed(true);
          throw error;
        },
      )
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = request;
    return request;
  }, []);

  // Wire the API client to Privy. A layout effect, so that it is in place before the passive
  // effects of the screens below start their first requests.
  useLayoutEffect(() => {
    setAccessTokenProvider(() =>
      // No token (Privy cannot be reached): the request goes out without one and the API answers
      // 401, which signs the person out below. Better than a raw error inside a screen.
      sdk.current.getAccessToken().catch(() => null),
    );
    setUnauthenticatedHandler((route: ApiRouteName) => {
      if (API_ROUTES[route].auth !== "merchant") return;
      void sdk.current.logout();
      setMe(null);
      router.replace("/start");
    });
    return () => {
      setAccessTokenProvider(null);
      setUnauthenticatedHandler(null);
    };
  }, [router]);

  // A session Privy kept from an earlier visit, or the one that has just been opened.
  const { ready, authenticated } = privy;
  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      walletReady.current = false;
      setMe(null);
      setMeFailed(false);
      return;
    }
    loadMe().catch((error: unknown) => {
      // An expired session: end it, so that the next visit starts from the sign-in screen.
      if (error instanceof ApiError && error.status === 401) void sdk.current.logout();
    });
  }, [ready, authenticated, loadMe]);

  /** A person who is signed in at Privy but not for us (`/api/me` failed) starts from scratch. */
  const endStaleSession = useCallback(async (): Promise<void> => {
    if (sdk.current.authenticated) await sdk.current.logout();
  }, []);

  const finishSignIn = useCallback(async (): Promise<Me> => {
    try {
      const next = await loadMe();
      setPendingEmail(null);
      return next;
    } catch (error: unknown) {
      await sdk.current.logout();
      throw new AuthError("sign_in_failed", errorMessage(error, copy.signIn.signInFailed));
    }
  }, [loadMe]);

  const sendCode = useCallback(
    async (email: string): Promise<void> => {
      const address = email.trim();
      if (!emailCheck.safeParse(address).success) {
        throw new AuthError("invalid_email", copy.signIn.invalidEmail);
      }
      await endStaleSession();
      try {
        await sdk.current.sendCode({ email: address });
      } catch (error: unknown) {
        throw sendCodeError(error);
      }
      setPendingEmail(address);
    },
    [endStaleSession],
  );

  const verifyCode = useCallback(
    async (code: string): Promise<Me> => {
      try {
        await sdk.current.loginWithCode({ code });
      } catch (error: unknown) {
        throw verifyCodeError(error);
      }
      return finishSignIn();
    },
    [finishSignIn],
  );

  const loginWithPasskey = useCallback(async (): Promise<Me> => {
    await endStaleSession();
    try {
      await sdk.current.loginWithPasskey();
    } catch {
      throw passkeyError();
    }
    return finishSignIn();
  }, [endStaleSession, finishSignIn]);

  const signOut = useCallback(async (): Promise<void> => {
    await sdk.current.logout();
    setMe(null);
    setPendingEmail(null);
  }, []);

  const refreshMe = useCallback((): Promise<Me> => loadMe(), [loadMe]);

  const adoptMerchant = useCallback((merchant: MerchantProfile): void => {
    setMe((current) => (current === null ? current : withMerchant(current, merchant)));
  }, []);

  let status: AuthStatus = "loading";
  if (ready) {
    if (!authenticated || (me === null && meFailed)) status = "anonymous";
    else if (me !== null) status = "authenticated";
  }

  const value = useMemo<AuthApi>(
    () => ({
      status,
      me: authenticated ? me : null,
      pendingEmail,
      simulated: false,
      passkeyAvailable,
      sendCode,
      verifyCode,
      loginWithPasskey,
      signOut,
      refreshMe,
      adoptMerchant,
    }),
    [
      status,
      authenticated,
      me,
      pendingEmail,
      passkeyAvailable,
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
