import { describe, expect, it, vi } from "vitest";

import { confirmIntent, isAuthorizedStatus, submitPayment, type StripeLike } from "./payment";

type ConfirmResult = Awaited<ReturnType<StripeLike["confirmPayment"]>>;

function fakeStripe(
  known: string | undefined,
  confirmed: ConfirmResult,
): { stripe: StripeLike; confirm: ReturnType<typeof vi.fn> } {
  const confirm = vi.fn().mockResolvedValue(confirmed);
  const stripe: StripeLike = {
    retrievePaymentIntent: () =>
      Promise.resolve(known === undefined ? {} : { paymentIntent: { status: known } }),
    confirmPayment: confirm as StripeLike["confirmPayment"],
  };
  return { stripe, confirm };
}

const BASE = { elements: {}, clientSecret: "pi_1_secret_x", returnUrl: "https://winz.test/c/joes" };

describe("submitPayment", () => {
  it("is ok when the form is valid, and gives Stripe's own message when it is not", async () => {
    expect(await submitPayment({ submit: () => Promise.resolve({}) })).toEqual({ ok: true });
    expect(
      await submitPayment({
        submit: () => Promise.resolve({ error: { message: "Your card number is incomplete." } }),
      }),
    ).toEqual({ ok: false, message: "Your card number is incomplete." });
  });
});

describe("confirmIntent", () => {
  it("authorizes a card and stays on the page (redirect if_required)", async () => {
    const { stripe, confirm } = fakeStripe("requires_payment_method", {
      paymentIntent: { status: "requires_capture" },
    });
    expect(await confirmIntent({ stripe, ...BASE })).toEqual({ ok: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({
      clientSecret: "pi_1_secret_x",
      redirect: "if_required",
    });
  });

  it("passes the e-mail typed next to a card, and none for a wallet", async () => {
    const withEmail = fakeStripe("requires_payment_method", {
      paymentIntent: { status: "requires_capture" },
    });
    await confirmIntent({ stripe: withEmail.stripe, ...BASE, email: "maya@example.com" });
    expect(withEmail.confirm.mock.calls[0]?.[0].confirmParams.payment_method_data).toEqual({
      billing_details: { email: "maya@example.com" },
    });
    const wallet = fakeStripe("requires_payment_method", {
      paymentIntent: { status: "requires_capture" },
    });
    await confirmIntent({ stripe: wallet.stripe, ...BASE });
    expect(wallet.confirm.mock.calls[0]?.[0].confirmParams.payment_method_data).toBeUndefined();
  });

  it("shows the refusal of the card as Stripe words it, and nothing is authorized", async () => {
    const { stripe } = fakeStripe("requires_payment_method", {
      error: { message: "Your card was declined." },
    });
    expect(await confirmIntent({ stripe, ...BASE })).toEqual({
      ok: false,
      message: "Your card was declined.",
    });
  });

  it("does not confirm twice an intent that is already authorized or paid", async () => {
    for (const status of ["requires_capture", "succeeded", "processing"]) {
      const { stripe, confirm } = fakeStripe(status, {});
      expect(await confirmIntent({ stripe, ...BASE })).toEqual({ ok: true });
      expect(confirm).not.toHaveBeenCalled();
    }
  });

  it("refuses a cancelled intent without calling Stripe again", async () => {
    const { stripe, confirm } = fakeStripe("canceled", {});
    const result = await confirmIntent({ stripe, ...BASE });
    expect(result.ok).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("is not done when the intent ends neither authorized nor in an error", async () => {
    const { stripe } = fakeStripe(undefined, { paymentIntent: { status: "requires_action" } });
    expect((await confirmIntent({ stripe, ...BASE })).ok).toBe(false);
  });

  it("knows which statuses count as done", () => {
    expect(isAuthorizedStatus("requires_capture")).toBe(true);
    expect(isAuthorizedStatus("requires_payment_method")).toBe(false);
    expect(isAuthorizedStatus("canceled")).toBe(false);
  });
});
