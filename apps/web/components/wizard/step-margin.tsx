"use client";

import type { CampaignPreviewResponse } from "@winz/shared";
import type { ReactNode } from "react";

import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Stepper } from "@/components/ui/stepper";
import { ChanceMeter } from "@/components/winz/chance-meter";
import { errorMessage } from "@/lib/api/client";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import {
  MAX_CARD_AMOUNT_CENTS,
  MIN_CARD_AMOUNT_CENTS,
  bpsToWholePercent,
  formatAmount,
  formatCentsPlain,
  parseDollarsToCents,
} from "@/lib/format";
import { journeyProgress } from "@/lib/journey";
import { cn } from "@/lib/utils";
import { buildTerms, resolveOffer, selectedTemplate } from "@/lib/wizard/draft";

import { pausedExplanation, usePreview } from "./use-preview";
import { useWizardNav } from "./use-wizard-nav";
import { useWizard } from "./wizard-context";
import { WizardFrame } from "./wizard-frame";

const PREVIEW_DEBOUNCE_MS = 200;
const BUDGET_STEP_CENTS = 5000;
const BUDGET_CHIPS_CENTS = [25_000, 50_000, 100_000] as const;

function microNumber(micro: string): number {
  return Number(BigInt(micro));
}

/** A dollar amount whose digits count to the new value (the `$` stays lime and still). */
function AnimatedMoney({
  micro,
  className,
}: {
  micro: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn("figures", className)}>
      <span className="text-lime">$</span>
      <AnimatedNumber
        value={microNumber(micro)}
        format={(n) => formatAmount(BigInt(Math.round(n)))}
      />
    </span>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body text-muted">{label}</span>
      <span className="text-figure-sm">{children}</span>
    </div>
  );
}

