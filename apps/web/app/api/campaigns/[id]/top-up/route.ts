import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { topUpCampaign } from "@/lib/server/budget-top-up";

export const dynamic = "force-dynamic";

// Worst case read in budget-top-up.ts: three rounds that each cancel a holder (10 s + 1 retry,
// then a 47 s read when refused), one creation (21 s) and its read (47 s), a withdrawal (67 s) and
// a client secret read (21 s): about 356 s if Stripe timed out on every call. Capped at 300 s,
// the largest Hobby allows (Fluid compute); the usual path is one creation and one read (68 s).
export const maxDuration = 300;

export const POST = apiRoute("topUpCampaign", ({ principal, params, body }, deps) =>
  topUpCampaign(
    deps.db,
    deps.payments,
    requireMerchant(principal).merchantId,
    params.id ?? "",
    body,
    deps.now(),
  ),
);
