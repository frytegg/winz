import { apiExamples } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  buildTerms,
  isValidAmountCents,
  nextStep,
  offerIsValid,
  parseDraft,
  previousStep,
  promiseText,
  resolveOffer,
  resolveStep,
  selectedTemplate,
  splitEventTitle,
  type WizardDraft,
} from "./draft";

const event = apiExamples.eventsExample.events[0];
if (event === undefined) throw new Error("the example has no event");
const template = event.templates[0];
if (template === undefined) throw new Error("the example event has no template");

const pizza = { category: "pizza", defaultUsualMarginBps: 6500 } as const;
const withGame: WizardDraft = { ...EMPTY_DRAFT, event };
const withPromo: WizardDraft = { ...withGame, templateId: template.id };

describe("resolveOffer", () => {
  it("fills every default from the merchant's category and usual margin", () => {
    expect(resolveOffer(EMPTY_DRAFT, pizza)).toEqual({
      product: "Large pizza",
      priceCents: 2000,
      usualMarginBps: 6500,
      minMarginBps: 4500,
      budgetCents: 100_000,
    });
  });

  it("keeps what the merchant typed, and the minimum margin never exceeds the usual one", () => {
    const offer = resolveOffer(
      {
        ...EMPTY_DRAFT,
        product: "Slice",
        priceCents: 450,
        usualMarginBps: 3000,
        minMarginBps: 5000,
      },
      pizza,
    );
    expect(offer.product).toBe("Slice");
    expect(offer.priceCents).toBe(450);
    expect(offer.minMarginBps).toBe(3000);
  });

  it("starts the minimum margin 20 points under the usual one, and never below zero", () => {
    expect(resolveOffer({ ...EMPTY_DRAFT, usualMarginBps: 1500 }, pizza).minMarginBps).toBe(0);
  });
});

describe("buildTerms", () => {
  it("turns cents into micro-USDC strings and carries the promo's own refund rate", () => {
    const terms = buildTerms(resolveOffer(EMPTY_DRAFT, pizza), template);
    expect(terms.unitPrice).toBe("20000000");
    expect(terms.budget).toBe("1000000000");
    expect(terms.refundBps).toBe(template.refundBps);
    expect(terms.instrumentSymbol).toBe(template.instrumentSymbol);
  });
});

describe("amounts and names", () => {
  it("accepts $0.50 to $999,999.99 in whole cents", () => {
    expect(isValidAmountCents(49)).toBe(false);
    expect(isValidAmountCents(50)).toBe(true);
    expect(isValidAmountCents(99_999_999)).toBe(true);
    expect(isValidAmountCents(100_000_000)).toBe(false);
    expect(isValidAmountCents(20.5)).toBe(false);
  });

  it("needs a product name and a valid price", () => {
    expect(offerIsValid(resolveOffer(EMPTY_DRAFT, pizza))).toBe(true);
    expect(offerIsValid(resolveOffer({ ...EMPTY_DRAFT, product: "   " }, pizza))).toBe(false);
    expect(offerIsValid(resolveOffer({ ...EMPTY_DRAFT, priceCents: 10 }, pizza))).toBe(false);
  });
});

describe("resolveStep", () => {
  it("sends a step without its requirements back to the earliest one that can be shown", () => {
    expect(resolveStep("review", EMPTY_DRAFT)).toBe("game");
    expect(resolveStep("promo", EMPTY_DRAFT)).toBe("game");
    expect(resolveStep("offer", withGame)).toBe("promo");
    expect(resolveStep("margin", withGame)).toBe("promo");
  });

  it("lets every step through once the game and the promo are chosen", () => {
    for (const step of ["game", "promo", "offer", "margin", "review"] as const) {
      expect(resolveStep(step, withPromo)).toBe(step);
    }
  });

  it("walks the steps in order", () => {
    expect(previousStep("game")).toBeNull();
    expect(previousStep("margin")).toBe("offer");
    expect(nextStep("margin")).toBe("review");
    expect(nextStep("review")).toBeNull();
  });
});

describe("the draft", () => {
  it("finds the chosen promo, and its sentence", () => {
    expect(selectedTemplate(withPromo)).toEqual(template);
    expect(selectedTemplate(withGame)).toBeNull();
    expect(promiseText(template)).toBe(`100% back if ${template.conditionLabel}`);
  });

  it("survives a round trip through storage, and ignores anything it cannot read", () => {
    expect(parseDraft(JSON.stringify(withPromo))).toEqual(withPromo);
    expect(parseDraft(null)).toEqual(EMPTY_DRAFT);
    expect(parseDraft("{not json")).toEqual(EMPTY_DRAFT);
    expect(parseDraft(JSON.stringify({ event: "nope" }))).toEqual(EMPTY_DRAFT);
  });
});

describe("splitEventTitle", () => {
  it("splits 'Away vs Home'", () => {
    expect(splitEventTitle("Arkansas vs Texas")).toEqual(["Arkansas", "Texas"]);
    expect(splitEventTitle("Texas A&M vs. Ole Miss")).toEqual(["Texas A&M", "Ole Miss"]);
    expect(splitEventTitle("Playoffs")).toBeNull();
  });
});
