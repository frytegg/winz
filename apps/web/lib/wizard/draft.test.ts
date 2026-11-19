import { pauseThresholdBps } from "@winz/pricing";
import { apiExamples } from "@winz/shared";
import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  acceptedCostBps,
  buildTerms,
  isAboveCap,
  isValidAmountCents,
  nextStep,
  offerIsValid,
  parseDraft,
  previousStep,
  promiseText,
  resolveOffer,
  resolveStep,
  selectedTemplate,
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

describe("the promos M4 greys: a cost above what the merchant accepts (SPEC 4.3, M4)", () => {
  const byId = (id: string): (typeof event.templates)[number] => {
    const found = event.templates.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(`the example event has no ${id}`);
    return found;
  };

  it("accepts usual margin minus minimum margin: 20% with a pizza's defaults (M6's)", () => {
    expect(acceptedCostBps(resolveOffer(EMPTY_DRAFT, pizza))).toBe(2000);
    expect(acceptedCostBps({ usualMarginBps: 6500, minMarginBps: 6500 })).toBe(0);
    expect(acceptedCostBps({ usualMarginBps: 4000, minMarginBps: 5000 })).toBe(0);
  });

  it("follows the margins M6 was given, and never throws on a margin out of range", () => {
    const lowered = resolveOffer({ ...EMPTY_DRAFT, minMarginBps: 1500 }, pizza);
    expect(acceptedCostBps(lowered)).toBe(5000);
    expect(acceptedCostBps({ usualMarginBps: 12_000, minMarginBps: -5 })).toBe(10_000);
  });

  it("on Saturday's game greys the side priced around 91%, and not the other side", () => {
    const cap = acceptedCostBps(resolveOffer(EMPTY_DRAFT, pizza));
    const texasWins = byId("tpl_tex_ml_half");
    expect(texasWins.probabilityBps).toBe(9100);
    expect(isAboveCap(texasWins, cap)).toBe(true);
    expect(isAboveCap(byId("tpl_ark_ml_full"), cap)).toBe(false);
    expect(isAboveCap(byId("tpl_tex13_full"), cap)).toBe(false);
  });

  it("does not judge a template without a quote, and a cost exactly at the cap still sells", () => {
    expect(isAboveCap(byId("tpl_tex20_full"), 0)).toBe(false);
    expect(isAboveCap({ costBps: 2000 }, 2000)).toBe(false);
    expect(isAboveCap({ costBps: 2001 }, 2000)).toBe(true);
  });

  it("agrees with the pause threshold the server prices M6 with: above the cap is past p_max", () => {
    // A full refund: the cost of one sale at an ask p is p + 7% x p x (1 - p), rounded up.
    const cap = 2000;
    const threshold = Number(pauseThresholdBps(BigInt(cap), 10_000n));
    expect(threshold).toBe(1800);
    const costAt = (askBps: number): number =>
      Math.ceil(askBps + (700 * askBps * (10_000 - askBps)) / 100_000_000);
    expect(isAboveCap({ costBps: costAt(threshold) }, cap)).toBe(false);
    expect(isAboveCap({ costBps: costAt(threshold + 100) }, cap)).toBe(true);
  });
});
