/**
 * The landing page's own text. The only source of it is `winz-front-kit/landing/_integration/COPY.md`
 * (and the owner's decisions after it); the page's sections add their strings here, as they land. It
 * is not `lib/copy.ts`: that file is the app's, and its tests forbid words (USDC, hedge) that the
 * landing is allowed to use.
 */
export const landingCopy = {
  /** Under an inactive button (a link not decided yet), on hover, on focus and after a tap. */
  openingSoon: "Opening soon",

  /** What a link to `/landing` shows in a tab, a search result, a chat or a feed. */
  meta: {
    title: "Winz · Refunded if the team wins",
    description:
      "Fans pay in one tap and get refunded if their team wins. The merchant's risk is hedged. Built for UBC 2026.",
  },

  /** The hero's H1, in the three runs it is set in: the middle one is lime. */
  heroTitle: {
    before: "Get ",
    highlight: "payback",
    after: " if your team wins.",
  },
} as const;
