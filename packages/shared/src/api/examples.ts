import type {
  CampaignActionResponse,
  CampaignEvent,
  CampaignDetail,
  CampaignPreviewRequest,
  CampaignPreviewResponse,
  CampaignsResponse,
  CampaignSummary,
  CheckoutResponse,
  CheckoutStatusResponse,
  CreateCampaignResponse,
  DemoResponse,
  EventsResponse,
  HedgeDeskResponse,
  MeResponse,
  Merchant,
  PublicCampaign,
  Ticket,
  TicketsResponse,
  TopUpCampaignResponse,
} from "./schemas";

/**
 * One example answer per route, with a few scenarios. They are the payloads the mock API serves
 * (`APP_API_MOCK=true`) and each one is checked against its schema in tests.
 *
 * The running example tells the story of the promos filmed for the demo video: the merchant
 * « Buzzball’s shop » (with the typographic apostrophe, as it is stored in production) sells a $12
 * smash burger, 100 % back if Texas wins by 14 or more, with the condition quoted at 12 % (SPEC
 * section 4.3 tells the same promo with a $20 pizza). Every amount below follows from that price:
 * 12 sales are $144 of gross sales and, at 100 % back, $144 of exposure.
 */

const SYMBOL = "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13";
const STARTS_AT = "2026-11-21T20:30:00.000Z";
const SALES_CLOSE_AT = "2026-11-21T20:25:00.000Z";
const EVENT_TITLE = "Arkansas vs Texas";
const CONDITION = "Texas wins by 14+";
const PROMISE = "100% back if Texas wins by 14+";
/** The team the condition is about, as the label writes it. */
const SUBJECT = "Texas";
/** The condition in the past tense, on YES and on NO. */
const RESULT_YES = "Texas won by 14+";
const RESULT_NO = "Texas did not win by 14+";

const TEXAS = { name: "Texas Longhorns", abbreviation: "TEX", logoUrl: null };
const ARKANSAS = { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: null };
const PITT = { name: "Pittsburgh Panthers", abbreviation: "PITT", logoUrl: null };
const VILLANOVA = { name: "Villanova Wildcats", abbreviation: "VILL", logoUrl: null };

/** The merchant and the product of the running example. */
const MERCHANT_NAME = "Buzzball’s shop";
const PRODUCT = "Smash burger";
/** $12.00, in micro-USDC. */
const UNIT_PRICE = "12000000";
/** The public slugs, as the engine builds them: merchant name, then the condition (`slug.ts`). */
const SLUG = "buzzballs-shop-texas-wins-by-14";
const PITT_SLUG = "buzzballs-shop-pittsburgh-wins";

/** The game of the running example, as campaigns and tickets carry it. */
const GAME: CampaignEvent = { sport: "football", league: "NCAAF", home: TEXAS, away: ARKANSAS };
const PITT_GAME: CampaignEvent = {
  sport: "basketball",
  league: "NCAAM",
  home: PITT,
  away: VILLANOVA,
};

export const merchantExample: Merchant = {
  id: "mer_joes",
  name: MERCHANT_NAME,
  category: "burger",
  logoUrl: null,
  defaultUsualMarginBps: 6500,
};

export const meExamples = {
  merchant: {
    user: {
      id: "usr_joe",
      email: "buzzball@example.com",
      roles: ["merchant"],
      walletAddress: "0x1111111111111111111111111111111111111111",
    },
    merchant: merchantExample,
    // Available: the Pitt promo, settled, paid every sale (31 × $12). Pending: the Texas promo,
    // still on sale (12 × $12), paid after its game.
    balance: { available: "372000000", pending: "144000000" },
  },
  newUser: {
    user: { id: "usr_new", email: "new@example.com", roles: [], walletAddress: null },
    merchant: null,
    balance: null,
  },
  fan: {
    user: { id: "usr_maya", email: "maya@example.com", roles: ["fan"], walletAddress: null },
    merchant: null,
    balance: null,
  },
} satisfies Record<string, MeResponse>;

