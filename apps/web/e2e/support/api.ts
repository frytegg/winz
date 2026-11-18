import {
  apiErrorSchema,
  campaignActionResponseSchema,
  campaignDetailSchema,
  campaignPreviewResponseSchema,
  campaignsResponseSchema,
  checkoutResponseSchema,
  checkoutStatusResponseSchema,
  createCampaignResponseSchema,
  createMerchantResponseSchema,
  demoResponseSchema,
  eventsResponseSchema,
  hedgeDeskResponseSchema,
  meResponseSchema,
  publicCampaignSchema,
  ticketSchema,
  webhookAckSchema,
  type ApiError,
  type CampaignActionResponse,
  type CampaignDetail,
  type CampaignPreviewRequest,
  type CampaignPreviewResponse,
  type CampaignsResponse,
  type CheckoutResponse,
  type CheckoutStatusResponse,
  type CreateCampaignRequest,
  type CreateCampaignResponse,
  type CreateMerchantRequest,
  type DemoResponse,
  type EventsResponse,
  type HedgeDeskResponse,
  type MeResponse,
  type Merchant,
  type Outcome,
  type PublicCampaign,
  type Ticket,
} from "@winz/shared";
import type { ZodType } from "zod";

import { POST as postDemoBook } from "@/app/api/admin/demo/book/route";
import { POST as postDemoReset } from "@/app/api/admin/demo/reset/route";
import { POST as postDemoResult } from "@/app/api/admin/demo/result/route";
import { POST as postDemoSale } from "@/app/api/admin/demo/sale/route";
import { GET as getPublicCampaign } from "@/app/api/c/[slug]/route";
import { POST as postClose } from "@/app/api/campaigns/[id]/close/route";
import { POST as postPause } from "@/app/api/campaigns/[id]/pause/route";
import { POST as postResume } from "@/app/api/campaigns/[id]/resume/route";
import { GET as getCampaign } from "@/app/api/campaigns/[id]/route";
import { POST as postPreview } from "@/app/api/campaigns/preview/route";
import { GET as getCampaigns, POST as postCampaigns } from "@/app/api/campaigns/route";
import { POST as postConfirm } from "@/app/api/checkout/[pi]/confirm/route";
import { GET as getCheckout } from "@/app/api/checkout/[pi]/route";
import { POST as postCheckout } from "@/app/api/checkout/route";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getHedgeDesk } from "@/app/api/hedge-desk/route";
import { GET as getMe } from "@/app/api/me/route";
import { POST as postMerchants } from "@/app/api/merchants/route";
import { GET as getTicket } from "@/app/api/t/[token]/route";
import { POST as postStripe } from "@/app/api/webhooks/stripe/route";
import type { RouteHandler } from "@/lib/server/route";
import { ADMIN_KEY } from "@/lib/server/testing/fixtures";

/**
 * The public surface of the web app, called the way Next.js calls it: the route handlers under
 * `app/api`, each given a `Request` and its path parameters. Every 2xx answer is validated with
 * the route's shared schema; any other answer throws `ApiCallError` with the validated error body.
 */

/** A non-2xx answer of a route. */
export class ApiCallError extends Error {
  constructor(
    public readonly route: string,
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(`${route} answered ${status.toString()} ${body.error.code}: ${body.error.message}`);
    this.name = "ApiCallError";
  }
}

/** Headers of a signed-in user (`Authorization: Bearer <token>` of the fake identity). */
export type AuthHeaders = Record<string, string>;

export function bearer(token: string): AuthHeaders {
  return { authorization: `Bearer ${token}` };
}

const ADMIN: AuthHeaders = { "x-admin-key": ADMIN_KEY };

interface Call {
  handler: RouteHandler;
  method: "GET" | "POST";
  path: string;
  params?: Record<string, string>;
  headers?: AuthHeaders;
  /** JSON body (serialised) or a raw string body. */
  body?: unknown;
}

async function send(call: Call): Promise<Response> {
  const headers: Record<string, string> = { ...(call.headers ?? {}) };
  let body: string | undefined;
  if (call.method === "POST") {
    headers["content-type"] = "application/json";
    body = typeof call.body === "string" ? call.body : JSON.stringify(call.body ?? {});
  }
  const request = new Request(`http://localhost${call.path}`, {
    method: call.method,
    headers,
    body,
  });
  return call.handler(request, { params: Promise.resolve(call.params ?? {}) });
}

async function parsed<T>(route: string, schema: ZodType<T>, response: Response): Promise<T> {
  const payload: unknown = await response.json();
  if (response.status < 200 || response.status > 299) {
    throw new ApiCallError(route, response.status, apiErrorSchema.parse(payload));
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `${route}: the answer does not match its shared schema: ${result.error.message}\n${JSON.stringify(payload)}`,
    );
  }
  return result.data;
}

async function call<T>(route: string, schema: ZodType<T>, request: Call): Promise<T> {
  return parsed(route, schema, await send(request));
}

