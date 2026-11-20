/**
 * The one example the whole page tells, the one of the demo video and the README: Buzzball’s shop (the
 * typographic apostrophe, as the name is stored in production) sells a $12.00 smash burger, 100% back if
 * Texas wins, for Arkansas at Texas (Texas at home) on Saturday, November 21, kickoff 2:30 PM Central. The
 * names, the abbreviations and the win chances are the app's own for that game
 * (`packages/shared/src/api/examples.ts`, `lib/server/mock-answers.ts`); the promo link has the slug the
 * engine would build from the merchant's name and the condition (`apps/engine/src/jobs/handlers/slug.ts`).
 * How it works and the Process section both read it, so the two never tell different stories.
 */
const example = {
  merchant: "Buzzball’s shop",
  item: "Smash burger",
  price: "$12.00",
  promise: "100% back if Texas wins!",
  /** What the fan gets back when Texas wins: the whole price. */
  refund: "+$12.00",
  home: { name: "Texas", abbreviation: "TEX", chance: 91 },
  away: { name: "Arkansas", abbreviation: "ARK", chance: 9 },
  /** Kickoff, as the app's match card writes it (Central time). */
  kickoff: { time: "2:30", meridiem: "PM", date: "Nov 21" },
  /** The score while the game is on, then the final one. */
  scoreLive: { home: 17, away: 17 },
  scoreFinal: { home: 31, away: 17 },
  /** The promo's link, without the scheme, as the app's share screen shows it. */
  link: "winz-nu.vercel.app/c/buzzballs-shop-texas-wins",
  /** The merchant's e-mail typed in Process step 01: 18 characters, one step of `pe-type` each. */
  email: "alex@buzzballs.com",
} as const;

/**
 * The landing page's own text. It comes from the design team's copy deck; the page's
 * sections add their strings here. It
 * is not `lib/copy.ts`: that file is the app's, and its tests forbid words (USDC, hedge) that the
 * landing is allowed to use.
 */
export const landingCopy = {
  example,

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
   * them): they say what the picture shows, with the page's one example (`example` above: Arkansas at
   * Texas, Buzzball’s shop, $12.00). The Fan tab says nothing a fan would not read in the app: no
   * wallet, no chain, no token.
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
        alt: "A match card, Arkansas at Texas at 2:30 PM on November 21, with the Budget and Promo steps ticked.",
      },
      {
        title: "Pay by card",
        body: "The promo is live in about ten seconds.",
        alt: "The promo's campaign card, 100% back if Texas wins at Buzzball’s shop, with the Fund with Apple Pay and Fund with card buttons.",
      },
      {
        title: "Show the QR",
        body: "Put it on the counter or send the link.",
        alt: "The promo's QR code, with its link, winz-nu.vercel.app/c/buzzballs-shop-texas-wins, and a Download QR button.",
      },
    ],
    fan: [
      {
        title: "Scan and pay",
        body: "Apple Pay or a card. One tap, no app to install.",
        alt: "The Buzzball’s shop campaign card, 100% back if Texas wins, with a Scan the QR tag and a Pay with Apple Pay button.",
      },
      {
        title: "Follow your ticket",
        body: "It updates live during the game. No refresh.",
        alt: "A live ticket for Texas against Arkansas, with a 64% win chance.",
      },
      {
        title: "Team wins, money back",
        body: "The refund lands on its own. Nothing to claim.",
        alt: "The final ticket, Texas 31, Arkansas 17, refunded $12.00.",
      },
    ],
    /**
     * The words inside the illustrations of both tabs (COPY.md: the chips), and the example they share.
     * `home` and `away` are the teams' abbreviations, `score` the final score.
     */
    scene: {
      scanTheQr: "Scan the QR",
      payWithApplePay: "Pay with Apple Pay",
      campaign: "Campaign",
      promise: example.promise,
      merchant: example.merchant,
      live: "Live",
      winChance: "Win chance",
      final: "Final",
      refunded: "Refunded",
      amount: example.refund,
      home: example.home.abbreviation,
      away: example.away.abbreviation,
      versus: "VS",
      score: example.scoreFinal,
      /** The win chance the gauge sits on, and the two it swings between (percent). */
      chance: 64,
    },
    /**
     * The Merchant illustrations: the match card of the wizard's first step (the app's `MatchCard`, its
     * teams' full names and their chances to win), the funding step's two buttons, and the share step's
     * link, QR and download button.
     */
    merchantScene: {
      budget: "Budget",
      promo: "Promo",
      kickoff: example.kickoff,
      teams: { home: example.home, away: example.away },
      fundWithApplePay: "Fund with Apple Pay",
      fundWithCard: "Fund with card",
      link: example.link,
      downloadQr: "Download QR",
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
   * step, and the same example as How it works (`example` above: Arkansas at Texas, Buzzball’s shop, $12.00).
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
        email: example.email,
        code: "428019",
      },
      /** Step 02: the first screen of the promo wizard. The amount is counted up by the stylesheet, to $250. */
      pick: {
        title: "1. Pick a game",
        home: example.home.name,
        away: example.away.name,
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
        merchant: example.merchant,
        promise: example.promise,
        pay: "Pay with Apple Pay",
        amount: example.price,
        winChance: "Win chance",
        home: example.home.abbreviation,
        away: example.away.abbreviation,
        live: "Live",
        final: "Final",
        refunded: "Refunded",
        refund: example.refund,
        /** The score while the game is on, then the final one. */
        scoreBefore: example.scoreLive,
        score: example.scoreFinal,
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
    /** The secondary link under the button: the repository, whatever the state of the primary one. */
    repo: "View on GitHub",
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
    statement: { first: "Every promo takes a risk.", second: "Winz covers it." },
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
    /** The repository, last link of the Winz column (the anchors come first). */
    github: "GitHub",
    project: { title: "Project", github: "GitHub", devpost: "Devpost", video: "Demo video" },
    builtAt: { title: "Built at", items: ["UBC 2026", "Consumer app track", "Austin, Texas"] },
    legal: {
      copyright: "© 2026 Winz",
      builtBy: "Built by",
      and: "and",
      note: "Hackathon prototype on test networks. No real funds.",
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
