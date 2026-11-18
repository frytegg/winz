import { formatMoney, formatMoneyCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * An amount with its `$` in lime and its digits in white (MASTER section 3). `micro` is the string
 * the API sends. `compact` drops ".00" ("$1,000").
 */
export function Money({
  micro,
  compact = false,
  className,
  unitClassName,
}: {
  micro: string | bigint;
  compact?: boolean;
  className?: string;
  unitClassName?: string;
}): React.JSX.Element {
  const text = compact ? formatMoneyCompact(micro) : formatMoney(micro);
  const negative = text.startsWith("-");
  const digits = text.slice(negative ? 2 : 1);
  return (
    <span className={cn("figures", className)} aria-label={text}>
      <span aria-hidden="true">
        {negative ? "-" : ""}
        <span className={cn("text-lime", unitClassName)}>$</span>
        {digits}
      </span>
    </span>
  );
}
