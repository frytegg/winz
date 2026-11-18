import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "../ui/skeleton";

import { Money } from "./money";

/**
 * The white pill at the top of the merchant screens: the available balance, a lime round arrow, a
 * link to the Balance screen. `micro` is `null` while the balance loads.
 */
export function BalancePill({
  micro,
  href,
}: {
  micro: string | null;
  href: string;
}): React.JSX.Element {
  if (micro === null) return <Skeleton className="h-11 w-36 rounded-full" />;
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center gap-3 rounded-full bg-white-pill pl-4 pr-1.5 text-body text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
    >
      <Money micro={micro} unitClassName="text-ink" />
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-lime">
        <ArrowUpRight className="size-4" strokeWidth={1.75} />
      </span>
    </Link>
  );
}
