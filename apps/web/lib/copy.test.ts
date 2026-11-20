import { describe, expect, it } from "vitest";

import { CRYPTO_WORDS } from "./crypto-words";
import { copy, possessive } from "./copy";

/**
 * No crypto word on a fan screen (BRIEF section 4). The merchant space may say "coverage", and
 * its settings fold "Technical details", but everything a fan can read stays in plain words.
 */

/** Every string a group can produce; a function is called with sample arguments. */
function collect(value: unknown, path: string, out: Map<string, string>): void {
  if (typeof value === "string") {
    out.set(path, value);
  } else if (typeof value === "function") {
    const samples: unknown[][] = [
      ["Joe's Pizza", "Large pizza", 2],
      [12, "Texas wins by 14+"],
      ["$20.00", "Texas wins by 14+"],
      [3, 4, 5],
    ];
    for (const args of samples) {
      try {
        const result = (value as (...a: unknown[]) => unknown)(...args);
        if (typeof result === "string") out.set(`${path}(${JSON.stringify(args)})`, result);
      } catch {
        // A sample that does not fit this function: another one will.
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collect(item, `${path}[${index.toString()}]`, out));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) collect(item, `${path}.${key}`, out);
  }
}

/** The groups a fan can reach: C1 to C4 and what they share. */
const FAN_GROUPS = [
  "brand",
  "common",
  "countdown",
  "demo",
  "campaign",
  "checkout",
  "ticket",
  "tickets",
  "saleState",
  "pickGame",
] as const;

describe("fan copy", () => {
  const strings = new Map<string, string>();
  for (const group of FAN_GROUPS) collect(copy[group], `copy.${group}`, strings);

  it("collects the strings it is going to check", () => {
    expect(strings.size).toBeGreaterThan(80);
  });

  it("uses no crypto word", () => {
    const offenders = [...strings].filter(([, text]) => CRYPTO_WORDS.test(text));
    expect(offenders).toEqual([]);
  });

  it("flags a crypto word when there is one", () => {
    for (const word of ["Your wallet", "USDC", "on-chain", "Hedge desk", "Gemini book", "gas"]) {
      expect(CRYPTO_WORDS.test(word)).toBe(true);
    }
    expect(CRYPTO_WORDS.test("Chain reaction")).toBe(true);
    expect(CRYPTO_WORDS.test("Gasoline, tokens")).toBe(false);
  });
});

describe("the team a promo is about", () => {
  it("puts the apostrophe after the s of a name that ends in s, and 's after any other", () => {
    expect(possessive("Texas")).toBe("Texas'");
    expect(possessive("Pitt")).toBe("Pitt's");
    expect(possessive("Pittsburgh")).toBe("Pittsburgh's");
  });

  it("is named in the pause sentence when the promo is about a team, and not for a total", () => {
    expect(copy.margin.pauses("Texas", 18)).toBe(
      "Your promo pauses if Texas' chances go above 18%.",
    );
    expect(copy.margin.pauses("Pitt", 18)).toBe(
      "Your promo pauses if Pitt's chances go above 18%.",
    );
    expect(copy.margin.pauses(null, 18)).toBe("Your promo pauses if the chances go above 18%.");
    expect(copy.campaignDetail.saleState("paused_price", 18, "Texas")).toBe(
      "Paused: Texas' chances are above 18%",
    );
    expect(copy.campaignDetail.saleState("paused_price", 18, null)).toBe(
      "Paused: the chances are above 18%",
    );
  });
});

/** Every string of the whole copy, functions called with the samples of `collect`. */
function allStrings(): Map<string, string> {
  const strings = new Map<string, string>();
  collect(copy, "copy", strings);
  return strings;
}

describe("the app's own words, the same everywhere", () => {
  const strings = allStrings();

  it("says « promo », never « campaign », on any screen", () => {
    const offenders = [...strings].filter(([, text]) => /\bcampaigns?\b/i.test(text));
    expect(offenders).toEqual([]);
  });

  it("flags « campaign » when a string has it", () => {
    expect(/\bcampaigns?\b/i.test("Live campaign")).toBe(true);
    expect(/\bcampaigns?\b/i.test("Live promo")).toBe(false);
  });

  it("words the chance one way: « chance it's free », never « chance this is free »", () => {
    const chances = [...strings].filter(([, text]) => /chance .*free/i.test(text));
    expect(chances.length, "C1, M4, the gauge and the ticket all word it").toBeGreaterThanOrEqual(
      4,
    );
    const offenders = chances.filter(([, text]) => !/chance it's free/i.test(text));
    expect(offenders).toEqual([]);
    expect(copy.ticket.chanceTitle(14)).toBe("14% chance it's free");
    expect(copy.campaign.chanceFree(14)).toBe(copy.ticket.chanceTitle(14));
    expect(copy.pickPromo.chance(14)).toBe(copy.ticket.chanceTitle(14));
  });

  it("uses no word of betting or insurance", () => {
    const offenders = [...strings].filter(([, text]) =>
      /\b(bet|bets|betting|wager\w*|gambl\w*|insur\w*)\b/i.test(text),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the report after the game (MD « How it went »)", () => {
  const t = copy.campaignDetail.report;

  it("ends a promo that hit with a line true for it: the refunds were covered", () => {
    expect(t.sameAsWon("12.5%")).toBe(
      "Same as a 12.5% discount. The refunds cost you nothing more.",
    );
    expect(t.sameAsWon("12.5%")).not.toMatch(/only when you win/i);
  });

  it("keeps the line of a promo that didn't hit", () => {
    expect(t.sameAs("12.5%")).toBe("Same as a 12.5% discount, and every customer paid full price.");
    expect(t.sameAs("12.5%")).not.toBe(t.sameAsWon("12.5%"));
  });

  it("names a promo that didn't hit as the merchant sees it: « No refunds », never « Lost »", () => {
    expect(t.lost).toBe("No refunds");
    expect(copy.campaigns.status.settled_no).toBe("No refunds");
    expect(copy.campaign.lost, "the fan's side keeps its words").toBe("Not this time");
  });
});
