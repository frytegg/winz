"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { isMockApi } from "@/lib/api/mock-scenario";
import { copy } from "@/lib/copy";

import { MockAuthProvider } from "./mock-auth-provider";
import { chooseAuthProvider, isSignInFreePath } from "./provider-choice";
import { SignedOutAuthProvider } from "./signed-out-auth-provider";

export {
  AuthError,
  useAuth,
  type AuthApi,
  type AuthStatus,
  type Me,
  type MerchantProfile,
} from "./auth-context";
export { useRouteGuard, resolveGuard, type RouteNeed } from "./route-guard";

// A separate chunk: the Privy SDK is large and the simulated sign-in, or a fan's page, never uses it.
const PrivyAuthProvider = dynamic(() =>
  import("./privy-auth-provider").then((module) => module.PrivyAuthProvider),
);

/**
 * The one place that decides which sign-in the app uses (`chooseAuthProvider`): the simulated one
 * while the mock API is on, Privy otherwise. A fan's pages (C1, C3) need no sign-in and never load
 * Privy. Privy without an app id is refused on every page that needs a sign-in: a visible message,
 * and the reason (it names the variables, never a value) in the page outside production. It is not
 * a `throw`: `next build` renders every static page, and the CI builds without any variable.
 */
export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const pathname = usePathname();
  const choice = chooseAuthProvider({
    mockApi: isMockApi(),
    privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  });

  if (choice.kind === "simulated") return <MockAuthProvider>{children}</MockAuthProvider>;
  if (isSignInFreePath(pathname)) return <SignedOutAuthProvider>{children}</SignedOutAuthProvider>;
  if (choice.kind === "misconfigured") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col justify-center px-6">
        <EmptyState title={copy.signIn.unavailable} />
        {process.env.NODE_ENV === "production" ? null : (
          <p role="alert" className="mt-4 text-caption text-muted">
            {choice.reason}
          </p>
        )}
      </main>
    );
  }
  return <PrivyAuthProvider appId={choice.appId}>{children}</PrivyAuthProvider>;
}