export const eventsExample: EventsResponse = {
  events: [
    {
      ticker: "NCAAF-2611212030-ARK-TEX-M",
      title: EVENT_TITLE,
      sport: "football",
      league: "NCAAF",
      startsAt: STARTS_AT,
      salesCloseAt: SALES_CLOSE_AT,
      // Each team's chance is the mid of its own moneyline contract (the two templates below).
      home: { ...TEXAS, winProbabilityBps: 9100 },
      away: { ...ARKANSAS, winProbabilityBps: 900 },
      templates: [
        {
          id: "tpl_tex13_full",
          instrumentSymbol: SYMBOL,
          type: "spread",
          conditionLabel: CONDITION,
          headline: "Free if Texas wins by 14+",
          subjectName: SUBJECT,
          team: "home",
          refundBps: 10_000,
          probabilityBps: 1200,
          costBps: 1380,
          available: true,
          unavailableReason: null,
        },
        {
          id: "tpl_tex_ml_half",
          instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
          type: "moneyline",
          conditionLabel: "Texas wins",
          headline: "Half back if Texas wins",
          subjectName: "Texas",
          team: "home",
          refundBps: 5000,
          probabilityBps: 9100,
          costBps: 4626,
          available: true,
          unavailableReason: null,
        },
        {
          id: "tpl_ark_ml_full",
          instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK",
          type: "moneyline",
          conditionLabel: "Arkansas wins",
          headline: "Free if Arkansas pulls the upset",
          subjectName: "Arkansas",
          team: "away",
          refundBps: 10_000,
          probabilityBps: 900,
          costBps: 1063,
          available: true,
          unavailableReason: null,
        },
        {
          id: "tpl_tex20_full",
          instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX20",
          type: "spread",
          conditionLabel: "Texas wins by 21+",
          headline: "Free if Texas wins by 21+",
          subjectName: "Texas",
          team: "home",
          refundBps: 10_000,
          probabilityBps: null,
          costBps: null,
          available: false,
          unavailableReason: "no_book",
        },
      ],
    },
    {
      ticker: "NCAAM-2611180000-VILL-PITT-M",
      title: "Villanova vs Pittsburgh",
      sport: "basketball",
      league: "NCAAM",
      startsAt: "2026-11-18T00:00:00.000Z",
      salesCloseAt: "2026-11-17T23:55:00.000Z",
      // No Villanova moneyline is listed: no chance for that team.
      home: { ...PITT, winProbabilityBps: 4650 },
      away: { ...VILLANOVA, winProbabilityBps: null },
      templates: [
        {
          id: "tpl_pitt_ml_half",
          instrumentSymbol: "GEMI-NCAAM-2611180000-VILL-PITT-M-PITT",
          type: "moneyline",
          conditionLabel: "Pittsburgh wins",
          headline: "Half back if Pitt wins",
          subjectName: "Pittsburgh",
          team: "home",
          refundBps: 5000,
          probabilityBps: 4650,
          costBps: 2438,
          available: true,
          unavailableReason: null,
        },
      ],
    },
  ],
};

/**
 * The terms M6 sends for the running example: the $12 smash burger, 100 % back if Texas wins by 14+,
 * a usual margin of 65 %, a minimum of 45 % and a $1,000 budget.
 */
export const campaignPreviewRequestExample: CampaignPreviewRequest = {
  instrumentSymbol: SYMBOL,
  unitPrice: UNIT_PRICE,
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  budget: "1000000000",
};

/**
 * The answers to `campaignPreviewRequestExample`. The simulated API computes them with the pricing
 * function of the real route on its simulated books (apps/web/lib/server/mock-answers.ts), and a
 * test checks that these examples are what it computes.
 */
