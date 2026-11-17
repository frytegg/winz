import { apiRoute } from "@/lib/server/api-route";
import { setDemoBook } from "@/lib/server/demo";

export const dynamic = "force-dynamic";

export const POST = apiRoute("demoBook", ({ body }, deps) =>
  setDemoBook(deps.db, body, deps.now()),
);
