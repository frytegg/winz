import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { resumeCampaign } from "@/lib/server/campaign-writes";

export const dynamic = "force-dynamic";

export const POST = apiRoute("resumeCampaign", ({ principal, params }, deps) =>
  resumeCampaign(deps.db, requireMerchant(principal).merchantId, params.id ?? "", deps.now()),
);
