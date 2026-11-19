"use client";

import { useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignHero } from "@/components/winz/campaign-hero";
import { FundBudget } from "@/components/winz/fund-budget";
import { MatchSummary } from "@/components/winz/match-summary";
import { Money } from "@/components/winz/money";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { bpsToWholePercent, centsToMicro } from "@/lib/format";
import { journeyProgress } from "@/lib/journey";
import { RequestIds, planFromCreate, sendRequest, type FundingPlan } from "@/lib/merchant/funding";
import { buildTerms, promiseText, resolveOffer, selectedTemplate } from "@/lib/wizard/draft";

import { pausedExplanation, usePreview } from "./use-preview";
import { useWizardNav } from "./use-wizard-nav";
import { useWizard } from "./wizard-context";
import { WizardFrame } from "./wizard-frame";

/** Where M7 keeps its "Fund" request, so a reload or a step back to M6 asks for the same one. */
const FUND_REQUEST_KEY = "winz.fund-request";

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-lead text-muted">{label}</dt>
      <dd className="text-clock">{children}</dd>
    </div>
  );
}

/**
 * M7: the promise, the game and the numbers one last time, then the payment. The preview is asked
 * again here (no debounce): the odds may have moved since M6, and a promo that would not sell
 * cannot be funded.
 */
export function StepReview({
  onLaunched,
}: {
  onLaunched: (campaignId: string) => void;
}): React.JSX.Element | null {
  const nav = useWizardNav("review");
  const { draft } = useWizard();
  const { me } = useAuth();
  const merchant = me?.merchant;
  const template = selectedTemplate(draft);
  const event = draft.event;
  const offer = merchant == null ? null : resolveOffer(draft, merchant);
  const terms = offer === null || template === null ? null : buildTerms(offer, template);
  const preview = usePreview(terms, 0);
  const requestIds = useRef(new RequestIds(FUND_REQUEST_KEY));

  if (merchant == null || offer === null || terms === null || template === null || event === null) {
    return null;
  }

  const result = preview.data;
  const explanation = result === null ? null : pausedExplanation(result.saleState);
  const canFund = result !== null && explanation === null && !preview.loading;

  /**
   * One `requestId` per request: the same terms keep it, so a second tap, a retry after a dropped
   * connection or after a card refused at Stripe asks for the same campaign and the same payment
   * (the back end then answers the campaign's state of the moment, or a new campaign and a new
   * payment when Stripe cancelled the first: the last answer is the one to pay). The answer is never
   * kept here for that reason. A 503 ("still being created") is sent again with the same id.
   * The id is kept in the tab's storage before the request leaves: a reload, or M6 and back, asks
   * for the same campaign. It is forgotten once the promo is funded, or when the API says it is
   * spent.
   */
  async function prepare(): Promise<FundingPlan> {
    if (offer === null || terms === null) throw new RangeError("Nothing to create");
    const product = offer.product.trim();
    const response = await sendRequest(
      requestIds.current,
      JSON.stringify({ terms, product }),
      (requestId) => apiFetch("createCampaign", { body: { ...terms, product, requestId } }),
    );
    return planFromCreate(response);
  }

  return (
    <WizardFrame
      stepKey="review"
      progress={journeyProgress("review")}
      stepNumber={copy.wizard.stepNumber.review}
      title={copy.wizard.steps.review}
      onBack={nav.back}
      footer={
        <FundBudget
          amountCents={offer.budgetCents}
          prepare={prepare}
          onFunded={(campaignId) => {
            requestIds.current.renew();
            onLaunched(campaignId);
          }}
          disabled={!canFund}
        />
      }
    >
      <CampaignHero
        promise={promiseText(template)}
        merchantName={merchant.name}
        statusLabel={copy.review.liveBadge}
      />
      <MatchSummary event={event} />

      {explanation === null ? null : (
        <div
          role="status"
          className="flex flex-col items-start gap-3 rounded-card-sm border border-danger/50 px-4 py-3 text-body"
        >
          {explanation}
          <Button variant="dark" size="md" arrow={false} onClick={() => nav.replace("promo")}>
            {copy.margin.pickAnother}
          </Button>
        </div>
      )}

      <dl className="flex flex-col gap-5">
        <Row label={copy.review.product}>
          {offer.product.trim()} · <Money micro={centsToMicro(offer.priceCents)} compact />
        </Row>
        <Row label={copy.review.salesClose}>
          <LocalTime iso={event.salesCloseAt} style="weekday-time" />
        </Row>
        <Row label={copy.review.budget}>
          <Money micro={centsToMicro(offer.budgetCents)} compact />
        </Row>
        {result === null && preview.error === null ? (
          <Skeleton className="h-28" />
        ) : result === null ? null : (
          <>
            {result.costPerSale === null ? null : (
              <Row label={copy.review.costPerSale}>
                ~<Money micro={result.costPerSale} />
              </Row>
            )}
            {result.marginKeptPerSale === null ? null : (
              <Row label={copy.review.keepPerSale}>
                <Money micro={result.marginKeptPerSale} />
              </Row>
            )}
            <Row label={copy.review.pausesAbove}>
              {copy.review.chanceUnit(bpsToWholePercent(result.pauseThresholdBps))}
            </Row>
          </>
        )}
      </dl>
      {result === null && preview.error !== null ? (
        <div className="flex flex-col items-start gap-4">
          <p role="alert" className="text-body text-danger">
            {errorMessage(preview.error, copy.common.genericError)}
          </p>
          <Button variant="dark" size="md" arrow={false} onClick={preview.reload}>
            {copy.common.tryAgain}
          </Button>
        </div>
      ) : null}

      <p className="text-body text-muted">{copy.review.unusedBudget}</p>
    </WizardFrame>
  );
}
