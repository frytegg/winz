/**
 * How a promise is set on a generated image. The promise is whatever the merchant's offer produced
 * ("100% back if Texas wins by 14+"), so its length varies: a fixed type size overflows the card on a
 * long one and wastes it on a short one.
 */
export interface PromiseLayout {
  /**
   * The words in capitals, so the line wraps like a sentence. A short last word ("14+", "WIN") is
   * joined to the one before it with a no-break space, so it is never left alone on a line.
   */
  words: string[];
  fontSize: number;
}

export interface PromiseSizes {
  /** [longest text in characters, font size] pairs, shortest first. */
  steps: readonly (readonly [number, number])[];
  /** The size once past the last step. */
  smallest: number;
  /** Longer than this many characters is cut at a word, with an ellipsis. */
  maxCharacters: number;
}

/** 1200 × 630 share preview: about 330 px of height for the promise. */
export const PREVIEW_SIZES: PromiseSizes = {
  steps: [
    [24, 104],
    [40, 88],
    [60, 72],
  ],
  smallest: 60,
  maxCharacters: 80,
};

/** 1080 × 1350 poster: the promise is the headline, over at most four lines. */
export const POSTER_SIZES: PromiseSizes = {
  steps: [
    [16, 120],
    [32, 92],
    [52, 76],
  ],
  smallest: 64,
  maxCharacters: 80,
};

export function layoutPromise(raw: string, sizes: PromiseSizes): PromiseLayout {
  let text = raw.replace(/\s+/g, " ").trim().toUpperCase();
  if (text.length > sizes.maxCharacters) {
    const cut = text.slice(0, sizes.maxCharacters);
    const space = cut.lastIndexOf(" ");
    text = `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:!-]+$/, "")}…`;
  }
  const step = sizes.steps.find(([limit]) => text.length <= limit);
  const words = text.split(" ").filter((word) => word !== "");
  const last = words[words.length - 1];
  if (words.length > 2 && last !== undefined && last.length <= 3) {
    words.splice(words.length - 2, 2, `${words[words.length - 2]}\u00A0${last}`);
  }
  return {
    words,
    fontSize: step === undefined ? sizes.smallest : step[1],
  };
}
