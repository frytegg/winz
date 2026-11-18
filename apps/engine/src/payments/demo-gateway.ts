import { STRIPE_PAYMENT_KINDS } from "@winz/shared";

import type { Db } from "../db";
import {
  PaymentGatewayError,
  type PaymentGateway,
  type PaymentIntentStatus,
  type PaymentIntentView,
} from "./gateway";

/**
 * Demo mode (SPEC MDB-4, "replay a sale"): the admin sale route writes a payments row whose
 * PaymentIntent id starts with this prefix, with no card and no Stripe object behind it. Such an
 * id never reaches Stripe: `RoutingPaymentGateway` sends it to `DemoPaymentGateway`.
 */
export const DEMO_PAYMENT_INTENT_PREFIX = "pi_demo_";

export function isDemoPaymentIntentId(id: string): boolean {
  return id.startsWith(DEMO_PAYMENT_INTENT_PREFIX);
}

interface PaymentRow {
  stripe_pi: string;
  campaign_id: string;
  email: string | null;
  qty: number;
  amount: bigint;
  status: string;
}

type DemoEffect = "captured" | "canceled";

/**
 * The PaymentIntent status a demo payments row stands for, before any call of this process:
 * 'processing' is a sale authorized and awaiting capture, 'ticketed' one that was captured,
 * 'cancelled_paused' and 'failed' are released authorizations.
 */
function statusOfRow(rowStatus: string): PaymentIntentStatus {
  switch (rowStatus) {
    case "processing":
      return "requires_capture";
    case "ticketed":
      return "succeeded";
    case "cancelled_paused":
    case "failed":
      return "canceled";
    default:
      return "requires_payment_method";
  }
}

/**
 * The payment gateway of demo sales. `retrievePaymentIntent` answers from the payments row the
 * admin sale route wrote: its amount, metadata `kind: "purchase"` with the row's campaign id and
 * quantity, its e-mail. Capture, cancel and refund touch no money: they are recorded in memory,
 * once per idempotency key (a reused key replays the first answer), and reflected by the next
 * retrieve. Transitions the `PaymentGateway` contract forbids are still refused, so the purchase
 * job behaves exactly as with Stripe: a captured intent cannot be cancelled, a cancelled one
 * cannot be captured, only a captured one can be refunded.
 *
 * Memory is lost on restart; the payments row then says what happened ('ticketed' reads as
 * captured), and capturing again is a success anyway.
 */
export class DemoPaymentGateway implements PaymentGateway {
  private readonly effects = new Map<string, DemoEffect>();
  private readonly refunded = new Set<string>();
  /** Idempotency keys already used, with the outcome of their first call. */
  private readonly keys = new Map<string, PaymentGatewayError | null>();

  constructor(private readonly db: Db) {}

  async retrievePaymentIntent(id: string): Promise<PaymentIntentView | null> {
    assertDemoId(id);
    const row = await this.loadRow(id);
    if (row === null) return null;
    return {
      id: row.stripe_pi,
      status: this.statusOf(row),
      amount: row.amount,
      currency: "usd",
      metadata: {
        kind: STRIPE_PAYMENT_KINDS.purchase,
        campaignId: row.campaign_id,
        qty: row.qty.toString(),
      },
      payerEmail: row.email,
    };
  }

  async capturePaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    await this.once(id, idempotencyKey, (status) => {
      if (status === "succeeded") return;
      if (status !== "requires_capture") {
        throw unexpectedState(`demo PaymentIntent ${id} cannot be captured: it is ${status}`);
      }
      this.effects.set(id, "captured");
    });
  }

  async cancelPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    await this.once(id, idempotencyKey, (status) => {
      if (status === "canceled") return;
      if (status === "succeeded") {
        throw unexpectedState(`demo PaymentIntent ${id} cannot be cancelled: it was captured`);
      }
      this.effects.set(id, "canceled");
    });
  }

  async refundPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    await this.once(id, idempotencyKey, (status) => {
      if (this.refunded.has(id)) return;
      if (status !== "succeeded") {
        throw new PaymentGatewayError(`demo PaymentIntent ${id} has no captured charge`, {
          retryable: false,
          code: "charge_not_refundable",
        });
      }
      this.refunded.add(id);
    });
  }

  /** Whether a refund of this demo intent was recorded. */
  wasRefunded(id: string): boolean {
    return this.refunded.has(id);
  }

  private statusOf(row: PaymentRow): PaymentIntentStatus {
    const effect = this.effects.get(row.stripe_pi);
    if (effect === "captured") return "succeeded";
    if (effect === "canceled") return "canceled";
    return statusOfRow(row.status);
  }

  private async loadRow(id: string): Promise<PaymentRow | null> {
    try {
      const [row] = await this.db<PaymentRow[]>`
        select stripe_pi, campaign_id, email, qty, amount, status
          from payments where stripe_pi = ${id}
      `;
      return row ?? null;
    } catch (error: unknown) {
      throw new PaymentGatewayError(`reading demo PaymentIntent ${id} failed`, {
        retryable: true,
        cause: error,
      });
    }
  }

  /** Applies a mutating call once per idempotency key; a reused key replays the first answer. */
  private async once(
    id: string,
    idempotencyKey: string,
    apply: (status: PaymentIntentStatus) => void,
  ): Promise<void> {
    assertDemoId(id);
    if (this.keys.has(idempotencyKey)) {
      const first = this.keys.get(idempotencyKey);
      if (first) throw first;
      return;
    }
    const row = await this.loadRow(id);
    if (row === null) {
      throw new PaymentGatewayError(`No such demo payment_intent: ${id}`, {
        retryable: false,
        code: "resource_missing",
      });
    }
    // A concurrent call with the same key may have finished while the row was read.
    if (this.keys.has(idempotencyKey)) {
      const first = this.keys.get(idempotencyKey);
      if (first) throw first;
      return;
    }
    try {
      apply(this.statusOf(row));
    } catch (error: unknown) {
      if (error instanceof PaymentGatewayError) this.keys.set(idempotencyKey, error);
      throw error;
    }
    this.keys.set(idempotencyKey, null);
  }
}

function assertDemoId(id: string): void {
  if (!isDemoPaymentIntentId(id)) {
    throw new PaymentGatewayError(
      `${id} is not a demo PaymentIntent: the demo gateway only answers for ${DEMO_PAYMENT_INTENT_PREFIX} ids`,
      { retryable: false, code: "not_a_demo_payment" },
    );
  }
}

function unexpectedState(message: string): PaymentGatewayError {
  return new PaymentGatewayError(message, {
    retryable: false,
    code: "payment_intent_unexpected_state",
  });
}
