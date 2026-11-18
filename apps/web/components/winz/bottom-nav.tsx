"use client";

import { ChartColumn, House, Plus, Ticket, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** The merchant's four tabs. The wallet icon opens "Balance": the balance, top-ups and settings. */
export const MERCHANT_NAV: readonly NavItem[] = [
  { href: "/home", label: copy.nav.home, icon: House },
  { href: "/campaigns", label: copy.nav.promos, icon: Ticket },
  { href: "/stats", label: copy.nav.stats, icon: ChartColumn },
  { href: "/balance", label: copy.nav.balance, icon: Wallet },
];

/**
 * The floating navigation (MASTER section 5): a white pill with the active tab as a lime round
 * that overflows it, and a round lime "+" for a new promo. Fixed at the bottom of the column,
 * above the home indicator. Screens add the `pb-nav` class so nothing hides behind it.
 */
export function BottomNav({
  items = MERCHANT_NAV,
  newHref = "/new",
  activeHref,
}: {
  items?: readonly NavItem[];
  /** Where the "+" goes; `null` hides it. */
  newHref?: string | null;
  /** Force the active tab (the kit page); otherwise it follows the URL. */
  activeHref?: string;
}): React.JSX.Element {
  const pathname = usePathname();
  const current = activeHref ?? pathname;
  return (
    <nav
      aria-label={copy.nav.main}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[430px] items-center gap-3 bg-gradient-to-t from-ink via-ink/85 to-transparent px-4 pb-[max(1rem,var(--safe-bottom))] pt-8"
    >
      <ul className="pointer-events-auto flex h-[76px] min-w-0 flex-1 items-center rounded-full bg-white-pill px-1">
        {items.map((item) => {
          const active = current === item.href || current.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex min-w-0 flex-1 justify-center">
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid aspect-square w-full max-w-16 place-items-center rounded-full text-ink/60 transition-[transform,background-color,color] duration-200 ease-out active:scale-[0.94]",
                  active && "bg-lime text-ink",
                )}
              >
                <item.icon className="size-6" strokeWidth={1.5} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      {newHref === null ? null : (
        <Link
          href={newHref}
          aria-label={copy.nav.newPromo}
          className="pointer-events-auto grid size-[76px] shrink-0 place-items-center rounded-full bg-lime text-ink transition-[transform,background-color] duration-150 ease-out hover:bg-lime-press active:scale-[0.94]"
        >
          <Plus className="size-8" strokeWidth={1.5} aria-hidden="true" />
        </Link>
      )}
    </nav>
  );
}
