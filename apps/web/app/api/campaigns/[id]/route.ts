import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { getCampaignDetail } from "@/lib/server/campaigns";

export const dynamic = "force-dynamic";

export const GET = apiRoute("campaignDetail", ({ principal, params }, deps) =>
  getCampaignDetail(
    deps.db,
    requireMerchant(principal).merchantId,
    params.id ?? "",
    deps.config(),
    deps.now(),
  ),
);
