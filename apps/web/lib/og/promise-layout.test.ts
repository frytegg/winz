import { describe, expect, it } from "vitest";

import { PREVIEW_SIZES, layoutPromise } from "./promise-layout";

describe("layoutPromise", () => {
  it("sets a typical promise in capitals, word by word", () => {
    const layout = layoutPromise("100% back if Texas wins by 14+", PREVIEW_SIZES);
    expect(layout.words).toEqual(["100%", "BACK", "IF", "TEXAS", "WINS", "BY\u00A014+"]);
    expect(layout.fontSize).toBe(88);
  });

  it("gives a short promise the biggest type and a long one the smallest", () => {
    expect(layoutPromise("Free if we win", PREVIEW_SIZES).fontSize).toBe(104);
    const long = layoutPromise(
      "Half your money back if the Longhorns win the game by more than a touchdown",
      PREVIEW_SIZES,
    );
    expect(long.fontSize).toBe(60);
  });

  it("keeps a short last word with the one before it, so it is never alone on a line", () => {
    expect(layoutPromise("Free pizza if we win", PREVIEW_SIZES).words).toEqual([
      "FREE",
      "PIZZA",
      "IF",
      "WE\u00A0WIN",
    ]);
    // Two words, or a last word that is a real word: left as they are.
    expect(layoutPromise("Free if", PREVIEW_SIZES).words).toEqual(["FREE", "IF"]);
    expect(layoutPromise("Half back if Texas wins", PREVIEW_SIZES).words).toEqual([
      "HALF",
      "BACK",
      "IF",
      "TEXAS",
      "WINS",
    ]);
  });

  it("never grows as the text gets longer", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let length = 1; length <= 120; length += 1) {
      const { fontSize } = layoutPromise("a".repeat(length), PREVIEW_SIZES);
      expect(fontSize).toBeLessThanOrEqual(previous);
      previous = fontSize;
    }
  });

  it("cuts an over-long promise at a word, with an ellipsis, instead of overflowing the card", () => {
    const layout = layoutPromise(
      "Get 100% of your money back if the Texas Longhorns beat the Oklahoma Sooners by 14 points or more tonight",
      PREVIEW_SIZES,
    );
    const text = layout.words.join(" ");
    expect(text.length).toBeLessThanOrEqual(PREVIEW_SIZES.maxCharacters + 1);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toMatch(/\s…$/);
    expect(text.replaceAll("\u00A0", " ").startsWith("GET 100% OF YOUR MONEY BACK")).toBe(true);
  });

  it("collapses stray whitespace and survives an empty promise", () => {
    expect(layoutPromise("  free   if we\nwin ", PREVIEW_SIZES).words).toEqual([
      "FREE",
      "IF",
      "WE\u00A0WIN",
    ]);
    expect(layoutPromise("", PREVIEW_SIZES).words).toEqual([]);
  });
});
