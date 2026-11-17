import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { closeCampaign } from "@/lib/server/campaign-writes";

export const dynamic = "force-dynamic";

export const POST = apiRoute("closeCampaign", ({ principal, params }, deps) =>
  closeCampaign(deps.db, requireMerchant(principal).merchantId, params.id ?? "", deps.now()),
);
