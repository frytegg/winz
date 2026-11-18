import type {
  CampaignActionResponse,
  CampaignDetail,
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
 * The running example is the one of SPEC section 4.3: Joe's Pizza sells a $20 pizza, 100 % back
 * if Texas wins by 14 or more, with the condition quoted at 12 %.
 */

const SYMBOL = "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX13";
const STARTS_AT = "2026-11-21T20:30:00.000Z";
const SALES_CLOSE_AT = "2026-11-21T20:25:00.000Z";
const EVENT_TITLE = "Arkansas vs Texas";
const CONDITION = "Texas wins by 14+";
const PROMISE = "100% back if Texas wins by 14+";

export const merchantExample: Merchant = {
  id: "mer_joes",
  name: "Joe's Pizza",
  category: "pizza",
  logoUrl: null,
  defaultUsualMarginBps: 6500,
};

export const meExamples = {
  merchant: {
    user: {
      id: "usr_joe",
      email: "joe@example.com",
      roles: ["merchant"],
      walletAddress: "0x1111111111111111111111111111111111111111",
    },
    merchant: merchantExample,
    balance: { available: "0", pending: "240000000" },
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
      home: { name: "Texas Longhorns", abbreviation: "TEX", logoUrl: null },
      away: { name: "Arkansas Razorbacks", abbreviation: "ARK", logoUrl: null },
      templates: [
        {
          id: "tpl_tex13_full",
          instrumentSymbol: SYMBOL,
          type: "spread",
          conditionLabel: CONDITION,
          headline: "Free if Texas wins by 14+",
          refundBps: 10_000,
          probabilityBps: 1200,
          costBps: 1274,
          available: true,
          unavailableReason: null,
        },
        {
          id: "tpl_tex_ml_half",
          instrumentSymbol: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
          type: "moneyline",
          conditionLabel: "Texas wins",
          headline: "Half back if Texas wins",
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
      home: { name: "Pittsburgh Panthers", abbreviation: "PITT", logoUrl: null },
      away: { name: "Villanova Wildcats", abbreviation: "VILL", logoUrl: null },
      templates: [
        {
          id: "tpl_pitt_ml_half",
          instrumentSymbol: "GEMI-NCAAM-2611180000-VILL-PITT-M-PITT",
          type: "moneyline",
          conditionLabel: "Pittsburgh wins",
          headline: "Half back if Pitt wins",
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

export const campaignPreviewExamples = {
  open: {
    maxCostBps: 2000,
    pauseThresholdBps: 1800,
    currentProbabilityBps: 1200,
    costPerSale: "2548000",
    marginKeptPerSale: "10452000",
    marginKeptBps: 5226,
    capacity: { sales: 312, limitedBy: "depth" },
    saleState: "open",
    bookAsOf: "2026-11-17T15:00:00.000Z",
  },
  aboveThreshold: {
    maxCostBps: 2000,
    pauseThresholdBps: 1800,
    currentProbabilityBps: 2300,
    costPerSale: "4848000",
    marginKeptPerSale: "8152000",
    marginKeptBps: 4076,
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

const summaryLive: CampaignSummary = {
  id: "cmp_joes_texas",
  slug: "joes-texas",
  product: "Large pizza",
  promise: PROMISE,
  status: "live",
  saleState: "open",
  eventTitle: EVENT_TITLE,
  startsAt: STARTS_AT,
  salesCloseAt: SALES_CLOSE_AT,
  sales: 12,
  revenue: "240000000",
};

const detailLive: CampaignDetail = {
  ...summaryLive,
  conditionLabel: CONDITION,
  instrumentSymbol: SYMBOL,
  unitPrice: "20000000",
  refundBps: 10_000,
  usualMarginBps: 6500,
  minMarginBps: 4500,
  pauseThresholdBps: 1800,
  probabilityBps: 1200,
  budget: "1000000000",
  hedgeSpent: "20160000",
  hedgeReserved: "10992000",
  budgetAvailable: "968848000",
  exposure: "240000000",
  hedgedBps: 6667,
  capacitySales: 300,
  received: "0",
  pending: "240000000",
  outcome: null,
  url: "https://winz.app/c/joes-texas",
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
    hedgeSpent: "29880000",
    hedgeReserved: "0",
    budgetAvailable: "970120000",
    hedgedBps: 10_000,
    capacitySales: 0,
    received: "240000000",
    pending: "0",
    outcome: "yes",
    report: {
      sales: 12,
      newCustomers: 9,
      hedgeCost: "29880000",
      hedgeCostBps: 1245,
      equivalentDiscountBps: 1245,
      refundsPaid: "240000000",
      paidToMerchant: "240000000",
    },
  },
  settledNo: {
    ...detailLive,
    status: "settled_no",
    saleState: "closed",
    probabilityBps: null,
    hedgeSpent: "29880000",
    hedgeReserved: "0",
    budgetAvailable: "970120000",
    hedgedBps: 10_000,
    capacitySales: 0,
    received: "240000000",
    pending: "0",
    outcome: "no",
    report: {
      sales: 12,
      newCustomers: 9,
      hedgeCost: "29880000",
      hedgeCostBps: 1245,
      equivalentDiscountBps: 1245,
      refundsPaid: "0",
      paidToMerchant: "240000000",
    },
  },
} satisfies Record<string, CampaignDetail>;

export const campaignsExample: CampaignsResponse = {
  campaigns: [
    summaryLive,
    {
      ...summaryLive,
      id: "cmp_joes_pitt",
      slug: "joes-pitt",
      promise: "50% back if Pitt wins",
      status: "settled_no",
      saleState: "closed",
      eventTitle: "Villanova vs Pittsburgh",
      startsAt: "2026-11-18T00:00:00.000Z",
      salesCloseAt: "2026-11-17T23:55:00.000Z",
      sales: 31,
      revenue: "620000000",
    },
  ],
};

export const campaignActionExamples = {
  paused: { status: "paused", saleState: "paused_manual" },
  resumed: { status: "live", saleState: "open" },
  closed: { status: "sales_closed", saleState: "closed" },
} satisfies Record<string, CampaignActionResponse>;

const publicLive: PublicCampaign = {
  slug: "joes-texas",
  merchant: { name: "Joe's Pizza", logoUrl: null, category: "pizza" },
  product: "Large pizza",
  unitPrice: "20000000",
  refundBps: 10_000,
  promise: PROMISE,
  conditionLabel: CONDITION,
  eventTitle: EVENT_TITLE,
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
  settledYes: { ...publicLive, saleState: "closed", probabilityBps: null, outcome: "yes" },
  settledNo: { ...publicLive, saleState: "closed", probabilityBps: null, outcome: "no" },
} satisfies Record<string, PublicCampaign>;

export const checkoutExample: CheckoutResponse = {
  paymentIntentId: "pi_example",
  clientSecret: "pi_example_secret_example",
  amount: "20000000",
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
  campaignSlug: "joes-texas",
  merchant: { name: "Joe's Pizza", logoUrl: null },
  product: "Large pizza",
  qty: 1,
  paid: "20000000",
  refundable: "20000000",
  promise: PROMISE,
  conditionLabel: CONDITION,
  eventTitle: EVENT_TITLE,
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
    refundedAt: "2026-11-22T00:05:08.000Z",
  },
  notThisTime: { ...ticketPreGame, phase: "not_this_time", probabilityBps: null },
  cancelled: { ...ticketPreGame, phase: "cancelled", probabilityBps: null },
} satisfies Record<string, Ticket>;

export const ticketsExample: TicketsResponse = {
  tickets: [
    ticketPreGame,
    {
      ...ticketPreGame,
      token: "tkt_example_joes_pitt",
      campaignSlug: "joes-pitt",
      promise: "50% back if Pitt wins",
      conditionLabel: "Pittsburgh wins",
      eventTitle: "Villanova vs Pittsburgh",
      refundable: "10000000",
      phase: "refunded",
      probabilityBps: null,
      startsAt: "2026-11-18T00:00:00.000Z",
      purchasedAt: "2026-11-17T22:41:00.000Z",
      refundedAt: "2026-11-18T02:31:12.000Z",
      instrumentSymbol: "GEMI-NCAAM-2611180000-VILL-PITT-M-PITT",
    },
  ],
  refundedTotal: "10000000",
};

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
      exposure: "240000000",
      held: "160000000",
      working: "80000000",
      unhedgedNotional: "9600000",
      breaker: { active: false, reason: null },
      orders: [
        {
          id: "ord_3",
          kind: "maker",
          side: "buy",
          priceBps: 1200,
          qty: "80000000",
          filledQty: "0",
          status: "working",
          at: "2026-11-20T23:10:01.000Z",
        },
        {
          id: "ord_2",
          kind: "maker",
          side: "buy",
          priceBps: 1200,
          qty: "100000000",
          filledQty: "100000000",
          status: "filled",
          at: "2026-11-20T23:02:10.000Z",
        },
        {
          id: "ord_1",
          kind: "taker",
          side: "buy",
          priceBps: 1300,
          qty: "60000000",
          filledQty: "60000000",
          status: "filled",
          at: "2026-11-20T22:58:44.000Z",
        },
      ],
      fills: [
        {
          id: "fil_2",
          kind: "maker",
          priceBps: 1200,
          qty: "100000000",
          fee: "0",
          at: "2026-11-20T23:03:31.000Z",
        },
        {
          id: "fil_1",
          kind: "taker",
          priceBps: 1300,
          qty: "60000000",
          fee: "480000",
          at: "2026-11-20T22:58:44.000Z",
        },
      ],
      makerSavings: "1800000",
    },
  ],
  totals: { makerSavings: "1800000", guaranteeLosses: "0", crossingGains: "0" },
  venueCheck: {
    ranAt: "2026-11-18T16:00:00.000Z",
    orders: [
      {
        venueOrderId: "73797746498585286",
        instrumentSymbol: "GEMI-BTC2611190000-HI100000",
        action: "placed_maker",
        at: "2026-11-18T16:00:01.000Z",
      },
      {
        venueOrderId: "73797746498585286",
        instrumentSymbol: "GEMI-BTC2611190000-HI100000",
        action: "cancelled",
        at: "2026-11-18T16:00:03.000Z",
      },
    ],
  },
  demo: false,
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
 * POST /api/campaigns/:id/top-up: Joe adds $500 to the hedge budget of his running promo.
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
