import { apiRoute } from "@/lib/server/api-route";
import { requireUser } from "@/lib/server/auth";
import { getMe } from "@/lib/server/me";

export const dynamic = "force-dynamic";

export const GET = apiRoute("me", ({ principal }, deps) => getMe(deps.db, requireUser(principal)));
