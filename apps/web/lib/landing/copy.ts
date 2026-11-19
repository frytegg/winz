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

  /** The navigation. The anchors are the ids of the sections that land in P2 to P4. */
  nav: {
    label: "Main",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Demo video", href: "#demo" },
      { label: "Features", href: "#features" },
      { label: "Live demo", href: "#live-demo" },
    ],
    homeLabel: "Winz, back to the top",
    openMenu: "Open the menu",
    closeMenu: "Close the menu",
    menuLabel: "Menu",
  },

  /**
   * The hero's H1, in the runs it is set in: `highlight` is lime, and the line breaks before `second`
   * on a desktop ("Get payback if" / "your team wins."). The page and the share card both read it.
   */
  heroTitle: {
    before: "Get ",
    highlight: "payback",
    firstLineEnd: " if",
    second: "your team wins.",
  },

  hero: {
    eyebrow: "UBC 2026 · Consumer app track",
    subtitle:
      "Fans pay in one tap, get refunded if their team wins. The merchant's risk is hedged.",
    cta: "Try the live demo",
    illustrationAlt:
      "Winz on three phones: picking a game, the merchant dashboard and the promo screen.",
  },

  logos: {
    /** "Built with the best tools", broken where the mockup breaks it (one line on a phone). */
    labelLines: ["Built with", "the best tools"],
    listLabel: "Technologies used",
    pause: "Pause the scrolling logos",
  },
} as const;
