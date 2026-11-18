import { apiRoute } from "@/lib/server/api-route";
import { handleQuicknodeWebhook, streamsSettings } from "@/lib/server/quicknode-webhook";

export const dynamic = "force-dynamic";

// The signature covers the raw body: the handler reads it as bytes, never parsed before
// verification. QuickNode retries any answer other than 2xx, so a database failure answers 500.
export const POST = apiRoute("quicknodeWebhook", async ({ request }, deps) =>
  handleQuicknodeWebhook({
    db: deps.db,
    request,
    settings: streamsSettings(process.env, deps.config().escrowAddress),
    now: deps.now(),
  }),
);
