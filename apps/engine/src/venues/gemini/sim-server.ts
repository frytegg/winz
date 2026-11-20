import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A simulated Gemini Prediction Markets API on 127.0.0.1, for tests only (SPEC section 13: no test
 * calls Gemini over the network). It checks every private request the way Gemini documents it
 * (developer.gemini.com/authentication/api-key): the key header, an empty body, the base64 JSON
 * payload whose `request` is the path, a nonce strictly above the previous one of the key, and the
 * hex HMAC-SHA384 signature of the payload with the secret. It answers with the shapes of
 * prediction-markets.yaml, order ids above 2^53 written as raw JSON numbers, and keeps a small
 * book per symbol that orders cross against. Failures are scripted per path.
 *
 * It is also the fallback of SPEC open question 1: without a sandbox account, the adapter is
 * proven against this server.
 */

export interface SimLevel {
  price: string;
  amount: string;
}

export interface SimContract {
  instrumentSymbol: string;
  eventTitle: string;
  expiryDate: string;
  bids: SimLevel[];
  asks: SimLevel[];
  marketState?: string;
}

export interface SimOrder {
  orderId: bigint;
  symbol: string;
  side: "buy" | "sell";
  outcome: "yes" | "no";
  quantity: number;
  filled: number;
  /** Sum of price × quantity of the fills, to give the average. */
  notional: number;
  price: number;
  timeInForce: string;
  makerOrCancel: boolean;
  status: "open" | "filled" | "cancelled";
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  /** Hidden from both lists (an order Gemini does not show yet). */
  hidden: boolean;
}

export interface SimRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  /** The decoded payload of a private request; null for a public one. */
  payload: Record<string, unknown> | null;
  /** The raw header values, to check that they never reach a log. */
  rawPayloadHeader: string | null;
  rawSignatureHeader: string | null;
  /** Why the server refused the request's authentication, or null. */
  authError: string | null;
  status: number;
}

/** A scripted answer for the next request of a path. */
export interface SimScript {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Process the request normally, then destroy the socket instead of answering. */
  dropAfterProcessing?: boolean;
  /** Destroy the socket without processing the request. */
  dropBeforeProcessing?: boolean;
}

export interface SimServerOptions {
  apiKey: string;
  apiSecret: string;
  contracts: SimContract[];
  termsAccepted?: boolean;
  /** "incremental": each nonce above the previous one. "time": seconds within 30 s. */
  nonceMode?: "incremental" | "time";
  now?: () => number;
}

const FIRST_ORDER_ID = 73_797_746_498_585_286n;

function money(value: number): string {
  return (Math.round(value * 1e10) / 1e10).toString();
}

function quantity(value: number): string {
  return (Math.round(value * 1e6) / 1e6).toString();
}

export class SimGemini {
  readonly requests: SimRequest[] = [];
  readonly orders: SimOrder[] = [];
  readonly contracts: Map<string, SimContract>;
  termsAccepted: boolean;
  /** Called after an order is created, before the answer is sent. */
  afterPlace: ((order: SimOrder) => void) | null = null;
  /** Called before each private request is processed. */
  beforePrivate: ((path: string) => void) | null = null;
  private readonly scripts = new Map<string, SimScript[]>();
  private readonly server: Server;
  private nextOrderId = FIRST_ORDER_ID;
  private lastNonce = -1;
  private readonly now: () => number;
  baseUrl = "";

