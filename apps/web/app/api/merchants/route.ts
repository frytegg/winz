import { apiRoute } from "@/lib/server/api-route";
import { requireUser } from "@/lib/server/auth";
import { createMerchant } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export const POST = apiRoute("createMerchant", ({ principal, body }, deps) =>
  createMerchant(deps.db, requireUser(principal), body),
);
