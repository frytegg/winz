"use client";

import { User } from "lucide-react";
import type { ReactNode } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

import { BalancePill } from "./balance-pill";

/**
 * The header of the merchant space: the balance pill (a link to Balance) on the left and the round
 * avatar (a link to the settings) on the right. The notification bell of the mockups is left out
 * until notifications exist (U-10, SCREENS "En-tête commun").
 */
export function MerchantHeader({
  compactPill = false,
  sticky = false,
  className,
}: {
  /** Home writes the balance large below, so its pill only carries the wallet icon. */
  compactPill?: boolean;
  /**
   * Stays at the top while the screen scrolls, over a fade into the background, as on the mockups
   * (MD). It must sit directly in a column with 20px side padding. The fade lets taps through.
   */
  sticky?: boolean;
  className?: string;
}): React.JSX.Element {
  const { me } = useAuth();
  const available = me?.balance?.available ?? "0";
  return (
    <header
      className={cn(
        "flex items-center justify-between",
        sticky &&
          "pointer-events-none sticky top-0 z-30 -mx-5 bg-gradient-to-b from-ink from-70% to-transparent px-5 pb-5 pt-[calc(var(--safe-top)+1.25rem)] [&_a]:pointer-events-auto",
        className,
      )}
    >
      <BalancePill
        micro={me === null ? null : available}
        href="/balance"
        compact={compactPill}
        label={copy.nav.balance}
      />
      <IconButton
        icon={User}
        label={copy.merchantSpace.account}
        tone="white"
        href="/settings"
        className="size-11"
      />
    </header>
  );
}

/**
 * The frame of a merchant screen that is not the home: the header, then the content in a column
 * with the room the floating navigation needs.
 */
export function MerchantFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col px-5 pb-nav">
      <MerchantHeader sticky />
      <main className={cn("flex flex-1 flex-col gap-6", className)}>{children}</main>
    </div>
  );
}
