import { describe, expect, it } from "vitest";

import { CRYPTO_WORDS } from "../crypto-words";
import { copy } from "../copy";

/**
 * The merchant space says "coverage", never "hedge", and no crypto word at all outside the folded
 * "Technical details" of the settings. The wizard and the
 * fan groups have their own guards (`copy.test.ts`, `fan-screens.test.ts`).
 */

function collect(value: unknown, path: string, out: Map<string, string>): void {
  if (typeof value === "string") {
    out.set(path, value);
  } else if (typeof value === "function") {
    const samples: unknown[][] = [
      ["$20.00", "Texas wins by 14+"],
      [12, 18],
      ["open", 18],
      ["paused_price", 18],
      ["closed", 18],
      ["Joe's Pizza", "Large pizza", 2],
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

const MERCHANT_GROUPS = [
  "merchantSpace",
  "home",
  "campaigns",
  "campaignDetail",
  "stats",
  "balance",
  "settings",
] as const;

/** The only strings of the merchant space that may name the technical side. */
const TECHNICAL_KEYS = /^settings\.(technical|technicalNote|address|addressNote|explorer.*)$/;

describe("the merchant copy", () => {
  it("has strings to check", () => {
    const strings = new Map<string, string>();
    for (const group of MERCHANT_GROUPS) collect(copy[group], group, strings);
    expect(strings.size).toBeGreaterThan(100);
  });

  it("uses no crypto word, and no 'hedge', outside the technical details", () => {
    const offenders: string[] = [];
    for (const group of MERCHANT_GROUPS) {
      const strings = new Map<string, string>();
      collect(copy[group], group, strings);
      for (const [path, text] of strings) {
        if (TECHNICAL_KEYS.test(path.replace(/\(.*$/, ""))) continue;
        if (CRYPTO_WORDS.test(text)) offenders.push(`${path}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps USDC to the technical details", () => {
    const withUsdc: string[] = [];
    for (const group of MERCHANT_GROUPS) {
      const strings = new Map<string, string>();
      collect(copy[group], group, strings);
      for (const [path, text] of strings) if (/usdc/i.test(text)) withUsdc.push(path);
    }
    expect(withUsdc.every((path) => TECHNICAL_KEYS.test(path))).toBe(true);
  });
});
