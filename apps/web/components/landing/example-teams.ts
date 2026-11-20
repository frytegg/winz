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
 * The order the teams are drawn in, left first, everywhere on the page (match card, tickets, scores): the
 * visitors, Arkansas, then Texas at home, as the app's own match card and tickets draw a game, so the
 * landing reads like the screens of the demo video ("ARK 17, TEX 31").
 */
export const SIDES: readonly [Side, Side] = ["away", "home"];
