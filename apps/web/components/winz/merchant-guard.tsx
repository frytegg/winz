"use client";

import type { ReactNode } from "react";

import { Splash } from "@/components/ui/splash";
import { useRouteGuard } from "@/lib/auth";

import { BottomNav } from "./bottom-nav";

/**
 * The layout of every screen of the merchant space (home, promos, stats, balance, settings): the
 * route guard of BRIEF section 7 (not signed in → /start, no business yet → /business) and the
 * floating navigation, which stays in place while the screens change.
 */
export function MerchantGuard({ children }: { children: ReactNode }): React.JSX.Element {
  const ready = useRouteGuard("merchant");
  if (!ready) return <Splash />;
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}