export const campaignPreviewExamples = {
  open: {
    maxCostBps: 2000,
    pauseThresholdBps: 1800,
    currentProbabilityBps: 1200,
    costPerSale: "1656000",
    marginKeptPerSale: "6144000",
    marginKeptBps: 5120,
    capacity: { sales: 458, limitedBy: "depth" },
    saleState: "open",
    bookAsOf: "2026-11-17T15:00:00.000Z",
  },
  aboveThreshold: {
    maxCostBps: 2000,
    pauseThresholdBps: 1800,
    currentProbabilityBps: 2300,
    costPerSale: "3033600",
    marginKeptPerSale: "4766400",
    marginKeptBps: 3972,
    capacity: { sales: 0, limitedBy: "depth" },
    saleState: "paused_price",
    bookAsOf: "2026-11-17T15:00:00.000Z",
  },
  noBook: {
    maxCostBps: 2000,
    pauseThresholdBps: 1800,
    currentProbabilityBps: null,
    costPerSale: null,
    marginKeptPerSale: null,
    marginKeptBps: null,
    capacity: { sales: 0, limitedBy: "depth" },
    saleState: "paused_depth",
    bookAsOf: null,
  },
} satisfies Record<string, CampaignPreviewResponse>;

export const createCampaignExample: CreateCampaignResponse = {
  campaignId: "cmp_joes_texas",
  status: "funding",
  budgetPayment: {
    paymentIntentId: "pi_budget_example",
    clientSecret: "pi_budget_example_secret_example",
    amount: "1000000000",
  },
};

/**
 * POST /api/campaigns. `repeated` is the answer to the same `requestId` sent again before the
 * budget is paid: the same campaign and the same payment. `repeatedLive` is the answer to it once
 * the campaign is live: the same campaign and payment, with its status of the moment (nothing more
 * to pay: open the campaign instead of the payment sheet).
 */
export const createCampaignExamples = {
  created: createCampaignExample,
  repeated: createCampaignExample,
  repeatedLive: { ...createCampaignExample, status: "live" },
} satisfies Record<string, CreateCampaignResponse>;

const summaryLive: CampaignSummary = {
  id: "cmp_joes_texas",
  slug: SLUG,
  product: PRODUCT,
  promise: PROMISE,
  status: "live",
  saleState: "open",
  eventTitle: EVENT_TITLE,
  event: GAME,
  startsAt: STARTS_AT,
  salesCloseAt: SALES_CLOSE_AT,
  sales: 12,
  revenue: "144000000",
  createdAt: "2026-11-20T22:41:00.000Z",
  liveAt: "2026-11-20T22:42:10.000Z",
};

const detailLive: CampaignDetail = {
  ...summaryLive,
  conditionLabel: CONDITION,
  subjectName: SUBJECT,
  resultLabel: null,
  instrumentSymbol: SYMBOL,
  unitPrice: UNIT_PRICE,
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  pauseThresholdBps: 1800,
  probabilityBps: 1200,
  budget: "1000000000",
  // 96 of the 144 contracts are held, 48 are reserved: $1,000 − $12.096 − $6.5952 is available.
  hedgeSpent: "12096000",
  hedgeReserved: "6595200",
  budgetAvailable: "981308800",
  exposure: "144000000",
  hedgedBps: 6667,
  capacitySales: 300,
  received: "0",
  pending: "144000000",
  outcome: null,
  url: `https://winz.app/c/${SLUG}`,
  onchain: {
    campaignId: "1",
    escrowAddress: "0x2222222222222222222222222222222222222222",
    explorerUrl:
      "https://explorer.testnet.arc.io/address/0x2222222222222222222222222222222222222222",
  },
  report: null,
  demo: false,
};

