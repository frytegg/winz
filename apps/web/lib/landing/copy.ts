/**
 * The landing page's own text. The only source of it is `winz-front-kit/landing/_integration/COPY.md`;
 * the page's sections add their strings here, as they land. It is not `lib/copy.ts`: that file is the
 * app's, and its tests forbid words (USDC, hedge) that the landing is allowed to use.
 */
export const landingCopy = {
  /** Under an inactive button (a link not decided yet), on hover, on focus and after a tap. */
  openingSoon: "Opening soon",
} as const;
