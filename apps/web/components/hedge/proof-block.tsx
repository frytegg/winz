"use client";

import type { HedgeDeskResponse } from "@winz/shared";
import { Check, CircleDashed } from "lucide-react";

import { Card } from "@/components/ui/card";
import { copy } from "@/lib/copy";
import { formatShortDate, formatTimeSeconds } from "@/lib/format";
import { proofSteps } from "@/lib/hedge/view";
import { cn } from "@/lib/utils";

const T = copy.hedgeDesk;

/**
 * The real-order proof (SPEC HE-10): orders placed on the Gemini sandbox to show the order adapter
 * works. Three steps, always listed: a maker order placed, cancelled, and one filled. A step the
 * check has not shown says "Not yet", so a jury sees what is proven and what is not. `null` is the
 * check that never ran: "Not run yet", the three steps all open.
 */
export function ProofBlock({
  venueCheck,
}: {
  venueCheck: HedgeDeskResponse["venueCheck"];
}): React.JSX.Element {
  const steps = proofSteps(venueCheck);
  return (
    <Card tone="raised" className="p-5 lg:p-6" role="region" aria-label={T.proof}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-promise uppercase">{T.proof}</h2>
        <p className="figures text-caption text-muted">
          {venueCheck === null
            ? T.notRun
            : T.proofRanAt(
                `${formatShortDate(venueCheck.ranAt)}, ${formatTimeSeconds(venueCheck.ranAt)}`,
              )}
        </p>
      </div>
      <p className="mt-2 text-body text-muted">{T.proofLead}</p>

      <ol className="mt-4 flex flex-col">
        {steps.map(({ action, done }) => (
          <li
            key={action}
            className="flex items-start gap-3 border-t border-white/10 py-3 first:border-t-0"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                done === null ? "border border-stroke text-muted" : "bg-lime text-ink",
              )}
            >
              {done === null ? (
                <CircleDashed className="size-3.5" strokeWidth={1.75} />
              ) : (
                <Check className="size-3.5" strokeWidth={2.5} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-body">
                <span className={done === null ? "text-muted" : "text-text"}>
                  {T.proofSteps[action]}
                </span>
                <span className="figures text-caption text-muted">
                  {done === null ? T.proofNotYet : formatTimeSeconds(done.at)}
                </span>
              </p>
              {done === null ? null : (
                <p className="mt-1 break-all text-caption text-muted">
                  {T.proofOrderId}{" "}
                  <span className="select-all font-mono text-text">{done.venueOrderId}</span>
                  <br />
                  <span className="font-mono">{done.instrumentSymbol}</span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
