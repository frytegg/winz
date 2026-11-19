import {
  eventSummarySchema,
  type CampaignTerms,
  type EventSummary,
  type Merchant,
  type MerchantCategory,
  type PromoTemplate,
} from "@winz/shared";
import { z } from "zod";

import { copy } from "@/lib/copy";
import { bpsToWholePercent, centsToMicro, microToWire } from "@/lib/format";

/**
 * What the merchant has chosen so far in the wizard (M3 to M7). Everything the merchant has not
 * touched is `null` and falls back to a default (the category's product, the merchant's usual
 * margin...), so a default follows its source until the merchant overrides it.
 */
export const WIZARD_STEPS = ["game", "promo", "offer", "margin", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export function isWizardStep(value: string | null): value is WizardStep {
  return value !== null && (WIZARD_STEPS as readonly string[]).includes(value);
}

export const draftSchema = z.object({
  event: eventSummarySchema.nullable(),
  templateId: z.string().nullable(),
  product: z.string().nullable(),
  priceCents: z.number().int().nullable(),
  usualMarginBps: z.number().int().nullable(),
  minMarginBps: z.number().int().nullable(),
  budgetCents: z.number().int().nullable(),
});

export type WizardDraft = z.infer<typeof draftSchema>;

export const EMPTY_DRAFT: WizardDraft = {
  event: null,
  templateId: null,
  product: null,
  priceCents: null,
  usualMarginBps: null,
  minMarginBps: null,
  budgetCents: null,
};

/** Bounds of a price or a budget typed by the merchant, in cents ($0.50 to $999,999.99). */
export const MIN_AMOUNT_CENTS = 50;
export const MAX_AMOUNT_CENTS = 99_999_999;
export const DEFAULT_BUDGET_CENTS = 100_000;
/** The minimum margin starts 20 points under the usual one. */
export const DEFAULT_MARGIN_GAP_BPS = 2000;
export const PRODUCT_NAME_MAX = 80;

export function parseDraft(raw: string | null): WizardDraft {
  if (raw === null) return EMPTY_DRAFT;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function selectedTemplate(draft: WizardDraft): PromoTemplate | null {
  if (draft.event === null || draft.templateId === null) return null;
  return draft.event.templates.find((template) => template.id === draft.templateId) ?? null;
}

export interface ResolvedOffer {
  product: string;
  priceCents: number;
  usualMarginBps: number;
  minMarginBps: number;
  budgetCents: number;
}

/** The draft with every default filled in. */
export function resolveOffer(
  draft: WizardDraft,
  merchant: Pick<Merchant, "category" | "defaultUsualMarginBps">,
): ResolvedOffer {
  const defaults = copy.offer.defaults[merchant.category as MerchantCategory];
  const usualMarginBps = draft.usualMarginBps ?? merchant.defaultUsualMarginBps;
  const minMarginBps = Math.min(
    usualMarginBps,
    draft.minMarginBps ?? Math.max(0, usualMarginBps - DEFAULT_MARGIN_GAP_BPS),
  );
  return {
    product: draft.product ?? defaults.name,
    priceCents: draft.priceCents ?? defaults.priceCents,
    usualMarginBps,
    minMarginBps,
    budgetCents: draft.budgetCents ?? DEFAULT_BUDGET_CENTS,
  };
}

/** The terms the API takes (micro-USDC strings), from a draft and its chosen promo. */
export function buildTerms(offer: ResolvedOffer, template: PromoTemplate): CampaignTerms {
  return {
    instrumentSymbol: template.instrumentSymbol,
    unitPrice: microToWire(centsToMicro(offer.priceCents)),
    refundBps: template.refundBps,
    usualMarginBps: offer.usualMarginBps,
    minMarginBps: offer.minMarginBps,
    budget: microToWire(centsToMicro(offer.budgetCents)),
  };
}

/** "100% back if Texas wins by 14+": the same sentence the API calls `promise`. */
export function promiseText(template: PromoTemplate): string {
  return copy.offer.promise(bpsToWholePercent(template.refundBps), template.conditionLabel);
}

/** A price is valid when it is a whole number of cents inside the allowed range. */
export function isValidAmountCents(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
}

export function offerIsValid(offer: ResolvedOffer): boolean {
  const name = offer.product.trim();
  return name.length > 0 && name.length <= PRODUCT_NAME_MAX && isValidAmountCents(offer.priceCents);
}

/**
 * The step to show: the one asked for, or the earliest one whose requirements are missing (a reload
 * or a pasted link must never reach M4 without a game).
 */
export function resolveStep(requested: WizardStep, draft: WizardDraft): WizardStep {
  if (draft.event === null) return "game";
  if (requested === "game" || requested === "promo") return requested;
  if (selectedTemplate(draft) === null) return "promo";
  return requested;
}

export function stepHref(step: WizardStep): string {
  return `/new?step=${step}`;
}

export function previousStep(step: WizardStep): WizardStep | null {
  const index = WIZARD_STEPS.indexOf(step);
  return index <= 0 ? null : (WIZARD_STEPS[index - 1] ?? null);
}

export function nextStep(step: WizardStep): WizardStep | null {
  return WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1] ?? null;
}

export type { EventSummary };
