import type { ZodType } from "zod";

import * as examples from "./examples";
import * as schemas from "./schemas";

export type RouteAuth =
  /** No authentication. */
  | "public"
  /** Privy access token in `Authorization: Bearer`. */
  | "user"
  /** A user who owns a merchant profile (and, for `:id` routes, the campaign). */
  | "merchant"
  /** `x-admin-key` header. */
  | "admin"
  /** Provider signature over the raw body (Stripe, QuickNode). */
  | "signature";

export interface RouteSpec {
  method: "GET" | "POST";
  /** Next.js route path, with `:param` placeholders. */
  path: string;
  auth: RouteAuth;
  /** Query string schema (GET). */
  query?: ZodType;
  /** JSON body schema (POST). Absent for webhooks: their bodies are defined by the provider. */
  request?: ZodType;
  response: ZodType;
  /**
   * Example answers by scenario. The mock API serves `default` unless the request carries an
   * `x-mock-scenario` header naming another key.
   */
  examples: { default: unknown } & Record<string, unknown>;
}

/**
 * Every route of SPEC section 10. Single source of truth for the handlers, the mock API,
 * and the front-end client.
 */
export const API_ROUTES = {
  me: {
    method: "GET",
    path: "/api/me",
    auth: "user",
    response: schemas.meResponseSchema,
    examples: { default: examples.meExamples.merchant, ...examples.meExamples },
  },
  createMerchant: {
    method: "POST",
    path: "/api/merchants",
    auth: "user",
    request: schemas.createMerchantRequestSchema,
    response: schemas.createMerchantResponseSchema,
    examples: { default: examples.merchantExample },
  },
  events: {
    method: "GET",
    path: "/api/events",
    auth: "merchant",
    query: schemas.eventsQuerySchema,
    response: schemas.eventsResponseSchema,
    examples: { default: examples.eventsExample },
  },
  campaignPreview: {
    method: "POST",
    path: "/api/campaigns/preview",
    auth: "merchant",
    request: schemas.campaignPreviewRequestSchema,
    response: schemas.campaignPreviewResponseSchema,
    examples: {
      default: examples.campaignPreviewExamples.open,
      ...examples.campaignPreviewExamples,
    },
  },
  createCampaign: {
    method: "POST",
    path: "/api/campaigns",
    auth: "merchant",
    request: schemas.createCampaignRequestSchema,
    response: schemas.createCampaignResponseSchema,
    examples: { default: examples.createCampaignExample, ...examples.createCampaignExamples },
  },
  campaigns: {
    method: "GET",
    path: "/api/campaigns",
    auth: "merchant",
    response: schemas.campaignsResponseSchema,
    examples: {
      default: examples.campaignsExample,
      withFunding: examples.campaignsWithFundingExample,
    },
  },
  campaignDetail: {
    method: "GET",
    path: "/api/campaigns/:id",
    auth: "merchant",
    response: schemas.campaignDetailSchema,
    examples: { default: examples.campaignDetailExamples.live, ...examples.campaignDetailExamples },
  },
  pauseCampaign: {
    method: "POST",
    path: "/api/campaigns/:id/pause",
    auth: "merchant",
    response: schemas.campaignActionResponseSchema,
    examples: { default: examples.campaignActionExamples.paused },
  },
  resumeCampaign: {
    method: "POST",
    path: "/api/campaigns/:id/resume",
    auth: "merchant",
    response: schemas.campaignActionResponseSchema,
    examples: { default: examples.campaignActionExamples.resumed },
  },
  closeCampaign: {
    method: "POST",
    path: "/api/campaigns/:id/close",
    auth: "merchant",
    response: schemas.campaignActionResponseSchema,
    examples: { default: examples.campaignActionExamples.closed },
  },
  publicCampaign: {
    method: "GET",
    path: "/api/c/:slug",
    auth: "public",
    response: schemas.publicCampaignSchema,
    examples: { default: examples.publicCampaignExamples.live, ...examples.publicCampaignExamples },
  },
  checkout: {
    method: "POST",
    path: "/api/checkout",
    auth: "public",
    request: schemas.checkoutRequestSchema,
    response: schemas.checkoutResponseSchema,
    examples: { default: examples.checkoutExample },
  },
  confirmCheckout: {
    method: "POST",
    path: "/api/checkout/:pi/confirm",
    auth: "public",
    response: schemas.checkoutStatusResponseSchema,
    examples: {
      default: examples.checkoutStatusExamples.processing,
      ...examples.checkoutStatusExamples,
    },
  },
  checkoutStatus: {
    method: "GET",
    path: "/api/checkout/:pi",
    auth: "public",
    response: schemas.checkoutStatusResponseSchema,
    examples: {
      default: examples.checkoutStatusExamples.ticketed,
      ...examples.checkoutStatusExamples,
    },
  },
  ticketByToken: {
    method: "GET",
    path: "/api/t/:token",
    auth: "public",
    response: schemas.ticketSchema,
    examples: { default: examples.ticketExamples.preGame, ...examples.ticketExamples },
  },
  tickets: {
    method: "GET",
    path: "/api/tickets",
    auth: "user",
    response: schemas.ticketsResponseSchema,
    examples: { default: examples.ticketsExample },
  },
  hedgeDesk: {
    method: "GET",
    path: "/api/hedge-desk",
    auth: "public",
    response: schemas.hedgeDeskResponseSchema,
    examples: { default: examples.hedgeDeskExample },
  },
  demoBook: {
    method: "POST",
    path: "/api/admin/demo/book",
    auth: "admin",
    request: schemas.demoBookRequestSchema,
    response: schemas.demoResponseSchema,
    examples: { default: examples.demoExamples.ok },
  },
  demoResult: {
    method: "POST",
    path: "/api/admin/demo/result",
    auth: "admin",
    request: schemas.demoResultRequestSchema,
    response: schemas.demoResponseSchema,
    examples: { default: examples.demoExamples.ok },
  },
  demoSale: {
    method: "POST",
    path: "/api/admin/demo/sale",
    auth: "admin",
    request: schemas.demoSaleRequestSchema,
    response: schemas.demoResponseSchema,
    examples: {
      default: examples.demoExamples.sale,
      processing: examples.demoExamples.saleStillProcessing,
    },
  },
  demoReset: {
    method: "POST",
    path: "/api/admin/demo/reset",
    auth: "admin",
    request: schemas.demoResetRequestSchema,
    response: schemas.demoResponseSchema,
    examples: { default: examples.demoExamples.ok },
  },
  stripeWebhook: {
    method: "POST",
    path: "/api/webhooks/stripe",
    auth: "signature",
    response: schemas.webhookAckSchema,
    examples: { default: { received: true } },
  },
  quicknodeWebhook: {
    method: "POST",
    path: "/api/webhooks/quicknode",
    auth: "signature",
    response: schemas.webhookAckSchema,
    examples: { default: { received: true } },
  },
  topUpCampaign: {
    method: "POST",
    path: "/api/campaigns/:id/top-up",
    auth: "merchant",
    request: schemas.topUpCampaignRequestSchema,
    response: schemas.topUpCampaignResponseSchema,
    examples: {
      default: examples.topUpCampaignExamples.created,
      ...examples.topUpCampaignExamples,
    },
  },
} as const satisfies Record<string, RouteSpec>;

export type ApiRouteName = keyof typeof API_ROUTES;

/** Header that selects an example scenario when the API runs in mock mode. */
export const MOCK_SCENARIO_HEADER = "x-mock-scenario";
/** Header carrying the admin key of the demo routes. */
export const ADMIN_KEY_HEADER = "x-admin-key";
