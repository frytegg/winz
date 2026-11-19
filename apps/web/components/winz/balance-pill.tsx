import { ArrowUpRight, Wallet } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "../ui/skeleton";

import { Money } from "./money";

/**
 * The white pill at the top of the merchant screens: the available balance, a lime round arrow, a
 * link to the Balance screen. `micro` is `null` while the balance loads. `compact` swaps the amount
 * for a wallet icon, on the home screen where the balance is already written large right below.
 */
export function BalancePill({
  micro,
  href,
  compact = false,
  label,
}: {
  micro: string | null;
  href: string;
  compact?: boolean;
  /** The accessible name of a compact pill (it has no amount to read). */
  label?: string;
}): React.JSX.Element {
  if (micro === null && !compact) return <Skeleton className="h-11 w-36 rounded-full" />;
  return (
    <Link
      href={href}
      aria-label={compact ? label : undefined}
      className="inline-flex h-11 items-center gap-3 rounded-full bg-white-pill pl-4 pr-1.5 text-body text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
    >
      {compact || micro === null ? (
        <Wallet className="size-5" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Money micro={micro} unitClassName="text-ink" />
      )}
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-lime">
        <ArrowUpRight className="size-4" strokeWidth={1.75} />
      </span>
    </Link>
  );
}