export const campaignDetailExamples = {
  live: detailLive,
  paused: {
    ...detailLive,
    status: "paused",
    saleState: "paused_price",
    probabilityBps: 2300,
    capacitySales: 0,
  },
  settledYes: {
    ...detailLive,
    status: "settled_yes",
    saleState: "closed",
    probabilityBps: null,
    hedgeSpent: "17928000",
    hedgeReserved: "0",
    budgetAvailable: "982072000",
    hedgedBps: 10_000,
    capacitySales: 0,
    received: "144000000",
    pending: "0",
    outcome: "yes",
    resultLabel: RESULT_YES,
    report: {
      sales: 12,
      newCustomers: 9,
      hedgeCost: "17928000",
      hedgeCostBps: 1245,
      equivalentDiscountBps: 1245,
      refundsPaid: "144000000",
      paidToMerchant: "144000000",
    },
  },
  settledNo: {
    ...detailLive,
    status: "settled_no",
    saleState: "closed",
    probabilityBps: null,
    hedgeSpent: "17928000",
    hedgeReserved: "0",
    budgetAvailable: "982072000",
    hedgedBps: 10_000,
    capacitySales: 0,
    received: "144000000",
    pending: "0",
    outcome: "no",
    resultLabel: RESULT_NO,
    report: {
      sales: 12,
      newCustomers: 9,
      hedgeCost: "17928000",
      hedgeCostBps: 1245,
      equivalentDiscountBps: 1245,
      refundsPaid: "0",
      paidToMerchant: "144000000",
    },
  },
  /**
   * The game was cancelled (VOID, ST-4): treated as NO for the escrow, so nobody is refunded and
   * the merchant keeps every sale; the coverage already charged is paid back, so the report's cost
   * is zero. No result label for a void game.
   */
  cancelled: {
    ...detailLive,
    status: "void",
    saleState: "closed",
    probabilityBps: null,
    hedgeSpent: "17928000",
    hedgeReserved: "0",
    budgetAvailable: "982072000",
    hedgedBps: 10_000,
    capacitySales: 0,
    received: "144000000",
    pending: "0",
    outcome: "void",
    resultLabel: null,
    report: {
      sales: 12,
      newCustomers: 9,
      hedgeCost: "0",
      hedgeCostBps: 0,
      equivalentDiscountBps: 0,
      refundsPaid: "0",
      paidToMerchant: "144000000",
    },
  },
} satisfies Record<string, CampaignDetail>;

export const campaignsExample: CampaignsResponse = {
  campaigns: [
    summaryLive,
    {
      ...summaryLive,
      id: "cmp_joes_pitt",
      slug: PITT_SLUG,
      promise: "50% back if Pitt wins",
      status: "settled_no",
      saleState: "closed",
      eventTitle: "Villanova vs Pittsburgh",
      event: PITT_GAME,
      startsAt: "2026-11-18T00:00:00.000Z",
      salesCloseAt: "2026-11-17T23:55:00.000Z",
      sales: 31,
      revenue: "372000000",
      createdAt: "2026-11-17T21:02:00.000Z",
      liveAt: "2026-11-17T21:03:05.000Z",
    },
  ],
};

/**
 * GET /api/campaigns with a promo whose budget was never paid (the merchant closed the payment
 * sheet): it stays `funding`, `liveAt` null, and the back end never expires it. The front hides
 * such a promo once `createdAt` is old enough.
 */
export const campaignsWithFundingExample: CampaignsResponse = {
  campaigns: [
    {
      ...summaryLive,
      id: "cmp_joes_texas_unpaid",
      slug: null,
      status: "funding",
      saleState: "closed",
      sales: 0,
      revenue: "0",
      createdAt: "2026-11-20T21:58:00.000Z",
      liveAt: null,
    },
    ...campaignsExample.campaigns,
  ],
};

/**
 * GET /api/campaigns with a promo whose game was cancelled (`void`): it sold before the game, and the
 * merchant keeps that money (ST-4), so its sales belong in the totals.
 */
export const campaignsWithCancelledExample: CampaignsResponse = {
  campaigns: [
    ...campaignsExample.campaigns,
    {
      ...summaryLive,
      id: "cmp_joes_pitt_cancelled",
      slug: "buzzballs-shop-pittsburgh-wins-by-7",
      promise: "100% back if Pitt wins by 7+",
      status: "void",
      saleState: "closed",
      eventTitle: "Villanova vs Pittsburgh",
      event: PITT_GAME,
      startsAt: "2026-11-11T00:00:00.000Z",
      salesCloseAt: "2026-11-10T23:55:00.000Z",
      sales: 5,
      revenue: "60000000",
      createdAt: "2026-11-10T20:02:00.000Z",
      liveAt: "2026-11-10T20:03:05.000Z",
    },
  ],
};

export const campaignActionExamples = {
  paused: { status: "paused", saleState: "paused_manual" },
  resumed: { status: "live", saleState: "open" },
  closed: { status: "sales_closed", saleState: "closed" },
} satisfies Record<string, CampaignActionResponse>;

