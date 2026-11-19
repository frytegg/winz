import { ShieldAlert, ShieldCheck } from "lucide-react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

type Breaker = { active: boolean; reason: "venue_down" | "stale_book" | "unhedged_limit" | null };

const T = copy.hedgeDesk.breaker;

/**
 * The circuit breaker of one instrument. Armed: the engine is covering and selling is on (green).
 * Tripped: selling is paused, and the reason is written in the pill (red). Text on the green is
 * white (4.9:1), text on the red is the dark ink (6.1:1): each passes AA on its own surface.
 */
export function BreakerPill({ breaker }: { breaker: Breaker }): React.JSX.Element {
  const tripped = breaker.active;
  const Icon = tripped ? ShieldAlert : ShieldCheck;
  const reason = breaker.reason === null ? null : T.reasons[breaker.reason];
  return (
    <p
      role="status"
      aria-label={`${T.title}: ${tripped ? `${T.tripped}${reason === null ? "" : `, ${reason}`}` : T.armed}`}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-label font-semibold",
        tripped ? "bg-danger text-ink" : "bg-team-b text-text",
      )}
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">
        {tripped ? T.tripped : T.armed}
        {tripped && reason !== null ? <span className="font-normal"> · {reason}</span> : null}
      </span>
    </p>
  );
}
