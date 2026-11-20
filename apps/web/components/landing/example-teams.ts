/**
 * The two teams of the page's example (`landingCopy.example`) as the illustrations draw them: a plain
 * helmet in each team's colours (no logo, no wordmark), 128 px WebP, both facing right; the one drawn on
 * the right is mirrored to face the other.
 */
export const HELMET = {
  /** Texas: burnt orange (#BF5700), white stripe and facemask. */
  home: "/landing/how/helmet-tex.webp",
  /** Arkansas: cardinal (#9D2235), silver facemask. */
  away: "/landing/how/helmet-ark.webp",
} as const;

export type Side = keyof typeof HELMET;

/**
 * The order the teams are drawn in, left first, everywhere on the page (match card, tickets, scores):
 * Texas, at home, then Arkansas, the order the demo tells the score in ("Texas 31, Arkansas 17"). The
 * app's own match card and tickets put the visitors on the left; swapping this pair makes every
 * illustration of the page do the same.
 */
export const SIDES: readonly [Side, Side] = ["home", "away"];
