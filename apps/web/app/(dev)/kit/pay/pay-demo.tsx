"use client";

import { useState } from "react";

import { FundBudget } from "@/components/winz/fund-budget";
import { apiFetch } from "@/lib/api/client";
import { planFromCreate } from "@/lib/merchant/funding";

const AMOUNT_CENTS = 1000;

/**
 * `FundBudget` with the real Stripe buttons, asking `POST /api/campaigns` as M7 does. Needs the real
 * back end (or one answered by the test harness) and a Stripe test key.
 */
export function PayDemo(): React.JSX.Element {
  const [funded, setFunded] = useState<string | null>(null);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-end gap-6 px-5 pb-8">
      <h1 className="text-title">Fund $10 (Stripe test mode)</h1>
      {funded === null ? null : (
        <p role="status" data-testid="funded">
          Funded: {funded}
        </p>
      )}
      <FundBudget
        amountCents={AMOUNT_CENTS}
        prepare={async () =>
          planFromCreate(
            await apiFetch("createCampaign", {
              body: {
                instrumentSymbol: "GEMI-TEST",
                unitPrice: "20000000",
                refundBps: 10000,
                usualMarginBps: 6500,
                minMarginBps: 4500,
                budget: "10000000",
                product: "Test pizza",
                requestId: crypto.randomUUID(),
              },
            }),
          )
        }
        onFunded={setFunded}
      />
    </main>
  );
}