  constructor(private readonly options: SimServerOptions) {
    this.contracts = new Map(
      options.contracts.map((c) => [c.instrumentSymbol, structuredClone(c)]),
    );
    this.termsAccepted = options.termsAccepted ?? true;
    this.now = options.now ?? Date.now;
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port.toString()}`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** The next request of `path` gets this answer instead (in order, one script per request). */
  script(path: string, ...answers: SimScript[]): void {
    const queue = this.scripts.get(path) ?? [];
    queue.push(...answers);
    this.scripts.set(path, queue);
  }

  /** A bot trades against a resting order: it fills `qty` contracts at the order's price. */
  fill(orderId: bigint, qty?: number): void {
    const order = this.orders.find((o) => o.orderId === orderId);
    if (order === undefined || order.status !== "open") throw new Error("no open order to fill");
    const amount = Math.min(qty ?? order.quantity - order.filled, order.quantity - order.filled);
    order.filled += amount;
    order.notional += amount * order.price;
    order.updatedAt = new Date(this.now()).toISOString();
    if (order.filled >= order.quantity - 1e-9) order.status = "filled";
  }

  privateRequests(path?: string): SimRequest[] {
    return this.requests.filter(
      (request) => request.payload !== null && (path === undefined || request.path === path),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(request.url ?? "/", "http://sim");
    const path = url.pathname;
    const script = this.scripts.get(path)?.shift();
    const record: SimRequest = {
      method: request.method ?? "",
      path,
      headers: request.headers,
      payload: null,
      rawPayloadHeader: null,
      rawSignatureHeader: null,
      authError: null,
      status: 0,
    };
    this.requests.push(record);
    if (script?.dropBeforeProcessing === true) {
      request.socket.destroy();
      return;
    }
    const send = (status: number, text: string, headers: Record<string, string> = {}): void => {
      record.status = status;
      if (script?.dropAfterProcessing === true) {
        request.socket.destroy();
        return;
      }
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(text);
    };

    if (path.startsWith("/v1/book/") || path === "/v1/prediction-markets/events") {
      if (script?.status !== undefined) {
        send(script.status, script.body ?? "{}", script.headers);
        return;
      }
      this.handlePublic(path, url, send);
      return;
    }

    // Private: authentication as documented.
    const apiKey = request.headers["x-gemini-apikey"];
    const encoded = request.headers["x-gemini-payload"];
    const signature = request.headers["x-gemini-signature"];
    record.rawPayloadHeader = typeof encoded === "string" ? encoded : null;
    record.rawSignatureHeader = typeof signature === "string" ? signature : null;
    const authFail = (reason: string, status = 400): void => {
      record.authError = reason;
      send(status, JSON.stringify({ result: "error", reason, message: reason }));
    };
    if (
      typeof apiKey !== "string" ||
      typeof encoded !== "string" ||
      typeof signature !== "string"
    ) {
      authFail("MissingSecurityHeaders", 401);
      return;
    }
    // An empty body: a POST says Content-Length 0; a GET (terms status) carries no body at all.
    const length = request.headers["content-length"];
    if (body.length !== 0 || (length !== undefined && length !== "0")) {
      authFail("BodyNotEmpty");
      return;
    }
    if (request.headers["content-type"] !== "text/plain") {
      authFail("WrongContentType");
      return;
    }
    if (apiKey !== this.options.apiKey) {
      authFail("InvalidApiKey");
      return;
    }
    const expected = createHmac("sha384", this.options.apiSecret).update(encoded).digest();
    const given = Buffer.from(signature, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      authFail("InvalidSignature");
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(
        Buffer.from(encoded, "base64").toString("utf8"),
        (key: string, value: unknown, context?: { source?: string }) =>
          key === "orderId" && typeof value === "number" && context?.source !== undefined
            ? BigInt(context.source)
            : value,
      ) as Record<string, unknown>;
    } catch {
      authFail("InvalidJson");
      return;
    }
    record.payload = payload;
    if (payload.request !== path) {
      authFail("EndpointMismatch");
      return;
    }
    const nonce = payload.nonce;
    if (typeof nonce !== "number") {
      authFail("MissingNonce");
      return;
    }
    if ((this.options.nonceMode ?? "incremental") === "incremental") {
      if (nonce <= this.lastNonce) {
        authFail("InvalidNonce");
        return;
      }
    } else if (Math.abs(nonce - this.now() / 1000) > 30 || nonce <= this.lastNonce) {
      authFail("InvalidNonce");
      return;
    }
    this.lastNonce = nonce;
    this.beforePrivate?.(path);
    if (script?.status !== undefined) {
      send(script.status, script.body ?? "{}", script.headers);
      return;
    }
    this.handlePrivate(path, payload, send);
  }

  private handlePublic(path: string, url: URL, send: (status: number, text: string) => void): void {
    if (path === "/v1/prediction-markets/events") {
      const category = url.searchParams.get("category");
      const data = [...this.contracts.values()].map((contract) => {
        const bestBid = contract.bids[0]?.price ?? null;
        const bestAsk = contract.asks[0]?.price ?? null;
        return {
          ticker: contract.instrumentSymbol.replace(/^GEMI-/, "").split("-")[0] ?? "X",
          title: contract.eventTitle,
          category: "Crypto",
          status: "active",
          contracts: [
            {
              instrumentSymbol: contract.instrumentSymbol,
              label: contract.eventTitle,
              status: "active",
              marketState: contract.marketState ?? "open",
              expiryDate: contract.expiryDate,
              priceIncrement: "0.01",
              quantityIncrement: "0.01",
              quantityMinimum: "0.01",
              isCombo: false,
              prices: { bestBid, bestAsk },
            },
          ],
        };
      });
      const filtered = category === "Crypto" ? data : [];
      send(
        200,
        JSON.stringify({
          data: filtered,
          pagination: { limit: 100, offset: 0, total: filtered.length },
        }),
      );
      return;
    }
    const symbol = decodeURIComponent(path.slice("/v1/book/".length));
    const contract = this.contracts.get(symbol);
    if (contract === undefined) {
      send(400, JSON.stringify({ result: "error", reason: "InvalidSymbol", message: "unknown" }));
      return;
    }
    send(200, JSON.stringify({ bids: contract.bids, asks: contract.asks }));
  }

  private handlePrivate(
    path: string,
    payload: Record<string, unknown>,
    send: (status: number, text: string) => void,
  ): void {
    switch (path) {
      case "/v1/prediction-markets/terms/status":
        send(
          200,
          JSON.stringify({
            hasAcceptedLatest: this.termsAccepted,
            acceptedVersion: 2,
            latestVersion: 3,
          }),
        );
        return;
      case "/v1/prediction-markets/terms/accept":
        this.termsAccepted = true;
        send(200, JSON.stringify({ success: true }));
        return;
      case "/v1/prediction-markets/order":
        this.place(payload, send);
        return;
      case "/v1/prediction-markets/order/cancel": {
        const id = payload.orderId;
        const order = this.orders.find((o) => o.orderId === id);
        if (order === undefined) {
          send(404, JSON.stringify({ error: "OrderNotFound", message: "Order not found" }));
          return;
        }
        if (order.status !== "open") {
          send(
            422,
            JSON.stringify({ error: "InvalidOrderState", message: `Order is ${order.status}` }),
          );
          return;
        }
        order.status = "cancelled";
        order.cancelledAt = new Date(this.now()).toISOString();
        order.updatedAt = order.cancelledAt;
        send(
          200,
          JSON.stringify({ result: "ok", message: `Order ${String(id)} cancelled successfully` }),
        );
        return;
      }
      case "/v1/prediction-markets/orders/active": {
        const orders = this.orders.filter(
          (o) =>
            o.status === "open" &&
            !o.hidden &&
            (payload.symbol === undefined || o.symbol === payload.symbol),
        );
        send(200, this.ordersJson(orders));
        return;
      }
      case "/v1/prediction-markets/orders/history": {
        const orders = this.orders.filter(
          (o) =>
            o.status !== "open" &&
            !o.hidden &&
            (payload.symbol === undefined || o.symbol === payload.symbol) &&
            (payload.status === undefined || o.status === payload.status),
        );
        send(200, this.ordersJson(orders));
        return;
      }
      default:
        send(404, JSON.stringify({ result: "error", reason: "EndpointNotFound", message: path }));
    }
  }

  private place(
    payload: Record<string, unknown>,
    send: (status: number, text: string) => void,
  ): void {
    const symbol = String(payload.symbol);
    const contract = this.contracts.get(symbol);
    if (contract === undefined) {
      send(400, JSON.stringify({ error: "InvalidSymbol", message: "Unknown symbol" }));
      return;
    }
    if (payload.orderType !== "limit" || payload.outcome !== "yes" || payload.side !== "buy") {
      send(
        400,
        JSON.stringify({
          error: "InvalidInput",
          message: "the simulator buys YES with limit orders",
        }),
      );
      return;
    }
    const price = Number(payload.price);
    const qty = Number(payload.quantity);
    if (!(price > 0 && price < 1)) {
      send(400, JSON.stringify({ error: "InvalidPrice", message: "price must be in (0, 1)" }));
      return;
    }
    const at = new Date(this.now()).toISOString();
    const order: SimOrder = {
      orderId: this.nextOrderId,
      symbol,
      side: "buy",
      outcome: "yes",
      quantity: qty,
      filled: 0,
      notional: 0,
      price,
      timeInForce: String(payload.timeInForce),
      makerOrCancel: payload.makerOrCancel === true,
      status: "open",
      createdAt: at,
      updatedAt: at,
      cancelledAt: null,
      hidden: false,
    };
    this.nextOrderId += 1n;
    this.orders.push(order);
    const bestAsk =
      contract.asks[0] === undefined ? Number.POSITIVE_INFINITY : Number(contract.asks[0].price);
    if (order.makerOrCancel && price >= bestAsk) {
      order.status = "cancelled";
      order.cancelledAt = at;
    } else {
      // Cross the asks at or under the limit, best first.
      for (const level of contract.asks) {
        const levelPrice = Number(level.price);
        if (levelPrice > price || order.filled >= qty) break;
        const take = Math.min(Number(level.amount), qty - order.filled);
        if (take <= 0) continue;
        order.filled += take;
        order.notional += take * levelPrice;
        level.amount = quantity(Number(level.amount) - take);
      }
      contract.asks = contract.asks.filter((level) => Number(level.amount) > 0);
      if (order.filled >= qty - 1e-9) order.status = "filled";
      else if (order.timeInForce === "immediate-or-cancel") {
        order.status = "cancelled";
        order.cancelledAt = at;
      }
    }
    this.afterPlace?.(order);
    send(201, this.orderJson(order));
  }

  private orderJson(order: SimOrder): string {
    const avg = order.filled > 0 ? money(order.notional / order.filled) : null;
    const body = {
      orderId: "__ID__",
      hashOrderId: null,
      clientOrderId: null,
      status: order.status,
      symbol: order.symbol,
      side: order.side,
      outcome: order.outcome,
      orderType: "limit",
      quantity: quantity(order.quantity),
      filledQuantity: quantity(order.filled),
      remainingQuantity: quantity(order.quantity - order.filled),
      price: order.price.toFixed(2),
      avgExecutionPrice: avg,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      cancelledAt: order.cancelledAt,
    };
    // The id as a raw JSON number: above 2^53, a float would lose its last digits.
    return JSON.stringify(body).replace('"__ID__"', order.orderId.toString());
  }

  private ordersJson(orders: readonly SimOrder[]): string {
    return `{"orders":[${orders.map((order) => this.orderJson(order)).join(",")}],"pagination":{"limit":100,"offset":0,"count":${orders.length.toString()}}}`;
  }
}

export async function startSimGemini(options: SimServerOptions): Promise<SimGemini> {
  return new SimGemini(options).start();
}
