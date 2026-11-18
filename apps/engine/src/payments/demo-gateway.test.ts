import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { seedCampaign, seedInstruments } from "../market-data/book-test-support";
import { createTestDatabase, type TestDatabase } from "../testing/postgres";
import { DemoPaymentGateway, isDemoPaymentIntentId } from "./demo-gateway";
import { FakePaymentGateway } from "./fake-gateway";
import { PaymentGatewayError, type PaymentIntentView } from "./gateway";
import { RoutingPaymentGateway, StripeNotConfiguredError } from "./routing-gateway";

const SYMBOL = "GEMI-NBA-2611180030-NYK-TOR-M-NYK";

let database: TestDatabase;
let db: Db;
let campaignId: string;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  await seedInstruments(db, [SYMBOL]);
  campaignId = await seedCampaign(db, SYMBOL, "live");
});

afterAll(async () => {
  await database?.drop();
});

/** A payments row as the admin sale route writes it. Returns its PaymentIntent id. */
async function demoPayment(status = "processing", qty = 2): Promise<string> {
  counter += 1;
  const id = `pi_demo_${counter.toString().padStart(8, "0")}`;
  await db`
    insert into payments (stripe_pi, campaign_id, email, qty, amount, status)
    values (${id}, ${campaignId}, 'maya@example.com', ${qty}, ${BigInt(qty) * 5_000_000n}, ${status})
  `;
  return id;
}

function realIntent(id: string): PaymentIntentView {
  return {
    id,
    status: "requires_capture",
    amount: 5_000_000n,
    currency: "usd",
    metadata: { kind: "purchase", campaignId: "c1", qty: "1" },
    payerEmail: null,
  };
}

describe("DemoPaymentGateway", () => {
  it("answers retrieve from the payments row: authorized and awaiting capture", async () => {
    const id = await demoPayment("processing", 3);
    const gateway = new DemoPaymentGateway(db);
    expect(await gateway.retrievePaymentIntent(id)).toEqual({
      id,
      status: "requires_capture",
      amount: 15_000_000n,
      currency: "usd",
      metadata: { kind: "purchase", campaignId, qty: "3" },
      payerEmail: "maya@example.com",
    });
  });

  it("maps the other row statuses", async () => {
    const gateway = new DemoPaymentGateway(db);
    const statuses = await Promise.all(
      ["ticketed", "cancelled_paused", "failed", "requires_payment"].map(async (status) => {
        const intent = await gateway.retrievePaymentIntent(await demoPayment(status));
        return intent?.status;
      }),
    );
    expect(statuses).toEqual(["succeeded", "canceled", "canceled", "requires_payment_method"]);
  });

  it("returns null for a demo id without a row", async () => {
    expect(await new DemoPaymentGateway(db).retrievePaymentIntent("pi_demo_missing")).toBeNull();
  });

  it("captures once, then capture again is a success that changes nothing", async () => {
    const id = await demoPayment();
    const gateway = new DemoPaymentGateway(db);
    await gateway.capturePaymentIntent(id, `capture:${id}`);
    expect((await gateway.retrievePaymentIntent(id))?.status).toBe("succeeded");
    // A retried job sends the same key; another caller another key: both succeed.
    await gateway.capturePaymentIntent(id, `capture:${id}`);
    await gateway.capturePaymentIntent(id, "another-key");
    expect((await gateway.retrievePaymentIntent(id))?.status).toBe("succeeded");
    // The row itself is the purchase job's to update, never the gateway's.
    const [row] = await db<
      { status: string }[]
    >`select status from payments where stripe_pi = ${id}`;
    expect(row?.status).toBe("processing");
  });

  it("cancels, and refuses what Stripe would refuse", async () => {
    const gateway = new DemoPaymentGateway(db);
    const cancelled = await demoPayment();
    await gateway.cancelPaymentIntent(cancelled, `cancel:${cancelled}`);
    await gateway.cancelPaymentIntent(cancelled, "again");
    expect((await gateway.retrievePaymentIntent(cancelled))?.status).toBe("canceled");
    const captureAfterCancel = gateway.capturePaymentIntent(cancelled, `capture:${cancelled}`);
    await expect(captureAfterCancel).rejects.toMatchObject({
      retryable: false,
      code: "payment_intent_unexpected_state",
    });
    // The refused answer is replayed for its key.
    await expect(
      gateway.capturePaymentIntent(cancelled, `capture:${cancelled}`),
    ).rejects.toBeInstanceOf(PaymentGatewayError);

    const captured = await demoPayment();
    await gateway.capturePaymentIntent(captured, `capture:${captured}`);
    await expect(gateway.cancelPaymentIntent(captured, `cancel:${captured}`)).rejects.toMatchObject(
      { retryable: false },
    );
  });

  it("records a refund of a captured intent, once", async () => {
    const gateway = new DemoPaymentGateway(db);
    const id = await demoPayment("ticketed");
    await gateway.refundPaymentIntent(id, `refund:${id}`);
    await gateway.refundPaymentIntent(id, `refund:${id}`);
    await gateway.refundPaymentIntent(id, "refund-again");
    expect(gateway.wasRefunded(id)).toBe(true);
    const authorized = await demoPayment();
    await expect(gateway.refundPaymentIntent(authorized, "r")).rejects.toMatchObject({
      code: "charge_not_refundable",
    });
  });

  it("refuses a mutating call on an unknown demo id, and any non-demo id", async () => {
    const gateway = new DemoPaymentGateway(db);
    await expect(gateway.capturePaymentIntent("pi_demo_nope", "k1")).rejects.toMatchObject({
      retryable: false,
      code: "resource_missing",
    });
    await expect(gateway.retrievePaymentIntent("pi_123")).rejects.toMatchObject({
      retryable: false,
      code: "not_a_demo_payment",
    });
  });
});

