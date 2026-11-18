// Says whether a deployed stack answers, from anywhere (a laptop, CI), with no secret.
//
//   pnpm smoke <base-url> [--campaign <slug>] [--engine <engine-url>] [--timeout <ms>]
//
// Only GET requests: it never writes anything. Each answer is checked against the schemas of
// packages/shared (the engine's /healthz against the schema exported next to its listener). One
// line per check with its duration; stops at the first failure.
//
//   GET /                  the home page answers HTML
//   GET /api/health        the web app runs
//   GET /api/events        401 with the API error body: the real API runs (not the mock, which
//                          would answer the example list without a token)
//   GET /api/hedge-desk    a public route that reads the database
//   GET /api/c/<slug>      with --campaign: a public campaign page (the seed creates none: pass the
//                          slug of a campaign created on the deployed stack)
//   GET <engine>/healthz   with --engine: the engine runs, reaches its database and its node
//
// Run through tsx (the schemas are TypeScript), which the root package.json script does.
// Exit codes: 0 = every check passed, 1 = a check failed, 2 = usage error.
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class SmokeUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "SmokeUsageError";
  }
}

export class SmokeCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "SmokeCheckError";
  }
}

const USAGE =
  "usage: pnpm smoke <base-url> [--campaign <slug>] [--engine <engine-url>] [--timeout <ms>]";

function parseUrl(value, what) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SmokeUsageError(`${what} is not a URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SmokeUsageError(`${what} must be http(s): ${value}`);
  }
  return url.href.replace(/\/+$/, "");
}

export function parseArgs(argv) {
  const positional = [];
  const options = { campaign: undefined, engine: undefined, timeoutMs: 15_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new SmokeUsageError(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--campaign") options.campaign = next();
    else if (arg === "--engine") options.engine = parseUrl(next(), "--engine");
    else if (arg === "--timeout") {
      options.timeoutMs = Number(next());
      if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
        throw new SmokeUsageError("--timeout must be a positive number of milliseconds");
      }
    } else if (arg.startsWith("--")) throw new SmokeUsageError(`unknown option ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new SmokeUsageError(USAGE);
  return { base: parseUrl(positional[0], "base-url"), ...options };
}

/** The schemas the checks use, imported from where they are defined. */
export async function loadSchemas(root = ROOT) {
  const shared = await import(pathToFileURL(resolve(root, "packages/shared/src/index.ts")).href);
  const health = await import(
    pathToFileURL(resolve(root, "apps/engine/src/health/server.ts")).href
  );
  return {
    apiError: shared.apiErrorSchema,
    hedgeDesk: shared.API_ROUTES.hedgeDesk.response,
    publicCampaign: shared.API_ROUTES.publicCampaign.response,
    engineHealth: health.healthReportSchema,
  };
}

function firstIssue(result) {
  const issue = result.error.issues[0];
  return `${issue.path.join(".") || "(body)"}: ${issue.message}`;
}

async function getJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SmokeCheckError(
      `HTTP ${response.status}, not JSON (${text.slice(0, 80).replace(/\s+/g, " ")})`,
    );
  }
  return { status: response.status, body };
}

function expectStatus(actual, expected) {
  if (actual !== expected) throw new SmokeCheckError(`HTTP ${actual}, expected ${expected}`);
}

function expectSchema(schema, body, what) {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new SmokeCheckError(`${what} does not match its schema: ${firstIssue(result)}`);
  return result.data;
}

/** The checks to run, in order. Each returns a short note on success and throws on failure. */
export function buildChecks(args, schemas) {
  const { base, timeoutMs } = args;
  const checks = [
    {
      name: "GET /",
      run: async () => {
        const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(timeoutMs) });
        await response.arrayBuffer();
        expectStatus(response.status, 200);
        const type = response.headers.get("content-type") ?? "";
        if (!type.includes("text/html"))
          throw new SmokeCheckError(`content-type ${type}, expected text/html`);
        return "HTML";
      },
    },
    {
      name: "GET /api/health",
      run: async () => {
        const { status, body } = await getJson(`${base}/api/health`, timeoutMs);
        expectStatus(status, 200);
        if (body?.ok !== true || body?.service !== "web")
          throw new SmokeCheckError('body is not { ok: true, service: "web" }');
        return "web up";
      },
    },
    {
      name: "GET /api/events (no token)",
      run: async () => {
        const { status, body } = await getJson(`${base}/api/events`, timeoutMs);
        if (status === 200) {
          throw new SmokeCheckError(
            "HTTP 200 without a token: the mock API is served (APP_API_MOCK)",
          );
        }
        expectStatus(status, 401);
        const error = expectSchema(schemas.apiError, body, "the error");
        return `401 ${error.error.code}: real API, not the mock`;
      },
    },
    {
      name: "GET /api/hedge-desk",
      run: async () => {
        const { status, body } = await getJson(`${base}/api/hedge-desk`, timeoutMs);
        expectStatus(status, 200);
        const desk = expectSchema(schemas.hedgeDesk, body, "the Hedge desk");
        return `${desk.instruments.length} instrument(s), venue ${desk.venue}`;
      },
    },
  ];
  if (args.campaign !== undefined) {
    const slug = encodeURIComponent(args.campaign);
    checks.push({
      name: `GET /api/c/${slug}`,
      run: async () => {
        const { status, body } = await getJson(`${base}/api/c/${slug}`, timeoutMs);
        expectStatus(status, 200);
        const campaign = expectSchema(schemas.publicCampaign, body, "the campaign");
        return `sale state ${campaign.saleState ?? "?"}`;
      },
    });
  }
  if (args.engine !== undefined) {
    checks.push({
      name: "GET <engine>/healthz",
      run: async () => {
        const { status, body } = await getJson(`${args.engine}/healthz`, timeoutMs);
        const report = expectSchema(schemas.engineHealth, body, "the engine's health");
        if (status !== 200) {
          throw new SmokeCheckError(
            `HTTP ${status}: db ${report.db}, node head ${String(report.chain.head)}, sender ${report.sender}, jobs ${report.jobs}`,
          );
        }
        return `chain ${report.chain.id} head ${report.chain.head} cursor ${String(report.chain.cursor)}, up ${report.uptimeS} s`;
      },
    });
  }
  return checks;
}

/** Runs the checks in order, writes one line each, stops at the first failure. True when all pass. */
export async function runChecks(checks, write) {
  for (const check of checks) {
    const started = performance.now();
    try {
      const note = await check.run();
      write(
        `ok    ${check.name.padEnd(30)} ${String(Math.round(performance.now() - started)).padStart(5)} ms  ${note}`,
      );
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "no answer within the timeout"
          : error instanceof Error
            ? error.cause instanceof Error
              ? `${error.message}: ${error.cause.message}`
              : error.message
            : String(error);
      write(
        `FAIL  ${check.name.padEnd(30)} ${String(Math.round(performance.now() - started)).padStart(5)} ms  ${message}`,
      );
      return false;
    }
  }
  return true;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const checks = buildChecks(args, await loadSchemas());
  console.log(`smoke ${args.base}${args.engine ? ` (engine ${args.engine})` : ""}`);
  const ok = await runChecks(checks, (line) => console.log(line));
  console.log(ok ? `result: ${checks.length} checks passed` : "result: FAILED");
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`smoke failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