const publicLive: PublicCampaign = {
  slug: SLUG,
  merchant: { name: MERCHANT_NAME, logoUrl: null, category: "burger" },
  product: PRODUCT,
  unitPrice: UNIT_PRICE,
  refundBps: 10_000,
  promise: PROMISE,
  conditionLabel: CONDITION,
  subjectName: SUBJECT,
  resultLabel: null,
  eventTitle: EVENT_TITLE,
  event: GAME,
  probabilityBps: 1200,
  saleState: "open",
  startsAt: STARTS_AT,
  salesCloseAt: SALES_CLOSE_AT,
  outcome: null,
  instrumentSymbol: SYMBOL,
  demo: false,
};

export const publicCampaignExamples = {
  live: publicLive,
  paused: { ...publicLive, saleState: "paused_price", probabilityBps: 2300 },
  salesClosed: { ...publicLive, saleState: "closed" },
  settledYes: {
    ...publicLive,
    saleState: "closed",
    probabilityBps: null,
    outcome: "yes",
    resultLabel: RESULT_YES,
  },
  settledNo: {
    ...publicLive,
    saleState: "closed",
    probabilityBps: null,
    outcome: "no",
    resultLabel: RESULT_NO,
  },
} satisfies Record<string, PublicCampaign>;

export const checkoutExample: CheckoutResponse = {
  paymentIntentId: "pi_example",
  clientSecret: "pi_example_secret_example",
  amount: UNIT_PRICE,
};

export const checkoutStatusExamples = {
  processing: { status: "processing", ticketToken: null, message: null },
  ticketed: { status: "ticketed", ticketToken: "tkt_example_joes_texas", message: null },
  cancelledPaused: {
    status: "cancelled_paused",
    ticketToken: null,
    message: "Promo just paused, you were not charged",
  },
  failed: {
    status: "failed",
    ticketToken: null,
    message: "Something went wrong, you were not charged",
  },
} satisfies Record<string, CheckoutStatusResponse>;

const ticketPreGame: Ticket = {
  token: "tkt_example_joes_texas",
  campaignSlug: SLUG,
  merchant: { name: MERCHANT_NAME, logoUrl: null },
  product: PRODUCT,
  qty: 1,
  paid: UNIT_PRICE,
  refundable: UNIT_PRICE,
  promise: PROMISE,
  conditionLabel: CONDITION,
  subjectName: SUBJECT,
  resultLabel: null,
  eventTitle: EVENT_TITLE,
  event: GAME,
  phase: "pre_game",
  probabilityBps: 1400,
  startsAt: STARTS_AT,
  purchasedAt: "2026-11-20T23:10:00.000Z",
  refundedAt: null,
  instrumentSymbol: SYMBOL,
  demo: false,
};

export const ticketExamples = {
  preGame: ticketPreGame,
  inGame: { ...ticketPreGame, phase: "in_game", probabilityBps: 3100 },
  refunded: {
    ...ticketPreGame,
    phase: "refunded",
    probabilityBps: null,
    resultLabel: RESULT_YES,
    refundedAt: "2026-11-22T00:05:08.000Z",
  },
  notThisTime: {
    ...ticketPreGame,
    phase: "not_this_time",
    probabilityBps: null,
    resultLabel: RESULT_NO,
  },
  // A void game has no result in words: the ticket says the game was cancelled.
  cancelled: { ...ticketPreGame, phase: "cancelled", probabilityBps: null },
} satisfies Record<string, Ticket>;

export const ticketsExample: TicketsResponse = {
  tickets: [
    ticketPreGame,
    {
      ...ticketPreGame,
      token: "tkt_example_joes_pitt",
      campaignSlug: PITT_SLUG,
      promise: "50% back if Pitt wins",
      conditionLabel: "Pittsburgh wins",
      subjectName: "Pittsburgh",
      resultLabel: "Pittsburgh won",
      eventTitle: "Villanova vs Pittsburgh",
      event: PITT_GAME,
      // 50 % back on $12.
      refundable: "6000000",
      phase: "refunded",
      probabilityBps: null,
      startsAt: "2026-11-18T00:00:00.000Z",
      purchasedAt: "2026-11-17T22:41:00.000Z",
      refundedAt: "2026-11-18T02:31:12.000Z",
      instrumentSymbol: "GEMI-NCAAM-2611180000-VILL-PITT-M-PITT",
    },
  ],
  refundedTotal: "6000000",
};

