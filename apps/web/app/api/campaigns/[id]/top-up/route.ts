import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { topUpCampaign } from "@/lib/server/budget-top-up";

export const dynamic = "force-dynamic";

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
