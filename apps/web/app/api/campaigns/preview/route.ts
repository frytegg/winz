import { apiRoute } from "@/lib/server/api-route";
import { previewCampaign } from "@/lib/server/preview";

export const dynamic = "force-dynamic";

export const POST = apiRoute("campaignPreview", ({ body }, deps) =>
  previewCampaign(deps.db, body, deps.now()),
);