const pittRefunded: Ticket = ticketsExample.tickets[1] ?? ticketPreGame;

/**
 * More answers of `GET /api/tickets`, for « My tickets » (C4): nobody's ticket yet, one ticket in
 * each phase (two of the same promo, bought twice, for the quantity), and a demo ticket.
 */
export const ticketsExamples = {
  noTickets: { tickets: [], refundedTotal: "0" },
  severalTickets: {
    tickets: [
      {
        ...ticketPreGame,
        token: "tkt_example_joes_texas_two",
        qty: 2,
        paid: "24000000",
        refundable: "24000000",
      },
      { ...ticketExamples.inGame, token: "tkt_example_joes_texas_live" },
      pittRefunded,
      {
        ...ticketExamples.notThisTime,
        token: "tkt_example_joes_texas_lost",
        startsAt: "2026-11-14T20:30:00.000Z",
        purchasedAt: "2026-11-14T19:02:00.000Z",
      },
      {
        ...ticketExamples.cancelled,
        token: "tkt_example_joes_texas_void",
        startsAt: "2026-11-07T20:30:00.000Z",
        purchasedAt: "2026-11-07T18:45:00.000Z",
      },
    ],
    refundedTotal: "6000000",
  },
  demoTicket: {
    tickets: [{ ...ticketPreGame, token: "tkt_example_demo", demo: true }],
    refundedTotal: "0",
  },
} satisfies Record<string, TicketsResponse>;

export const hedgeDeskExample: HedgeDeskResponse = {
  venue: "paper",
  venueLabel: "PAPER · live Gemini book",
  venueNote:
    "Fills are simulated against the live Gemini order book. Queue position is not simulated, so maker fills are optimistic.",
  params: {
    uMax: "300000000",
    makerTtlSeconds: 90,
    askMoveTicks: 2,
    toleranceTicks: 1,
    forceTakerMinutes: 60,
  },
  instruments: [
    {
      symbol: SYMBOL,
      label: CONDITION,
      eventTitle: EVENT_TITLE,
      startsAt: STARTS_AT,
      bidBps: 1100,
      askBps: 1300,
      bookAsOf: "2026-11-20T23:10:04.000Z",
      stale: false,
      // The live promo's exposure: 144 contracts, 96 held and 48 working at 12 %.
      exposure: "144000000",
      held: "96000000",
      working: "48000000",
      unhedgedNotional: "5760000",
      breaker: { active: false, reason: null },
      orders: [
        {
          id: "ord_3",
          kind: "maker",
          side: "buy",
          priceBps: 1200,
          qty: "48000000",
          filledQty: "0",
          status: "working",
          at: "2026-11-20T23:10:01.000Z",
        },
        {
          id: "ord_2",
          kind: "maker",
          side: "buy",
          priceBps: 1200,
          qty: "60000000",
          filledQty: "60000000",
          status: "filled",
          at: "2026-11-20T23:02:10.000Z",
        },
        {
          id: "ord_1",
          kind: "taker",
          side: "buy",
          priceBps: 1300,
          qty: "36000000",
          filledQty: "36000000",
          status: "filled",
          at: "2026-11-20T22:58:44.000Z",
        },
      ],
      fills: [
        {
          id: "fil_2",
          kind: "maker",
          priceBps: 1200,
          qty: "60000000",
          fee: "0",
          at: "2026-11-20T23:03:31.000Z",
        },
        {
          id: "fil_1",
          kind: "taker",
          priceBps: 1300,
          // The taker fee at 13 %: 0.80 % of a contract, on 36 contracts.
          qty: "36000000",
          fee: "288000",
          at: "2026-11-20T22:58:44.000Z",
        },
      ],
      // 60 contracts bought at 12 % instead of 13 % plus the taker fee: 1.80 % of 60 contracts.
      makerSavings: "1080000",
    },
  ],
  totals: { makerSavings: "1080000", guaranteeLosses: "0", crossingGains: "0" },
  // Not proven yet: the default desk shows what production shows until the real run is done.
  venueCheck: null,
  demo: false,
};

