import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { topUpCampaign } from "@/lib/server/budget-top-up";

export const dynamic = "force-dynamic";

// Worst case read in budget-top-up.ts: three rounds that each cancel a holder (10 s + 1 retry,
// then a 47 s read when refused), one creation (21 s) and its read (47 s), a withdrawal (67 s) and
// a client secret read (21 s): about 356 s if Stripe timed out on every call. The second of two
// simultaneous calls of one request also waits for the first before its creation: up to 9 creates
// refused for the key in use (0.5 s each, Stripe's client retrying the 409 once) and 8 pauses of
// 1 s, about 13 s, so about 369 s summing the worst of every step. Capped at 300 s, the largest
// Hobby allows (Fluid compute): a cut during those waits leaves nothing of this call (its creates
// were refused), and the same requestId sent again answers the first call's top-up. The usual
// path is one creation and one read (68 s), a double tap's second call a pause or two more.
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
