"use client";

import type { HedgeDeskResponse } from "@winz/shared";
import { Check, CircleDashed, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { copy } from "@/lib/copy";
import { formatShortDate, formatTimeSeconds } from "@/lib/format";
import { formatPriceBps, formatQty } from "@/lib/hedge/format";
import { proofSteps, proofVerdict, type ProofOrder } from "@/lib/hedge/view";
import { cn } from "@/lib/utils";

const T = copy.hedgeDesk;

function venueInWords(venue: NonNullable<HedgeDeskResponse["venueCheck"]>["venue"]): string {
  return venue === null ? T.proofVenueUnknown : T.proofVenues[venue];
}

/** "Buy 1.00 @ $0.36", when the run recorded the order's terms. */
function orderTerms(order: ProofOrder): string | null {
  if (order.side === null || order.qty === null || order.priceBps === null) return null;
  return T.proofOrderTerms(
    T.proofSide[order.side],
    formatQty(order.qty),
    formatPriceBps(order.priceBps),
  );
}

/**
 * The real-order proof (SPEC HE-10): orders sent to the Gemini sandbox, each read back from Gemini,
 * to show the order adapter works. The latest run of the check, as the engine recorded it: when it
 * ran, where the orders went in plain words, whether it proved or where it stopped and why, and the
 * three steps (a maker order placed, cancelled, and one filled) with Gemini's order id, the order's
 * terms and the status Gemini gave when read back. A step the run has not shown says "Not yet".
 * `null` is a check that never ran: "Not proven yet", plainly, the three steps all open.
 */
export function ProofBlock({
  venueCheck,
}: {
  venueCheck: HedgeDeskResponse["venueCheck"];
}): React.JSX.Element {
  const steps = proofSteps(venueCheck);
  const verdict = proofVerdict(venueCheck);
  return (
    <Card tone="raised" className="p-5 lg:p-6" role="region" aria-label={T.proof}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-promise uppercase">{T.proof}</h2>
        {venueCheck === null ? null : (
          <p className="figures text-caption text-muted">
            {T.proofRanAt(
              `${formatShortDate(venueCheck.ranAt)}, ${formatTimeSeconds(venueCheck.ranAt)}`,
            )}
          </p>
        )}
      </div>
      <p className="mt-2 text-body text-muted">{T.proofLead}</p>

      <div className="mt-4 flex flex-col gap-1" data-testid="proof-verdict">
        {verdict === "none" ? (
          <>
            <p className="text-lead font-semibold text-text">{T.notProven}</p>
            <p className="text-body text-muted">{T.notProvenBody}</p>
          </>
        ) : (
          <>
            <p
              className={cn(
                "inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-label font-semibold",
                verdict === "proven" && "bg-lime text-ink",
                verdict === "failed" && "bg-danger text-ink",
                verdict === "partial" && "border border-stroke text-text",
              )}
            >
              {verdict === "proven" ? (
                <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
              ) : verdict === "failed" ? (
                <X aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
              ) : null}
              {verdict === "proven"
                ? T.proofProven
                : verdict === "failed"
                  ? T.proofFailed
                  : T.proofPartial}
            </p>
            {venueCheck !== null && verdict === "failed" ? (
              <p className="break-words text-body text-text">
                {venueCheck.failedStep === null
                  ? null
                  : `${T.proofFailedAt(T.proofStepNames[venueCheck.failedStep])}. `}
                <span className="text-muted">{venueCheck.failure}</span>
              </p>
            ) : null}
            {venueCheck === null ? null : (
              <p className="text-caption text-muted">
                {T.proofVenue}: <span className="text-text">{venueInWords(venueCheck.venue)}</span>
              </p>
            )}
          </>
        )}
      </div>

      <ol className="mt-4 flex flex-col">
        {steps.map(({ action, done }) => {
          const terms = done === null ? null : orderTerms(done);
          return (
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
                    {terms === null ? null : (
                      <>
                        <br />
                        <span className="figures">{terms}</span>
                      </>
                    )}
                    {done.status === null ? null : (
                      <>
                        <br />
                        <span>{T.proofReadBack(done.status)}</span>
                      </>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