/**
 * Scenario `venueCheckProven` of the Hedge desk: a run of the sandbox order check that proved the
 * three steps. ILLUSTRATIVE values of the simulated mode (ids of the shape Gemini answers, a crypto
 * contract of the shape the sandbox lists): not a receipt of a real run, which only the database
 * of the deployed engine holds (docs/gemini-sandbox.md).
 */
export const hedgeDeskVenueCheckProven: HedgeDeskResponse = {
  ...hedgeDeskExample,
  venueCheck: {
    ranAt: "2026-11-20T16:05:12.000Z",
    venue: "gemini-sandbox",
    outcome: "proven",
    failedStep: null,
    failure: null,
    orders: [
      {
        venueOrderId: "73797746498585286",
        instrumentSymbol: "GEMI-BTC2611202200-HI91000",
        action: "placed_maker",
        at: "2026-11-20T16:05:06.000Z",
        side: "buy",
        kind: "maker",
        priceBps: 3600,
        qty: "1000000",
        filledQty: "0",
        status: "open",
      },
      {
        venueOrderId: "73797746498585286",
        instrumentSymbol: "GEMI-BTC2611202200-HI91000",
        action: "cancelled",
        at: "2026-11-20T16:05:08.000Z",
        side: "buy",
        kind: "maker",
        priceBps: 3600,
        qty: "1000000",
        filledQty: "0",
        status: "cancelled",
      },
      {
        venueOrderId: "73797746498585291",
        instrumentSymbol: "GEMI-BTC2611202200-HI91000",
        action: "filled",
        at: "2026-11-20T16:05:11.000Z",
        side: "buy",
        kind: "taker",
        priceBps: 5700,
        qty: "1000000",
        filledQty: "1000000",
        status: "filled",
      },
    ],
  },
};

/**
 * Scenario `demo` of the four screens that show the DEMO MODE band (apps/web/README.md, « Le
 * bandeau DEMO MODE »): the running example of each, on a campaign a demo action has touched, so
 * `demo` is `true`. Nothing else differs from the default.
 */
export const demoFlagExamples = {
  publicCampaign: { ...publicLive, demo: true } satisfies PublicCampaign,
  ticket: { ...ticketPreGame, demo: true } satisfies Ticket,
  campaignDetail: { ...detailLive, demo: true } satisfies CampaignDetail,
  hedgeDesk: { ...hedgeDeskExample, demo: true } satisfies HedgeDeskResponse,
};

export const demoExamples = {
  ok: { ok: true, demo: true, ticketToken: null, paymentIntentId: null },
  sale: {
    ok: true,
    demo: true,
    ticketToken: "tkt_example_joes_texas",
    paymentIntentId: "pi_demo_example_joes_texas",
  },
  saleStillProcessing: {
    ok: true,
    demo: true,
    ticketToken: null,
    paymentIntentId: "pi_demo_example_joes_texas",
  },
} satisfies Record<string, DemoResponse>;

/**
 * POST /api/campaigns/:id/top-up: the merchant adds $500 to the hedge budget of the running promo.
 * `repeated` is the answer to the same `requestId` sent again: the same payment, nothing new;
 * `credited` the answer to it once the top-up is in the budget (nothing more to pay).
 */
const topUpCreated: TopUpCampaignResponse = {
  campaignId: "cmp_joes_texas",
  requestId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b",
  amount: "500000000",
  budgetPayment: {
    paymentIntentId: "pi_top_up_example",
    clientSecret: "pi_top_up_example_secret_example",
    amount: "500000000",
  },
  status: "requires_payment",
};

export const topUpCampaignExamples = {
  created: topUpCreated,
  repeated: topUpCreated,
  credited: { ...topUpCreated, status: "credited" },
} satisfies Record<string, TopUpCampaignResponse>;
