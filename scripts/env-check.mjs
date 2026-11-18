// Says whether an environment is complete for the engine or the web app, BEFORE it is deployed.
//
//   pnpm env:check <engine|web> [--file <path>]   check the environment (or a dotenv-style file)
//   pnpm env:check <engine|web> --list            the target's variables, as a Markdown table
//
// It runs the SAME zod schemas the two services validate with at start-up (imported, never
// copied): apps/engine/src/config/env.ts (+ PORT of the health listener) and
// apps/web/lib/server/env.ts. It never prints a value: a variable is set, missing, left to its
// default, or malformed (with the zod message, from which the value is removed).
//
// Run through tsx (the schemas are TypeScript), which the root package.json script does.
// Exit codes: 0 = complete, 1 = something required is missing or malformed, or a secret sits where
// it must not (an engine key on the web app, a secret under NEXT_PUBLIC_), 2 = usage error.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TARGETS = ["engine", "web"];

/** Variables the platforms set themselves: never reported as typos. */
const PLATFORM =
  /^(VERCEL|VERCEL_.+|RAILWAY_.+|NODE_ENV|NODE_OPTIONS|TZ|ENABLE_EXPERIMENTAL_COREPACK|PORT|HOSTNAME|CI)$/;
/** In the process environment (no --file), only names that look like ours are inspected. */
const PROJECT_NAME = /^(APP|DB|ARC|GEMINI|STRIPE|PRIVY|NEXT_PUBLIC|QUICKNODE|SUPABASE)_[A-Z0-9_]+$/;
/** A secret's name. Such a variable read only by the engine has no business on the web app. */
const SECRET_NAME = /(PRIVATE_KEY|SECRET|SEED|TOKEN|SERVICE_ROLE|PASSWORD)/;
/** Next.js inlines every NEXT_PUBLIC_ variable into the JavaScript sent to every browser. */
const PUBLIC_PREFIX = /^NEXT_PUBLIC_/;
/** zod's message for a field that is absent: shown as "required" instead. */
const ABSENT = /received undefined$/;

export class EnvCheckUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvCheckUsageError";
  }
}

/**
 * The schemas of both services, imported from their own files. `engine` is the engine's schema
 * plus the health listener's PORT, which the engine reads apart from it.
 */
export async function loadSchemas(root = ROOT) {
  const engineEnv = await import(
    pathToFileURL(resolve(root, "apps/engine/src/config/env.ts")).href
  );
  const health = await import(
    pathToFileURL(resolve(root, "apps/engine/src/health/server.ts")).href
  );
  const webEnv = await import(pathToFileURL(resolve(root, "apps/web/lib/server/env.ts")).href);
  return {
    engine: [engineEnv.engineEnvSchema, health.engineHealthEnvSchema],
    web: [webEnv.webEnvSchema],
  };
}

/** Names listed in .env.example (the template), used only to tell a front-end variable from a typo. */
export function exampleNames(root = ROOT) {
  const path = resolve(root, ".env.example");
  if (!existsSync(path)) return new Set();
  return new Set(Object.keys(parseDotenv(readFileSync(path, "utf8"))));
}

/** A dotenv-style file: KEY=VALUE lines, `export ` allowed, # comments, optional quotes. */
export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    out[match[1]] = value;
  }
  return out;
}

/** Each variable of a target: its name, whether it is required, its default (code, not a secret). */
export function variablesOf(schemas) {
  const variables = new Map();
  for (const schema of schemas) {
    for (const [name, field] of Object.entries(schema.shape)) {
      const empty = field.safeParse(undefined);
      variables.set(name, {
        name,
        required: !empty.success,
        defaultValue: empty.success && empty.data !== undefined ? empty.data : undefined,
        schema,
      });
    }
  }
  return variables;
}

/** The zod message, with the value removed should it ever appear in it. */
function scrub(message, value) {
  if (typeof value !== "string" || value.length < 3) return message;
  return message.split(value).join("<value>");
}

/**
 * Checks `source` against `target`'s schemas. Pure: no I/O, no value in the result.
 *
 * @param {{ target: string, source: Record<string, string | undefined>, schemas: unknown[],
 *   otherSchemas: unknown[], example: Set<string>, fromFile: boolean }} input
 */
