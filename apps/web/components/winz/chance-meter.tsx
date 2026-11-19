import { copy } from "@/lib/copy";
import { bpsToWholePercent } from "@/lib/format";

/**
 * The small gauge of M6: how likely the promo is to be free right now (the lime fill) against the
 * level where it pauses (the white tick). When the fill reaches the tick the promo stops selling.
 */
export function ChanceMeter({
  currentBps,
  thresholdBps,
  subject,
}: {
  /** `null` without a fresh quote: the fill is hidden. */
  currentBps: number | null;
  thresholdBps: number;
  /** The team the promo is about ("Texas"); `null` for a total or a draw. */
  subject: string | null;
}): React.JSX.Element {
  const clamp = (bps: number): number => Math.min(100, Math.max(0, bps / 100));
  const summary =
    currentBps === null
      ? copy.margin.pauses(subject, bpsToWholePercent(thresholdBps))
      : `${copy.margin.currentChance} ${bpsToWholePercent(currentBps).toString()}%. ${copy.margin.pausesAt(bpsToWholePercent(thresholdBps))}`;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={summary}
        className="relative h-2 w-full rounded-full bg-card-raised"
      >
        {currentBps === null ? null : (
          <div
            className="absolute inset-0 origin-left rounded-full bg-lime transition-transform duration-400 ease-out"
            style={{ transform: `scaleX(${(clamp(currentBps) / 100).toString()})` }}
          />
        )}
        <div
          className="absolute -inset-y-1 w-0.5 rounded-full bg-white-pill"
          style={{ left: `calc(${clamp(thresholdBps).toString()}% - 1px)` }}
        />
      </div>
      <div aria-hidden="true" className="figures flex justify-between text-caption text-muted">
        <span>
          {currentBps === null
            ? null
            : `${copy.margin.currentChance} ${bpsToWholePercent(currentBps).toString()}%`}
        </span>
        <span>{copy.margin.pausesAt(bpsToWholePercent(thresholdBps))}</span>
      </div>
    </div>
  );
}
