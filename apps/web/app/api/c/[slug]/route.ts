import { apiRoute } from "@/lib/server/api-route";
import { publicCampaign } from "@/lib/server/tickets";

export const dynamic = "force-dynamic";

export const GET = apiRoute("publicCampaign", ({ params }, deps) =>
  publicCampaign(deps.db, params.slug ?? "", deps.now()),
);
