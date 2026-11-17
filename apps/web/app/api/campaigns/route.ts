import { defineRoute } from "@/lib/server/route";

export const dynamic = "force-dynamic";

export const POST = defineRoute("createCampaign");
export const GET = defineRoute("campaigns");