describe("RoutingPaymentGateway", () => {
  it("routes by prefix: demo ids to the demo gateway, the rest to the real one", async () => {
    const real = new FakePaymentGateway();
    real.setIntent(realIntent("pi_real_1"));
    const demoId = await demoPayment();
    const gateway = new RoutingPaymentGateway(real, new DemoPaymentGateway(db));

    expect((await gateway.retrievePaymentIntent("pi_real_1"))?.id).toBe("pi_real_1");
    await gateway.capturePaymentIntent("pi_real_1", "capture:pi_real_1");
    expect(real.effectsOf("pi_real_1").captures).toBe(1);

    expect((await gateway.retrievePaymentIntent(demoId))?.status).toBe("requires_capture");
    await gateway.capturePaymentIntent(demoId, `capture:${demoId}`);
    await gateway.cancelPaymentIntent(await demoPayment(), "cancel-demo");
    expect((await gateway.retrievePaymentIntent(demoId))?.status).toBe("succeeded");
    // The real gateway never heard of a demo id.
    expect(real.calls.every((call) => !isDemoPaymentIntentId(call.id))).toBe(true);
    expect(real.calls.map((call) => call.method)).toEqual(["retrieve", "capture"]);
  });

  it("refuses a real id when Stripe is not configured, and still serves demo ids", async () => {
    const gateway = new RoutingPaymentGateway(null, new DemoPaymentGateway(db));
    const refused = gateway.retrievePaymentIntent("pi_3Q0realintent");
    await expect(refused).rejects.toBeInstanceOf(StripeNotConfiguredError);
    await expect(refused).rejects.toMatchObject({
      retryable: false,
      code: "stripe_not_configured",
      message: expect.stringContaining("Stripe is not configured") as unknown,
    });
    for (const call of [
      gateway.capturePaymentIntent("pi_x", "k"),
      gateway.cancelPaymentIntent("pi_x", "k"),
      gateway.refundPaymentIntent("pi_x", "k"),
    ]) {
      await expect(call).rejects.toBeInstanceOf(StripeNotConfiguredError);
    }

    const demoId = await demoPayment();
    await gateway.capturePaymentIntent(demoId, `capture:${demoId}`);
    expect((await gateway.retrievePaymentIntent(demoId))?.status).toBe("succeeded");
  });
});
