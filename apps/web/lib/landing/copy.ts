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

  /**
   * How it works (COPY.md section 3). The titles, the descriptions and the chips are COPY.md's; the
   * `alt` and `label` lines are not (the illustrations are pictures, and COPY.md does not describe
   * them): they say what the picture shows, with the same example data (Pittsburgh against
   * Philadelphia, Joe's Pizza, $20.00). The Fan tab says nothing a fan would not read in the app:
   * no wallet, no chain, no token.
   */
  how: {
    eyebrow: "How it works",
    title: "How a promo works.",
    /** Two lines, as on the mockup; they flow as one sentence on a phone. */
    subtitleLines: ["The merchant sets it up in a minute.", "The fan never has to learn anything."],
    tabsLabel: "Who it is for",
    tabs: { merchant: "Merchant", fan: "Fan" },
    merchant: [
      {
        title: "Pick a game and a budget",
        body: "Choose the match, the discount and the most you are willing to give away.",
        alt: "A match card, Pittsburgh against Philadelphia at 7:00 on November 22, with the Budget and Promo steps ticked.",
      },
      {
        title: "Pay by card",
        body: "The promo is live in about ten seconds.",
        alt: "The promo's campaign card, 100% back if Pittsburgh wins at Joe's Pizza, with the Fund with Apple Pay and Fund with card buttons.",
      },
      {
        title: "Show the QR",
        body: "Put it on the counter or send the link.",
        alt: "The promo's QR code, with its link and a Download QR button.",
      },
    ],
    fan: [
      {
        title: "Scan and pay",
        body: "Apple Pay or a card. One tap, no app to install.",
        alt: "The Joe's Pizza campaign card, 100% back if Pittsburgh wins, with a Scan the QR tag and a Pay with Apple Pay button.",
      },
      {
        title: "Follow your ticket",
        body: "It updates live during the game. No refresh.",
        alt: "A live ticket for Pittsburgh against Philadelphia, with a 64% win chance.",
      },
      {
        title: "Team wins, money back",
        body: "The refund lands on its own. Nothing to claim.",
        alt: "The final ticket, Pittsburgh 24, Philadelphia 17, refunded $20.00.",
      },
    ],
    /** The words inside the Fan illustrations (COPY.md: the chips), and the example they share. */
    scene: {
      scanTheQr: "Scan the QR",
      payWithApplePay: "Pay with Apple Pay",
      campaign: "Campaign",
      promise: "100% back if Pittsburgh wins!",
      merchant: "Joe's Pizza",
      live: "Live",
      winChance: "Win chance",
      final: "Final",
      refunded: "Refunded",
      amount: "+$20.00",
      pit: "PIT",
      phi: "PHI",
      versus: "VS",
      /** The final score, PIT first. */
      score: [24, 17],
      /** The win chance the gauge sits on, and the two it swings between (percent). */
      chance: 64,
    },
  },
} as const;