function Results({
  preview,
  stale,
  subject,
}: {
  preview: CampaignPreviewResponse;
  stale: boolean;
  /** The team the promo is about, for "Your promo pauses if Texas' chances go above 18%". */
  subject: string | null;
}): React.JSX.Element {
  const limited =
    preview.capacity.limitedBy === "depth"
      ? copy.margin.limitedByDepth
      : copy.margin.limitedByBudget;
  return (
    <div
      className={cn(
        "flex flex-col gap-5 transition-opacity duration-150 ease-out",
        stale && "opacity-60",
      )}
    >
      {preview.costPerSale === null ? null : (
        <Figure label={copy.margin.costLabel}>
          <AnimatedMoney micro={preview.costPerSale} />
        </Figure>
      )}
      {preview.marginKeptPerSale === null || preview.marginKeptBps === null ? null : (
        <Figure label={copy.margin.keepLabel}>
          <AnimatedMoney micro={preview.marginKeptPerSale} />
          <span className="ml-2 text-lead text-muted">
            ({bpsToWholePercent(preview.marginKeptBps)}%)
          </span>
        </Figure>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-body text-muted">{copy.margin.salesLabel}</span>
        <span className="text-title">{copy.margin.capacity(preview.capacity.sales)}</span>
        <span className="text-caption text-muted">{limited}</span>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-body">
          {copy.margin.pauses(subject, bpsToWholePercent(preview.pauseThresholdBps))}
        </p>
        <ChanceMeter
          currentBps={preview.currentProbabilityBps}
          thresholdBps={preview.pauseThresholdBps}
          subject={subject}
        />
      </div>
    </div>
  );
}

/**
 * M6: the usual margin, the minimum margin to keep, the coverage budget, and what that means per
 * sale. The results panel is the answer of `POST /api/campaigns/preview`, asked again 200ms after
 * each change.
 */
export function StepMargin(): React.JSX.Element | null {
  const nav = useWizardNav("margin");
  const { draft, update } = useWizard();
  const { me } = useAuth();
  const merchant = me?.merchant;
  const template = selectedTemplate(draft);
  const offer = merchant == null ? null : resolveOffer(draft, merchant);
  const terms = offer === null || template === null ? null : buildTerms(offer, template);
  const preview = usePreview(terms, PREVIEW_DEBOUNCE_MS);
  if (offer === null || terms === null) return null;

  const result = preview.data;
  const explanation = result === null ? null : pausedExplanation(result.saleState);
  const canReview = result !== null && explanation === null && !preview.loading;
  const failed = preview.error !== null;

  return (
    <WizardFrame
      stepKey="margin"
      progress={journeyProgress("margin")}
      stepNumber={copy.wizard.stepNumber.margin}
      title={copy.wizard.steps.margin}
      subtitle={copy.margin.body}
      onBack={nav.back}
      footer={
        explanation !== null && !preview.loading ? (
          <Button variant="dark" onClick={() => nav.replace("promo")}>
            {copy.margin.pickAnother}
          </Button>
        ) : (
          <Button disabled={!canReview} onClick={() => nav.forward("review")}>
            {copy.margin.reviewCta}
          </Button>
        )
      }
    >
      <Stepper
        label={copy.margin.usualMargin}
        suffix="%"
        value={offer.usualMarginBps / 100}
        step={1}
        min={0}
        max={100}
        parse={(text) => {
          const parsed = Number.parseInt(text.replace(/\D/g, ""), 10);
          return Number.isNaN(parsed) ? null : parsed;
        }}
        onChange={(percent) => update({ usualMarginBps: percent * 100 })}
      />

      <Slider
        label={copy.margin.minMargin}
        min={0}
        max={Math.max(1, offer.usualMarginBps / 100)}
        step={1}
        value={offer.minMarginBps / 100}
        display={`${(offer.minMarginBps / 100).toString()}%`}
        onChange={(percent) => update({ minMarginBps: percent * 100 })}
      />

      <div className="flex flex-col gap-3">
        <Stepper
          label={copy.margin.budget}
          prefix="$"
          value={offer.budgetCents}
          step={BUDGET_STEP_CENTS}
          min={MIN_CARD_AMOUNT_CENTS}
          max={MAX_CARD_AMOUNT_CENTS}
          format={formatCentsPlain}
          parse={parseDollarsToCents}
          onChange={(budgetCents) => update({ budgetCents })}
        />
        <div role="group" aria-label={copy.margin.budgetChipsLabel} className="flex gap-2">
          {BUDGET_CHIPS_CENTS.map((cents) => (
            <Chip
              key={cents}
              label={`$${(cents / 100).toLocaleString("en-US")}`}
              active={offer.budgetCents === cents}
              onClick={() => update({ budgetCents: cents })}
            />
          ))}
        </div>
      </div>

      <Card className="p-5" aria-busy={preview.loading}>
        {failed && result === null ? (
          <div className="flex flex-col items-start gap-4">
            <p role="alert" className="text-body text-danger">
              {errorMessage(preview.error, copy.common.genericError)}
            </p>
            <Button variant="dark" size="md" arrow={false} onClick={preview.reload}>
              {copy.common.tryAgain}
            </Button>
          </div>
        ) : result === null ? (
          <div className="flex flex-col gap-5" aria-label={copy.common.loading}>
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {preview.market === "waiting" ? (
              <p
                role="status"
                className="rounded-card-sm border border-white/20 px-4 py-3 text-body"
              >
                {copy.margin.marketOpening}
              </p>
            ) : preview.market === "gave_up" ? (
              <div
                role="status"
                className="flex flex-col items-start gap-3 rounded-card-sm border border-danger/50 px-4 py-3 text-body"
              >
                {copy.margin.marketStillClosed}
                <Button variant="dark" size="md" arrow={false} onClick={preview.reload}>
                  {copy.margin.checkAgain}
                </Button>
              </div>
            ) : explanation === null ? null : (
              <p
                role="status"
                className="rounded-card-sm border border-danger/50 px-4 py-3 text-body"
              >
                {explanation}
              </p>
            )}
            <Results
              preview={result}
              stale={preview.loading}
              subject={template?.subjectName ?? null}
            />
            {failed ? (
              <p role="alert" className="text-caption text-danger">
                {errorMessage(preview.error, copy.common.genericError)}
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </WizardFrame>
  );
}
