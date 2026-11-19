import { apiRoute } from "@/lib/server/api-route";
import { requireMerchant } from "@/lib/server/auth";
import { createCampaign } from "@/lib/server/campaign-writes";
import { listCampaigns } from "@/lib/server/campaigns";

export const dynamic = "force-dynamic";

// Worst case, POST with a requestId: the budget payment created with the short budget settings
// (10 s, 1 retry: about 21 s), its status read back before it is recorded (default settings:
// about 47 s), and, for the second of two simultaneous taps, up to 8 pauses of 1 s between calls
// refused for a key still in use (about 13 s), then one more creation (about 21 s): about 102 s.
// 120 s, so that the platform never cuts a call that is about to answer; the GET is a read.
export const maxDuration = 120;

export const POST = apiRoute("createCampaign", ({ principal, body }, deps) =>
  createCampaign(deps.db, deps.payments, requireMerchant(principal).merchantId, body, deps.now()),
);
export const GET = apiRoute("campaigns", ({ principal }, deps) =>
  listCampaigns(deps.db, requireMerchant(principal).merchantId, deps.now()),
);
