import type { CampaignStatus, MerchantCategory, SaleState, Sport, TicketPhase } from "@winz/shared";

/**
 * Product copy, US English. Every user-facing string lives here (SPEC section 14), grouped by
 * screen (winz-front-kit/SCREENS.md). No crypto word in anything a fan reads: wallet, USDC,
 * blockchain, chain, gas, seed, token, crypto, on-chain, hedge. A merchant sees "coverage".
 */
export const copy = {
  brand: {
    name: "winz",
    productName: "Winz",
    tagline: "All the hype. None of the risk.",
    description: "Game-day promos that refund your customers if your team wins. We cover the risk.",
  },

  common: {
    continue: "Continue",
    back: "Back",
    close: "Close",
    cancel: "Cancel",
    confirm: "Confirm",
    tryAgain: "Try again",
    copy: "Copy",
    copied: "Link copied",
    share: "Share",
    loading: "Loading",
    optional: "Optional",
    or: "or",
    genericError: "Something went wrong. Try again.",
    networkError: "Can't reach Winz right now. Check your connection.",
    notFoundTitle: "We can't find that page",
    notFoundBody: "The link may be old, or mistyped.",
    soon: "Soon",
    decrease: (what: string): string => `Decrease ${what}`,
    increase: (what: string): string => `Increase ${what}`,
  },

  countdown: {
    days: "Days",
    hours: "Hrs",
    mins: "Mins",
    timeLeft: "Time left",
    aria: (days: number, hours: number, minutes: number): string =>
      `${days.toString()} days, ${hours.toString()} hours, ${minutes.toString()} minutes left`,
  },

  demo: {
    banner: "DEMO MODE",
    scenarioPicker: "Mock scenario",
  },

  nav: {
    home: "Home",
    promos: "Promos",
    stats: "Stats",
    balance: "Balance",
    newPromo: "New promo",
    notifications: "Notifications",
    account: "Your account",
    tickets: "Tickets",
    main: "Main",
  },

  /** M0 */
  start: {
    roleMenu: {
      label: "Switch between venues and fans",
      venues: "For venues",
      tickets: "My tickets",
      ticketsTag: "/TICKETS",
    },
    carouselLabel: "What Winz does",
    slideLabel: (index: number, total: number): string =>
      `Slide ${index.toString()} of ${total.toString()}`,
    goToSlide: (index: number): string => `Go to slide ${index.toString()}`,
    heroAlt: "A football player running with the ball under the stadium lights",
    title: ["All the hype.", "None of the risk."],
    subtitle:
      "Run game-day promos that refund your customers if your team wins. We cover the risk.",
    cta: "Start a promo",
    slides: [
      { title: "Zero risk to venues.", body: "We cover the risk on every promo you run." },
      {
        title: "Automatic payout in $.",
        body: "Your share lands as soon as you sell. The rest after the final whistle.",
      },
      {
        title: "Share your campaign.",
        body: "One link, one QR. Fans pay with Apple Pay in seconds.",
      },
    ],
  },

  /** M1 */
  signIn: {
    emailTitle: "Let's get you set up",
    emailBody: "No password. We'll email you a 6-digit code.",
    emailLabel: "Email",
    emailPlaceholder: "you@yourbusiness.com",
    faceId: "Use Face ID instead",
    codeTitle: "Check your email",
    codeSent: (email: string): string => `We sent a code to ${email}`,
    change: "Change",
    codeLabel: "6-digit code",
    resend: "Resend code",
    resendIn: (seconds: number): string => `Resend code in ${seconds.toString()}s`,
    wrongCode: "That code didn't work. Try again.",
    invalidEmail: "Enter a valid email address.",
    sending: "Sending the code…",
    passkeyFailed: "Face ID didn't work. Use your email instead.",
    codeDigit: (index: number): string => `Digit ${index.toString()} of 6`,
  },

  /** M2 */
  business: {
    title: "Tell us about your spot",
    nameLabel: "Business name",
    namePlaceholder: "Joe's Pizza",
    categoryLabel: "Your category",
    logoLabel: "Add your logo",
    logoUrlPlaceholder: "https://",
    logoAdd: "Add a logo link",
    logoLinkLabel: "Logo link",
    logoInvalid: "Enter a full link, starting with https://",
    logoRemove: "Remove the logo link",
    categories: {
      bar: "Bar",
      pizza: "Pizza",
      burger: "Burger",
      retail: "Retail",
      other: "Other",
    } satisfies Record<MerchantCategory, string>,
  },

  /** The wizard, M3 to M7. The numbers follow the mockups: M6 is 4, M7 is 5. */
  wizard: {
    steps: {
      game: "Pick a game",
      promo: "Pick your promo",
      offer: "Your offer",
      margin: "Your margin and budget",
      review: "Review",
    },
    stepNumber: { game: 1, promo: 2, offer: 3, margin: 4, review: 5 },
    progress: "Your progress",
  },

  /** M3 */
  pickGame: {
    body: "Pick the game your promo rides on. Fans get their money back if it goes your way.",
    searchPlaceholder: "Search teams, leagues or games",
    sportsLabel: "Sport",
    noMatch: "No game matches your search.",
    allSports: "All",
    groups: { tonight: "Tonight", weekend: "This weekend", later: "Later" },
    empty: "No games with open markets right now. Check back closer to game time.",
    oddsNotOpen: "Odds not open yet",
    vs: "VS",
  },
  sports: {
    football: "Football",
    basketball: "Basketball",
    hockey: "Hockey",
    baseball: "Baseball",
    soccer: "Soccer",
    other: "Other",
  } satisfies Record<Sport, string>,

  /** M4 */
  pickPromo: {
    body: "Pick the rule your customers play for. We cover the risk.",
    empty: "No promos for this game yet. Pick another game.",
    recommended: "Recommended",
    back: (percent: number): string => `${percent.toString()}% back`,
    cost: (percent: number): string => `Costs you ~${percent.toString()}% of the price`,
    chance: (percent: number): string => `${percent.toString()}% chance it's free`,
    noBook: "Odds not open yet",
    staleBook: "Odds updating…",
  },

  /** M5 */
  offer: {
    productLabel: "Product name",
    priceLabel: "Product price",
    refundLabel: "Your promise",
    locked: "Locked once your promo is live.",
    defaults: {
      bar: { name: "Pint of beer", priceCents: 800 },
      pizza: { name: "Large pizza", priceCents: 2000 },
      burger: { name: "Smash burger", priceCents: 1400 },
      retail: { name: "Team scarf", priceCents: 2500 },
      other: { name: "Game day special", priceCents: 1500 },
    } satisfies Record<MerchantCategory, { name: string; priceCents: number }>,
    priceRange: "Between $0.50 and $999,999.99.",
    promise: (percent: number, condition: string): string =>
      `${percent.toString()}% back if ${condition}`,
  },

  /** M6 */
  margin: {
    body: "Set what you can spend covering this promo, and the margin you won't go below.",
    usualMargin: "Your usual margin",
    minMargin: "Minimum margin to keep",
    budget: "Coverage budget",
    budgetHint: "The most we can spend covering this promo.",
    costLabel: "Each sale costs you",
    keepLabel: "You keep per sale",
    salesLabel: "Capacity",
    perSale: (amount: string): string => `Each sale costs you ${amount}`,
    keep: (amount: string, percent: number): string =>
      `You keep ${amount} per sale (${percent.toString()}%)`,
    capacity: (sales: number): string => `Up to ${sales.toLocaleString("en-US")} sales`,
    limitedByDepth: "Limited by what the market can cover right now.",
    limitedByBudget: "Limited by your budget.",
    pauses: (subject: string | null, percent: number): string =>
      subject === null
        ? `Your promo pauses if the chances go above ${percent.toString()}%.`
        : `Your promo pauses if ${subject}' chances go above ${percent.toString()}%.`,
    currentChance: "Chance right now",
    pausedPrice:
      "At today's odds this promo would be paused. Lower your minimum margin or pick another promo.",
    pausedMarket: "The market for this game isn't ready yet.",
    budgetChipsLabel: "Quick budgets",
    pausesAt: (percent: number): string => `Pauses at ${percent.toString()}%`,
    reviewCta: "Review the promo",
    pickAnother: "Pick another promo",
  },

  /** M7 */
  review: {
    liveBadge: "Campaign",
    product: "Covered product",
    salesClose: "Sales close",
    budget: "Promo budget",
    costPerSale: "Promo cost per sale",
    keepPerSale: "You keep per sale",
    pausesAbove: "Pauses above",
    chanceUnit: (percent: number): string => `${percent.toString()}% chance`,
    unusedBudget: "Unused budget comes back to you after the game.",
    fund: (amount: string): string => `Fund ${amount} with Apple Pay`,
    payWithCard: "Pay with card",
    simulatePayment: "Simulate payment",
    simulatePaymentOf: (amount: string): string => `Simulate payment · ${amount}`,
    paying: "Paying…",
    cardSoon: "Card payment arrives with the live version.",
  },

  /** M8 */
  live: {
    puttingLive: "Putting your promo live…",
    badge: "Live campaign",
    title: "Your promo is live!",
    days: "Days",
    hours: "Hrs",
    mins: "Mins",
    share: "Share",
    downloadQr: "Download QR",
    downloadPoster: "Download poster",
    dashboard: "Go to my dashboard",
    qrAlt: "QR code of your promo page",
    closeQr: "Close",
    copyLink: "Copy the link",
    enlargeQr: "Enlarge the QR code",
    shareTitle: (merchant: string): string => `${merchant} on Winz`,
    shareText: (promise: string, merchant: string): string =>
      `${promise}. Get yours at ${merchant}.`,
    failedTitle: "We couldn't put your promo live",
    failedBody: "Nothing was charged. Go back and try again.",
    qrDownloaded: "QR code saved",
    qrFailed: "Couldn't save the QR code. Try again.",
    shareFailed: "Couldn't share. The link was copied instead.",
  },

  /** Merchant space (U-05) */
  home: {
    balance: "Balance",
    pending: (amount: string): string => `${amount} pending`,
    pendingNote: "paid after the games",
    withdraw: "Withdraw",
    newPromo: "New promo",
    statistics: "Statistics",
    periods: { month: "This month", week: "This week", today: "Today" },
    grossSales: "Gross sales",
    sales: "Sales",
    activePromos: "Active promos",
    emptyTitle: "Your first promo takes 2 minutes.",
    emptyCta: "Start a promo",
    withdrawTitle: "Withdrawals are simulated in this demo",
    withdrawBody: "No money moves. In production, your balance goes to your bank account.",
  },
  campaigns: {
    inProgress: "In progress",
    closed: "Closed",
    empty: "No promos here yet.",
    status: {
      draft: "Draft",
      funding: "Going live",
      live: "Live",
      paused: "Paused",
      sales_closed: "Sales closed",
      settled_yes: "Won",
      settled_no: "Lost",
      void: "Cancelled",
      closed: "Closed",
    } satisfies Record<CampaignStatus, string>,
    liveBadge: "Live campaign",
    salesCloseIn: "Sales close in",
  },
  campaignDetail: {
    tabs: { stats: "Stats", budget: "Budget", controls: "Controls" },
    sales: "Sales",
    grossSales: "Gross sales",
    coverage: "Coverage",
    coverageCost: "Coverage cost",
    received: "Received",
    pending: "Pending",
    liveChance: "Live chance",
    autoPause: (percent: number): string => `Auto-pause at ${percent.toString()}%`,
    moreSales: (sales: number): string => `Up to ${sales.toLocaleString("en-US")} more sales`,
    budgetUsed: (percent: string): string => `${percent} used`,
    available: "Available",
    addBudget: "Add budget",
    pause: "Pause sales",
    resume: "Resume sales",
    closeNow: "Close sales now",
    closeConfirm: "Close sales for good? Fans won't be able to buy anymore.",
    promiseLocked: "Your refund promise can't change.",
    saleStates: {
      open: "Selling",
      paused_price: "Paused: the chances are above your limit",
      paused_budget: "Paused: budget used up",
      paused_depth: "Paused: market not ready",
      paused_stale: "Paused: market not ready",
      paused_breaker: "Paused: market not ready",
      paused_manual: "Paused by you",
      closed: "Sales closed",
    } satisfies Record<SaleState, string>,
    report: {
      won: "Won",
      lost: "Lost",
      newCustomers: "New customers",
      cost: "Real cost",
      sameAs: (percent: string): string => `Same as a ${percent} discount… but only when you win.`,
      refundsPaid: "Refunds paid",
      paidToYou: "Paid to you",
    },
  },
  settings: {
    title: "Settings",
    profile: "Profile",
    signOut: "Sign out",
    technical: "Technical details",
    address: "Account address",
    explorer: "View on explorer",
  },

  /** Fan, C1 to C3 */
  campaign: {
    badge: "Official matchday promo",
    salesCloseIn: "Sales close in",
    chanceFree: (percent: number): string => `${percent.toString()}% chance it's free`,
    quantity: "Quantity",
    buyApplePay: "Buy with Apple Pay",
    payWithCard: "Pay with card",
    pitch: (conditionLabel: string): string =>
      `Pay the normal price. Get it back if ${conditionLabel}.`,
    paused: "Paused for now. Check back in a few minutes.",
    closed: "Sales are closed for this game",
    won: "Everyone got their money back",
    lost: "Not this time",
  },
  checkout: {
    title: "Checkout",
    emailLabel: "Email",
    emailHint: "We send your ticket link here.",
    securing: "Securing your promo…",
    pausedNoCharge: "Promo just paused, you were not charged",
    failed: "Your payment didn't go through.",
    simulatePayment: "Simulate payment",
    total: "Total",
  },
  ticket: {
    brand: "winz",
    showAtCounter: "Show at the counter",
    paid: (amount: string): string => `${amount} paid`,
    chanceTitle: (percent: number): string => `${percent.toString()}% chance this is free`,
    chanceUnit: "Chance it's free",
    liveOdds: "Live odds",
    freeIf: (conditionLabel: string): string => `Free if ${conditionLabel}`,
    gameOn: "Game on",
    refunded: "Refunded",
    refundedLine: (merchant: string): string => `Your order was on ${merchant}.`,
    shareWin: "Share the win",
    notThisTime: (merchant: string): string =>
      `Not this time. Thanks for playing with ${merchant}.`,
    findAnother: "Find another promo",
    cancelled: "Game cancelled · your purchase stands",
    cancelledBody:
      "The game didn't go ahead, so there's nothing to refund. You keep what you bought.",
    addToHome: "Add Winz to Home Screen",
    addToHomeIos: "Tap Share, then Add to Home Screen.",
    phases: {
      pre_game: "Before the game",
      in_game: "Game on",
      refunded: "Refunded",
      not_this_time: "Not this time",
      cancelled: "Cancelled",
    } satisfies Record<TicketPhase, string>,
  },
  tickets: {
    title: "My tickets",
    refundedSoFar: "refunded so far",
    tabs: { live: "Live", won: "Won", past: "Past" },
    emptyLive: "No live tickets. Scan a promo at your favorite spot.",
    emptyWon: "Nothing refunded yet.",
    emptyPast: "No past tickets yet.",
  },

  /** Jury and demo */
  hedgeDesk: {
    title: "Hedge desk",
    totals: {
      makerSavings: "Maker savings",
      guaranteeLosses: "Guarantee losses",
      crossingGains: "Crossing gains",
    },
    unhedged: "Unhedged",
    armed: "Armed",
    proof: "Real-order proof",
    notRun: "Not run yet",
  },
  admin: {
    title: "Demo panel",
    keyLabel: "Admin key",
    driveOdds: "Drive the odds",
    forceResult: "Force the result",
    replaySale: "Replay a sale",
    reset: "Reset demo",
  },

  /** Words used for the sale state on a fan screen */
  saleState: {
    paused: "Paused for now",
    closed: "Sales closed",
  },
} as const;

export type Copy = typeof copy;
