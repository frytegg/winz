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

  /**
   * The Demo's H2 (COPY.md section 4), in the runs it is set in: `highlight` is lime, and the line breaks
   * before `second`. The page reads it the way it reads `heroTitle`.
   */
  demoTitle: {
    before: "Watch ",
    highlight: "a promo",
    second: "go live and settle.",
  },

  /**
   * Demo (COPY.md section 4). `play` is the accessible name of the play button, `soon` what is said under
   * it while there is no video, `frameTitle` the title of the iframe that replaces it, and `external` the
   * name of the button when the video is somewhere a page cannot embed (a link in a new tab).
   */
  demo: {
    eyebrow: "Demo",
    cta: "Try the live demo",
    play: "Play the Winz demo video",
    soon: "Demo video coming soon.",
    frameTitle: "Winz demo video",
    external: "Watch the Winz demo video (opens in a new tab)",
  },

  /**
   * Process, the "Test it in three minutes" section (COPY.md section 5, anchor `#live-demo`). The six
   * steps' titles and descriptions are COPY.md's, with its two corrections (the e-mail sentence, and a
   * single full stop at the end of step 01). `scene` is what the phone screens say: COPY.md's list for each
   * step, and the same example data as How it works (Pittsburgh against Philadelphia, Joe's Pizza, $20.00).
   * The screens are decoration (`aria-hidden`): the text of the steps carries the meaning.
   */
  process: {
    eyebrow: "Live demo",
    title: "Test it in three minutes.",
    /** Followed by the step's number on two digits: "Step 01". */
    stepLabel: "Step",
    steps: [
      {
        title: "Onboarding",
        body: "Open the live demo and create a promo. Use any e-mail: a login code is sent to it.",
      },
      {
        title: "Create your first promo",
        body: "Pick a game, write the promise and set a budget. $250 is enough for the demo.",
      },
      {
        title: "Fund it by card",
        body: "Pay with the test card 4242 4242 4242 4242, any future date, any CVC. The promo is live in about ten seconds.",
      },
      {
        title: "Share it",
        body: "Open the full-screen QR, copy the link or download the poster.",
      },
      {
        title: "Buy as a fan",
        body: "Scan the QR with your phone camera and pay with Apple Pay or a card. Your ticket shows up live.",
      },
      {
        title: "Team wins, refund lands",
        body: "When the team wins, the ticket turns to refunded. The fan has nothing to do.",
      },
    ],
    scene: {
      /** Step 01: the sign-in screen. The e-mail is typed into the field, then the code into its six boxes. */
      onboarding: {
        title: "Let's get you set up",
        subtitle: "No password. We'll email you a 6-digit code.",
        emailLabel: "Email",
        emailPlaceholder: "Your email…",
        email: "alex@joespizza.com",
        code: "428019",
      },
      /** Step 02: the first screen of the promo wizard. The amount is counted up by the stylesheet, to $250. */
      pick: {
        title: "1. Pick a game",
        home: "Pittsburgh",
        away: "Philadelphia",
        versus: "VS",
        back: "100% back",
        budget: "Budget",
      },
      /** Step 03: paying the promo by card. */
      fund: {
        title: "Pay by card",
        cardLabel: "Card number",
        /** The groups of the test card, one per step of the typing. */
        card: ["4242", "4242", "4242", "4242"],
        button: "Fund with card",
        pending: "Putting your promo live…",
        live: "Live",
      },
      /** Step 04: the promo's QR, its link and its poster. `linkFallback` when the page has no link to show. */
      share: {
        linkFallback: "Your promo link",
        toast: "Link copied",
        poster: "Download poster",
      },
      /** Steps 05 and 06: what the fan sees, and the ticket that comes of it. */
      fan: {
        merchant: "Joe's Pizza",
        promise: "100% back if Pittsburgh wins!",
        pay: "Pay with Apple Pay",
        amount: "$20.00",
        winChance: "Win chance",
        pit: "PIT",
        phi: "PHI",
        live: "Live",
        final: "Final",
        refunded: "Refunded",
        refund: "+$20.00",
        /** The score while the game is on, then the final one, PIT first. */
        scoreBefore: [17, 17],
        score: [24, 17],
        ticket: "Your ticket",
      },
    },
  },

  /**
   * Features (COPY.md section 6). `icon` is the file of `public/landing/features/`. The icons are
   * decoration (the title says it all): icon-01 and icon-06 are the same file, as on the mockup.
   */
  features: {
    eyebrow: "Features",
    title: "Designed to be adopted.",
    subtitle: "Everything a promo needs. Nothing a fan has to learn.",
    items: [
      {
        icon: "icon-01",
        title: "One-tap payment",
        body: "Apple Pay or a card. No app to install, no wallet to set up.",
      },
      {
        icon: "icon-02",
        title: "A ticket that stays live",
        body: "The ticket and its gauge update in real time, with no refresh.",
      },
      {
        icon: "icon-03",
        title: "Share by scan",
        body: "A short link, a full-screen QR, native share and a printable poster.",
      },
      {
        icon: "icon-04",
        title: "Set a budget",
        body: "Automatic pause when it runs out, or when the hedge gets too expensive.",
      },
      {
        icon: "icon-05",
        title: "Transparent hedge desk",
        body: "See what is covered, at what price, on which book.",
      },
      {
        icon: "icon-06",
        title: "Payments that behave",
        body: "A declined card gets a clear message.",
      },
    ],
  },

  /**
   * The closing call to action (COPY.md section 7). The alt describes what the picture shows, as COPY.md
   * words it. `button` is the one primary button: inactive ("Opening soon") while there is no repository.
   */
  cta: {
    title: "Refunded if the team wins.",
    button: "View the code",
    illustrationAlt:
      "The Winz app: picking a game, the opening screen and a live promo with its QR code.",
  },

  /**
   * The footer (COPY.md section 8, designed in `sections/08-footer.md`). The statement is set in two tones:
   * `first` in gray, `second` in black. `links` of the Winz column are the page's own anchors; the Project
   * column's links are `landingLinks`' and a link that is not decided is not rendered (its label waits here
   * for the day it is). `builtAt` is text, not links. The legal line is built from `builtBy` and the names in
   * `landingLinks.teamLinks` (a name is a link when it has one).
   */
  footer: {
    label: "Footer",
    statement: { first: "Every promo is a bet.", second: "Winz hedges it." },
    app: {
      title: "Get the app",
      body: "Winz is a web app. Add it to your home screen.",
      button: "Add to Home Screen",
    },
    winz: {
      title: "Winz",
      links: [
        { label: "How it works", href: "#how" },
        { label: "Demo video", href: "#demo" },
        { label: "Features", href: "#features" },
        { label: "Live demo", href: "#live-demo" },
      ],
    },
    project: { title: "Project", github: "GitHub", devpost: "Devpost", video: "Demo video" },
    builtAt: { title: "Built at", items: ["UBC 2026", "Consumer app track", "Austin, Texas"] },
    legal: {
      copyright: "© 2026 Winz",
      builtBy: "Built by",
      and: "and",
      note: "Hackathon prototype on test networks. No real funds, no real bets.",
    },
  },

  /**
   * The sheet "Get Winz on your phone" (COPY.md section 9), shared by the three "Try the live demo" buttons
   * and the footer's "Add to Home Screen". The lines COPY.md does not have are the names of things a
   * screen reader needs (`close`, `qrLabel`, `steps`' icons) and the copy fallback (`copyFailed`).
   */
  install: {
    title: "Get Winz on your phone",
    subtitle: "It's a web app. No store, no download.",
    addToHome: "Add to Home Screen",
    accepted: "Winz is on your home screen. Open it from there.",
    androidMenu: "Open the browser menu (⋮), then choose Add to Home screen or Install app.",
    iosSteps: ["Tap Share", "Choose Add to Home Screen", "Open Winz from your home screen"],
    /** Said to a screen reader while the arrow points at the toolbar (an iPhone's is at the bottom). */
    iosArrowIphone: "The Share button is in the bar at the bottom of the screen.",
    iosArrowIpad: "The Share button is at the top of the screen.",
    inApp: "Open this page in Safari (or Chrome) to install Winz.",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    copyFailed: "Copying is not allowed here. Select the address above and copy it.",
    desktop: "Scan with your phone to open Winz.",
    openInBrowser: "Open in browser instead",
    bestOnPhone: "Best on your phone",
    close: "Close",
    qrLabel: "A QR code that opens Winz",
  },
} as const;
