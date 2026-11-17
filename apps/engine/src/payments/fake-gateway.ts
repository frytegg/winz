import { PaymentGatewayError, type PaymentGateway, type PaymentIntentView } from "./gateway";

/** A call the fake received, in order. */
export interface FakeGatewayCall {
  method: FakeGatewayMethod;
  id: string;
  idempotencyKey: string | null;
}

export type FakeGatewayMethod = "retrieve" | "capture" | "cancel" | "refund";

interface FakeIntent {
  view: PaymentIntentView;
  refunded: boolean;
}

/** A failure the fake was told to raise, for the next `times` calls of a method. */
interface PlannedFailure {
  error: Error;
  times: number;
}

/** Effects actually applied to one intent: what the customer would see on their statement. */
export interface FakeIntentEffects {
  captures: number;
  cancels: number;
  refunds: number;
}

/**
 * A payment gateway for tests, with Stripe's semantics: capture moves `requires_capture` to
 * `succeeded`, cancel moves it to `canceled`, refund marks a `succeeded` intent refunded. A
 * repeated call with an idempotency key already used answers like the first one and changes
 * nothing; capturing a captured intent and cancelling a canceled one are successes. It records
 * every call and can be told to fail. Test code only.
 */
export class FakePaymentGateway implements PaymentGateway {
  readonly calls: FakeGatewayCall[] = [];
  private readonly intents = new Map<string, FakeIntent>();
  private readonly effects = new Map<string, FakeIntentEffects>();
  private readonly failures = new Map<string, PlannedFailure>();
  /** Idempotency keys already used, with the outcome of their first call. */
  private readonly keys = new Map<string, Error | null>();

  /** Adds or replaces an intent. */
  setIntent(view: PaymentIntentView): void {
    this.intents.set(view.id, {
      view: { ...view, metadata: { ...view.metadata } },
      refunded: false,
    });
  }

  /** The intent as the fake holds it now. */
  intent(id: string): PaymentIntentView | undefined {
    const stored = this.intents.get(id);
    return stored === undefined ? undefined : { ...stored.view };
  }

  /** Changes the status of an intent, as the bank or the customer would. */
  setStatus(id: string, status: PaymentIntentView["status"]): void {
    const stored = this.intents.get(id);
    if (stored === undefined) throw new Error(`fake gateway: no intent ${id}`);
    stored.view = { ...stored.view, status };
  }

  /** The next `times` calls of `method` (all intents) throw `error`. */
  failNext(method: FakeGatewayMethod, error: Error, times = 1): void {
    this.failures.set(method, { error, times });
  }

  /** Stops every planned failure. */
  clearFailures(): void {
    this.failures.clear();
  }

  effectsOf(id: string): FakeIntentEffects {
    return { ...(this.effects.get(id) ?? { captures: 0, cancels: 0, refunds: 0 }) };
  }

  wasRefunded(id: string): boolean {
    return this.intents.get(id)?.refunded ?? false;
  }

  callsOf(id: string, method?: FakeGatewayMethod): FakeGatewayCall[] {
    return this.calls.filter(
      (call) => call.id === id && (method === undefined || call.method === method),
    );
  }

  private record(method: FakeGatewayMethod, id: string, idempotencyKey: string | null): void {
    this.calls.push({ method, id, idempotencyKey });
    const planned = this.failures.get(method);
    if (planned !== undefined && planned.times > 0) {
      planned.times -= 1;
      if (planned.times === 0) this.failures.delete(method);
      throw planned.error;
    }
  }

  private bump(id: string, effect: keyof FakeIntentEffects): void {
    const current = this.effects.get(id) ?? { captures: 0, cancels: 0, refunds: 0 };
    current[effect] += 1;
    this.effects.set(id, current);
  }

  private stored(id: string): FakeIntent {
    const stored = this.intents.get(id);
    if (stored === undefined) {
      throw new PaymentGatewayError(`No such payment_intent: ${id}`, {
        retryable: false,
        code: "resource_missing",
      });
    }
    return stored;
  }

  /** Applies the call once per idempotency key; a reused key replays the first answer. */
  private firstUse(idempotencyKey: string, apply: () => void): void {
    if (this.keys.has(idempotencyKey)) {
      const first = this.keys.get(idempotencyKey);
      if (first) throw first;
      return;
    }
    try {
      apply();
      this.keys.set(idempotencyKey, null);
    } catch (error: unknown) {
      // Stripe stores the answer of a request that reached it, errors included.
      if (error instanceof PaymentGatewayError && !error.retryable) {
        this.keys.set(idempotencyKey, error);
      }
      throw error;
    }
  }

  retrievePaymentIntent(id: string): Promise<PaymentIntentView | null> {
    try {
      this.record("retrieve", id, null);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    const stored = this.intents.get(id);
    return Promise.resolve(stored === undefined ? null : { ...stored.view });
  }

  capturePaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    try {
      this.record("capture", id, idempotencyKey);
      this.firstUse(idempotencyKey, () => {
        const stored = this.stored(id);
        if (stored.view.status === "succeeded") return;
        if (stored.view.status !== "requires_capture") {
          throw new PaymentGatewayError(
            `This PaymentIntent could not be captured because it has a status of ${stored.view.status}`,
            { retryable: false, code: "payment_intent_unexpected_state" },
          );
        }
        stored.view = { ...stored.view, status: "succeeded" };
        this.bump(id, "captures");
      });
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  cancelPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    try {
      this.record("cancel", id, idempotencyKey);
      this.firstUse(idempotencyKey, () => {
        const stored = this.stored(id);
        if (stored.view.status === "canceled") return;
        if (stored.view.status === "succeeded") {
          throw new PaymentGatewayError(
            "You cannot cancel this PaymentIntent because it has a status of succeeded",
            { retryable: false, code: "payment_intent_unexpected_state" },
          );
        }
        stored.view = { ...stored.view, status: "canceled" };
        this.bump(id, "cancels");
      });
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  refundPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    try {
      this.record("refund", id, idempotencyKey);
      this.firstUse(idempotencyKey, () => {
        const stored = this.stored(id);
        if (stored.refunded) return;
        if (stored.view.status !== "succeeded") {
          throw new PaymentGatewayError("This PaymentIntent does not have a successful charge", {
            retryable: false,
            code: "charge_not_refundable",
          });
        }
        stored.refunded = true;
        this.bump(id, "refunds");
      });
      return Promise.resolve();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }
}

/** A failure that may succeed later (network, outage). */
export function transientGatewayError(message = "connection reset"): PaymentGatewayError {
  return new PaymentGatewayError(message, { retryable: true });
}

/** A failure that never will (the authorization expired, a state error). */
export function permanentGatewayError(
  message = "authorization expired",
  code = "charge_expired_for_capture",
): PaymentGatewayError {
  return new PaymentGatewayError(message, { retryable: false, code });
}