/** Every route the scenarios drive, typed and validated. */
export const api = {
  me: (headers: AuthHeaders): Promise<MeResponse> =>
    call("GET /api/me", meResponseSchema, {
      handler: getMe,
      method: "GET",
      path: "/api/me",
      headers,
    }),

  createMerchant: (headers: AuthHeaders, body: CreateMerchantRequest): Promise<Merchant> =>
    call("POST /api/merchants", createMerchantResponseSchema, {
      handler: postMerchants,
      method: "POST",
      path: "/api/merchants",
      headers,
      body,
    }),

  events: (headers: AuthHeaders): Promise<EventsResponse> =>
    call("GET /api/events", eventsResponseSchema, {
      handler: getEvents,
      method: "GET",
      path: "/api/events",
      headers,
    }),

  preview: (headers: AuthHeaders, body: CampaignPreviewRequest): Promise<CampaignPreviewResponse> =>
    call("POST /api/campaigns/preview", campaignPreviewResponseSchema, {
      handler: postPreview,
      method: "POST",
      path: "/api/campaigns/preview",
      headers,
      body,
    }),

  createCampaign: (
    headers: AuthHeaders,
    body: CreateCampaignRequest,
  ): Promise<CreateCampaignResponse> =>
    call("POST /api/campaigns", createCampaignResponseSchema, {
      handler: postCampaigns,
      method: "POST",
      path: "/api/campaigns",
      headers,
      body,
    }),

  campaigns: (headers: AuthHeaders): Promise<CampaignsResponse> =>
    call("GET /api/campaigns", campaignsResponseSchema, {
      handler: getCampaigns,
      method: "GET",
      path: "/api/campaigns",
      headers,
    }),

  campaign: (headers: AuthHeaders, id: string): Promise<CampaignDetail> =>
    call("GET /api/campaigns/:id", campaignDetailSchema, {
      handler: getCampaign,
      method: "GET",
      path: `/api/campaigns/${id}`,
      params: { id },
      headers,
    }),

  pause: (headers: AuthHeaders, id: string): Promise<CampaignActionResponse> =>
    call("POST /api/campaigns/:id/pause", campaignActionResponseSchema, {
      handler: postPause,
      method: "POST",
      path: `/api/campaigns/${id}/pause`,
      params: { id },
      headers,
    }),

  resume: (headers: AuthHeaders, id: string): Promise<CampaignActionResponse> =>
    call("POST /api/campaigns/:id/resume", campaignActionResponseSchema, {
      handler: postResume,
      method: "POST",
      path: `/api/campaigns/${id}/resume`,
      params: { id },
      headers,
    }),

  close: (headers: AuthHeaders, id: string): Promise<CampaignActionResponse> =>
    call("POST /api/campaigns/:id/close", campaignActionResponseSchema, {
      handler: postClose,
      method: "POST",
      path: `/api/campaigns/${id}/close`,
      params: { id },
      headers,
    }),

  publicCampaign: (slug: string): Promise<PublicCampaign> =>
    call("GET /api/c/:slug", publicCampaignSchema, {
      handler: getPublicCampaign,
      method: "GET",
      path: `/api/c/${slug}`,
      params: { slug },
    }),

  checkout: (slug: string, qty: number): Promise<CheckoutResponse> =>
    call("POST /api/checkout", checkoutResponseSchema, {
      handler: postCheckout,
      method: "POST",
      path: "/api/checkout",
      body: { slug, qty },
    }),

  confirm: (pi: string): Promise<CheckoutStatusResponse> =>
    call("POST /api/checkout/:pi/confirm", checkoutStatusResponseSchema, {
      handler: postConfirm,
      method: "POST",
      path: `/api/checkout/${pi}/confirm`,
      params: { pi },
    }),

  checkoutStatus: (pi: string): Promise<CheckoutStatusResponse> =>
    call("GET /api/checkout/:pi", checkoutStatusResponseSchema, {
      handler: getCheckout,
      method: "GET",
      path: `/api/checkout/${pi}`,
      params: { pi },
    }),

  ticket: (token: string): Promise<Ticket> =>
    call("GET /api/t/:token", ticketSchema, {
      handler: getTicket,
      method: "GET",
      path: `/api/t/${token}`,
      params: { token },
    }),

  hedgeDesk: (): Promise<HedgeDeskResponse> =>
    call("GET /api/hedge-desk", hedgeDeskResponseSchema, {
      handler: getHedgeDesk,
      method: "GET",
      path: "/api/hedge-desk",
    }),

  demoBook: (body: {
    instrumentSymbol: string;
    bidBps: number;
    askBps: number;
    depth: string;
  }): Promise<DemoResponse> =>
    call("POST /api/admin/demo/book", demoResponseSchema, {
      handler: postDemoBook,
      method: "POST",
      path: "/api/admin/demo/book",
      headers: ADMIN,
      body,
    }),

  demoResult: (body: { instrumentSymbol: string; outcome: Outcome }): Promise<DemoResponse> =>
    call("POST /api/admin/demo/result", demoResponseSchema, {
      handler: postDemoResult,
      method: "POST",
      path: "/api/admin/demo/result",
      headers: ADMIN,
      body,
    }),

  demoSale: (body: { slug: string; qty: number; email: string }): Promise<DemoResponse> =>
    call("POST /api/admin/demo/sale", demoResponseSchema, {
      handler: postDemoSale,
      method: "POST",
      path: "/api/admin/demo/sale",
      headers: ADMIN,
      body,
    }),

  demoReset: (): Promise<DemoResponse> =>
    call("POST /api/admin/demo/reset", demoResponseSchema, {
      handler: postDemoReset,
      method: "POST",
      path: "/api/admin/demo/reset",
      headers: ADMIN,
      body: {},
    }),

  /** Delivers a webhook as Stripe does: the raw body and its `stripe-signature`. */
  stripeWebhook: (delivery: { body: string; signature: string }): Promise<{ received: true }> =>
    call("POST /api/webhooks/stripe", webhookAckSchema, {
      handler: postStripe,
      method: "POST",
      path: "/api/webhooks/stripe",
      headers: { "stripe-signature": delivery.signature },
      body: delivery.body,
    }),
};

/** Runs `action` and returns the `ApiCallError` it must throw. */
export async function apiRefusal(action: () => Promise<unknown>): Promise<ApiCallError> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof ApiCallError) return error;
    throw error;
  }
  throw new Error("the route answered 2xx where a refusal was expected");
}
