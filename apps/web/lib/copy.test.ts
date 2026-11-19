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
