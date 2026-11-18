import { MapPin } from "lucide-react";

import { Card } from "../ui/card";
import { Countdown } from "../ui/countdown";
import { LimePercent } from "../ui/lime-percent";

interface CampaignHeroProps {
  /** "100% back if Texas wins by 14+" (the API's `promise`). Shown in capitals. */
  promise: string;
  merchantName: string;
  /** The pill: "Live campaign", "Paused"… */
  statusLabel: string;
  /** Whether the dot pulses (a live campaign). */
  pulsing?: boolean;
  /** Sales close time; omit to hide the countdown. */
  closesAt?: string;
}

/** The merchant's campaign card: status, countdown to the end of sales, the promise, the venue. */
export function CampaignHero({
  promise,
  merchantName,
  statusLabel,
  pulsing = false,
  closesAt,
}: CampaignHeroProps): React.JSX.Element {
  return (
    <Card tone="raised" diagonals className="p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 text-label uppercase">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full bg-lime ${pulsing ? "animate-pulse-dot" : ""}`}
          />
          {statusLabel}
        </span>
        {closesAt === undefined ? null : <Countdown target={closesAt} size="sm" />}
      </div>
      <h2 className="mt-4 text-promise uppercase text-text">
        <LimePercent text={promise} />
      </h2>
      <p className="mt-4 flex items-center gap-1.5 text-body text-muted">
        <MapPin className="size-4 text-lime" strokeWidth={1.5} aria-hidden="true" />
        {merchantName}
      </p>
    </Card>
  );
}
