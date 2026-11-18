import { Check } from "lucide-react";

import { copy } from "@/lib/copy";
import { bpsToWholePercent } from "@/lib/format";
import { cn } from "@/lib/utils";

import { LimePercent } from "../ui/lime-percent";

interface PromoCardProps {
  /** The card's rule line: the template's `headline` ("Free if Texas wins by 14+"). */
  headline: string;
  refundBps: number;
  /** What the promo costs per sale, as a share of the price. `null` without a quote. */
  costBps: number | null;
  /** The chance it is free. `null` without a quote. */
  probabilityBps: number | null;
  recommended?: boolean;
  selected?: boolean;
  /** Not available: greyed out, not tappable, with the reason. */
  unavailableReason?: "no_book" | "stale_book" | null;
  onSelect?: () => void;
  className?: string;
}

/** A ready-made promo for a game (M4): "100% back", the rule, what it costs, how likely it is. */
export function PromoCard({
  headline,
  refundBps,
  costBps,
  probabilityBps,
  recommended = false,
  selected = false,
  unavailableReason = null,
  onSelect,
  className,
}: PromoCardProps): React.JSX.Element {
  const disabled = unavailableReason !== null;
  const title = copy.pickPromo.back(bpsToWholePercent(refundBps));
  const muted = selected ? "text-ink/70" : "text-muted";

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-title">
          <LimePercent text={title} tone={selected ? "ink" : "lime"} />
        </h3>
        {recommended && !disabled ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-caption",
              selected ? "bg-ink text-lime" : "bg-lime text-ink",
            )}
          >
            <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
            {copy.pickPromo.recommended}
          </span>
        ) : null}
      </div>
      <p className={cn("mt-2 text-body", muted)}>{headline}</p>
      <div className="mt-4 flex flex-col gap-1.5 text-body">
        {costBps === null ? null : (
          <span className="figures">{copy.pickPromo.cost(bpsToWholePercent(costBps))}</span>
        )}
        {probabilityBps === null ? null : (
          <span className="figures">
            {copy.pickPromo.chance(bpsToWholePercent(probabilityBps))}
          </span>
        )}
        {disabled ? (
          <span className={muted}>
            {unavailableReason === "stale_book" ? copy.pickPromo.staleBook : copy.pickPromo.noBook}
          </span>
        ) : null}
      </div>
    </>
  );

  const classes = cn(
    "block w-full rounded-card-sm p-5 text-left",
    "transition-[transform,background-color,color,opacity] duration-180 ease-out",
    selected ? "scale-[1.01] bg-lime text-ink" : "bg-card-raised text-text",
    disabled && "opacity-40",
    className,
  );

  if (onSelect === undefined || disabled) {
    return (
      <div className={classes} aria-disabled={disabled || undefined}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(classes, "active:scale-[0.985]")}
    >
      {content}
    </button>
  );
}
