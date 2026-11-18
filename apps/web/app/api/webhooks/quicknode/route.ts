import { apiRoute } from "@/lib/server/api-route";
import { handleQuicknodeWebhook, streamsSettingsOf } from "@/lib/server/quicknode-webhook";

export const dynamic = "force-dynamic";

// Worst case: a 4 MiB body read and inflated, then one transaction of a few hundred inserts, no
// outside call. QuickNode waits 30 s by default (the destination's Timeout) before it counts the
// delivery as failed and retries: running longer than that serves nobody.
export const maxDuration = 30;

// The signature covers the raw body: the handler reads it as bytes, never parsed before
// verification. QuickNode retries any answer other than 2xx, so a database failure answers 500.
// The token, the network and the escrow come from the server's configuration, its one reader of
// the environment.
export const POST = apiRoute("quicknodeWebhook", async ({ request }, deps) =>
  handleQuicknodeWebhook({
    db: deps.db,
    request,
    settings: streamsSettingsOf(deps.config()),
    now: deps.now(),
  }),
);
