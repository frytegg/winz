"use client";

import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { LimePercent } from "@/components/ui/lime-percent";
import { Stepper } from "@/components/ui/stepper";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { formatCentsPlain, parseDollarsToCents } from "@/lib/format";
import { journeyProgress } from "@/lib/journey";
import {
  MAX_AMOUNT_CENTS,
  MIN_AMOUNT_CENTS,
  PRODUCT_NAME_MAX,
  offerIsValid,
  promiseText,
  resolveOffer,
  selectedTemplate,
} from "@/lib/wizard/draft";

import { useWizardNav } from "./use-wizard-nav";
import { useWizard } from "./wizard-context";
import { WizardFrame } from "./wizard-frame";

/** M5: the product and its price, pre-filled for the merchant's category. The promise is read-only. */
export function StepOffer(): React.JSX.Element | null {
  const nav = useWizardNav("offer");
  const { draft, update } = useWizard();
  const { me } = useAuth();
  const merchant = me?.merchant;
  const template = selectedTemplate(draft);
  if (merchant == null || template === null) return null;

  const offer = resolveOffer(draft, merchant);

  return (
    <WizardFrame
      stepKey="offer"
      progress={journeyProgress("offer")}
      stepNumber={copy.wizard.stepNumber.offer}
      title={copy.wizard.steps.offer}
      onBack={nav.back}
      footer={
        <Button disabled={!offerIsValid(offer)} onClick={() => nav.forward("margin")}>
          {copy.common.continue}
        </Button>
      }
    >
      <Field
        label={copy.offer.productLabel}
        name="product"
        autoComplete="off"
        enterKeyHint="done"
        maxLength={PRODUCT_NAME_MAX}
        value={offer.product}
        onChange={(event) => update({ product: event.target.value })}
      />

      <Stepper
        label={copy.offer.priceLabel}
        prefix="$"
        value={offer.priceCents}
        step={100}
        min={MIN_AMOUNT_CENTS}
        max={MAX_AMOUNT_CENTS}
        format={formatCentsPlain}
        parse={parseDollarsToCents}
        onChange={(priceCents) => update({ priceCents })}
      />

      <Card className="p-5">
        <p className="text-label uppercase text-muted">{copy.offer.refundLabel}</p>
        <p className="mt-2 text-title">
          <LimePercent text={promiseText(template)} />
        </p>
        <p className="mt-3 flex items-center gap-1.5 text-body text-muted">
          <Lock className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          {copy.offer.locked}
        </p>
      </Card>
    </WizardFrame>
  );
}