export function checkEnv({ target, source, schemas, otherSchemas, example, fromFile }) {
  const variables = variablesOf(schemas);
  const others = variablesOf(otherSchemas);
  // An empty value means "not set", as both services read it.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );

  const issuesByName = new Map();
  for (const schema of schemas) {
    const picked = Object.fromEntries(
      Object.keys(schema.shape)
        .filter((k) => k in cleaned)
        .map((k) => [k, cleaned[k]]),
    );
    const result = schema.safeParse(picked);
    if (result.success) continue;
    for (const issue of result.error.issues) {
      const name = String(issue.path[0] ?? "(environment)");
      const list = issuesByName.get(name) ?? [];
      const message = name in cleaned || !ABSENT.test(issue.message) ? issue.message : "required";
      list.push(scrub(message, cleaned[name]));
      issuesByName.set(name, list);
    }
  }

  const rows = [];
  for (const variable of variables.values()) {
    const isSet = variable.name in cleaned;
    const issues = issuesByName.get(variable.name);
    let status;
    if (issues && !isSet) status = "missing";
    else if (issues) status = "invalid";
    else if (isSet) status = "set";
    else if (variable.defaultValue !== undefined) status = "default";
    else status = "unset";
    rows.push({
      name: variable.name,
      required: variable.required,
      status,
      message: issues?.join("; "),
    });
  }
  for (const [name, list] of issuesByName) {
    if (!variables.has(name)) {
      rows.push({ name, required: true, status: "invalid", message: list.join("; ") });
    }
  }

  const extras = [];
  for (const name of Object.keys(cleaned).sort()) {
    if (variables.has(name)) continue;
    if (PLATFORM.test(name)) continue;
    if (!fromFile && !PROJECT_NAME.test(name)) continue;
    if (PUBLIC_PREFIX.test(name) && SECRET_NAME.test(name)) {
      extras.push({
        name,
        kind: "exposed",
        message: "a secret under NEXT_PUBLIC_ is shipped to every browser: remove it",
      });
    } else if (target === "web" && others.has(name) && SECRET_NAME.test(name)) {
      extras.push({
        name,
        kind: "exposed",
        message: "an engine secret: it must not be on the web app, remove it",
      });
    } else if (others.has(name)) {
      extras.push({
        name,
        kind: "other-service",
        message: `read by the ${target === "engine" ? "web app" : "engine"}, not by the ${target}`,
      });
    } else if (example.has(name)) {
      extras.push({
        name,
        kind: "no-schema",
        message:
          "in .env.example, read by no server schema (front-end build-time variable, or not used yet)",
      });
    } else {
      extras.push({ name, kind: "unknown", message: `not read by the ${target}: a typo?` });
    }
  }

  const missing = rows.filter((r) => r.status === "missing").length;
  const invalid = rows.filter((r) => r.status === "invalid").length;
  const exposed = extras.filter((e) => e.kind === "exposed").length;
  return {
    target,
    rows,
    extras,
    missing,
    invalid,
    exposed,
    ok: missing === 0 && invalid === 0 && exposed === 0,
  };
}

/** The report as text. Never a value: set, missing, default, unset or the scrubbed message. */
export function formatReport(report, origin) {
  const lines = [`env:check ${report.target} (${origin})`];
  const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
  const width = Math.max(
    28,
    ...report.rows.map((r) => r.name.length + 2),
    ...report.extras.map((e) => e.name.length + 2),
  );
  const label = {
    set: "ok",
    missing: "MISSING",
    invalid: "INVALID",
    default: "default",
    unset: "unset",
  };
  for (const required of [true, false]) {
    const group = report.rows.filter((r) => r.required === required);
    if (group.length === 0) continue;
    lines.push(required ? "  required" : "  optional");
    for (const row of group) {
      const status = row.status === "set" && !required ? "set" : label[row.status];
      const detail =
        row.message ??
        (row.status === "set"
          ? "set"
          : row.status === "default"
            ? "unset, default applies"
            : row.status === "unset"
              ? "unset"
              : "");
      lines.push(`    ${pad(status, 9)}${pad(row.name, width)}${detail}`);
    }
  }
  if (report.extras.length > 0) {
    lines.push(`  not read by the ${report.target}`);
    for (const extra of report.extras) {
      const status =
        extra.kind === "unknown" ? "UNKNOWN" : extra.kind === "exposed" ? "REMOVE" : "note";
      lines.push(`    ${pad(status, 9)}${pad(extra.name, width)}${extra.message}`);
    }
  }
  lines.push(
    report.ok
      ? `result: complete for the ${report.target}`
      : `result: NOT complete for the ${report.target}: ${report.missing} missing, ${report.invalid} malformed, ${report.exposed} to remove`,
  );
  return lines.join("\n");
}

/** The target's variables as a Markdown table (docs/deploy.md is generated from it). */
export function formatList(target, schemas) {
  const lines = ["| Variable | Requise | Défaut |", "| --- | --- | --- |"];
  for (const variable of variablesOf(schemas).values()) {
    const fallback =
      variable.defaultValue === undefined ? "" : `\`${String(variable.defaultValue)}\``;
    lines.push(`| \`${variable.name}\` | ${variable.required ? "oui" : "non"} | ${fallback} |`);
  }
  return lines.join("\n");
}

export function parseArgs(argv) {
  const [target, ...rest] = argv;
  if (!TARGETS.includes(target)) {
    throw new EnvCheckUsageError(`usage: pnpm env:check <engine|web> [--file <path>] [--list]`);
  }
  let file;
  let list = false;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--file") {
      file = rest[i + 1];
      if (!file) throw new EnvCheckUsageError("--file needs a path");
      i += 1;
    } else if (rest[i] === "--list") {
      list = true;
    } else {
      throw new EnvCheckUsageError(`unknown argument: ${rest[i]}`);
    }
  }
  return { target, file, list };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const schemas = await loadSchemas();
  if (args.list) {
    console.log(formatList(args.target, schemas[args.target]));
    return 0;
  }
  let source = process.env;
  let origin = "process environment";
  if (args.file) {
    // Relative to where the command was typed (pnpm runs scripts from the root: INIT_CWD).
    const path = resolve(process.env.INIT_CWD ?? process.cwd(), args.file);
    if (!existsSync(path)) {
      console.error(`env:check: ${args.file} does not exist`);
      return 2;
    }
    source = parseDotenv(readFileSync(path, "utf8"));
    origin = `file ${args.file}`;
  }
  const report = checkEnv({
    target: args.target,
    source,
    schemas: schemas[args.target],
    otherSchemas: schemas[args.target === "engine" ? "web" : "engine"],
    example: exampleNames(),
    fromFile: Boolean(args.file),
  });
  console.log(formatReport(report, origin));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`env:check failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
