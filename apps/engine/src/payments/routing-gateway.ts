import { isDemoPaymentIntentId } from "./demo-gateway";
import { PaymentGatewayError, type PaymentGateway, type PaymentIntentView } from "./gateway";

/**
 * A real (non-demo) PaymentIntent arrived while no Stripe key is configured. Never retryable:
 * the engine must be restarted with a key for such a payment to be settled.
 */
export class StripeNotConfiguredError extends PaymentGatewayError {
  constructor(id: string) {
    super(
      `Stripe is not configured (no STRIPE_SECRET_KEY): PaymentIntent ${id} cannot be settled; only demo payments can`,
      { retryable: false, code: "stripe_not_configured" },
    );
    this.name = "StripeNotConfiguredError";
  }
}

/**
 * The engine's gateway: ids starting with `pi_demo_` go to the demo gateway and never reach
 * Stripe; every other id goes to the real gateway. `real` is null when no Stripe key is
 * configured: demo payments still work and a real id is refused with `StripeNotConfiguredError`.
 */
export class RoutingPaymentGateway implements PaymentGateway {
  constructor(
    private readonly real: PaymentGateway | null,
    private readonly demo: PaymentGateway,
  ) {}

  private route(id: string): PaymentGateway {
    if (isDemoPaymentIntentId(id)) return this.demo;
    if (this.real === null) throw new StripeNotConfiguredError(id);
    return this.real;
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentView | null> {
    return this.route(id).retrievePaymentIntent(id);
  }

  async capturePaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    await this.route(id).capturePaymentIntent(id, idempotencyKey);
  }

  async cancelPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    await this.route(id).cancelPaymentIntent(id, idempotencyKey);
  }

  async refundPaymentIntent(id: string, idempotencyKey: string): Promise<void> {
    await this.route(id).refundPaymentIntent(id, idempotencyKey);
  }
}
