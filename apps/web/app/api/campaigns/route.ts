import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { createCampaign } from "@/lib/server/campaign-writes";
import { listCampaigns } from "@/lib/server/campaigns";

export const dynamic = "force-dynamic";

// Worst case, POST: the budget payment created inside the campaign's transaction with the short
// budget settings (10 s, 1 retry: about 21 s), plus the sign-in check. 30 s; the GET is a read.
export const maxDuration = 30;

export const POST = apiRoute("createCampaign", ({ principal, body }, deps) =>
  createCampaign(deps.db, deps.payments, requireMerchant(principal).merchantId, body, deps.now()),
);
export const GET = apiRoute("campaigns", ({ principal }, deps) =>
  listCampaigns(deps.db, requireMerchant(principal).merchantId, deps.now()),
);
