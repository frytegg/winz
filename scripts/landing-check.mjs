// Says what is still missing on the landing page, BEFORE it is shown to anyone.
//
//   pnpm landing-check
//
// Two things, both of which make the page look unfinished to the jury:
//   1. every link of apps/web/app/(landing)/landing.config.ts that is still `null` (or holds something
//      a page cannot use: `#`, `http:`, an empty string);
//   2. a note to self or a placeholder in a file the visitor reads: TODO, FIXME, lorem ipsum,
//      `[placeholder]`, `href="#"`.
//
// It is NOT part of CI, and it is red by design for most of the page's life: a job that is red on
// purpose teaches everyone to ignore red. The build never fails on a missing link (a deployment must
// not wait for a URL); this script is the one place that says so.
//
// Run through tsx (the config and the link rules are TypeScript), which the root package.json script
// does. Exit codes: 0 = nothing open, 1 = something is open, 2 = the script could not run.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");

/** What the visitor reads or follows: the page's own files. */
export const READ_DIRS = [
  join(WEB, "app", "(landing)"),
  join(WEB, "components", "landing"),
  join(WEB, "lib", "landing"),
];

/** `/landing/kit` is the development-only kit (a production build answers 404). */
const SKIPPED = [/\.test\.[cm]?[tj]sx?$/, /[\\/]landing[\\/]kit[\\/]/, /[\\/]node_modules[\\/]/];

/** Files that carry the rules themselves and so contain the words by design. */
const OWN_RULES = [/[\\/]links\.ts$/];

export const PLACEHOLDERS = [
  { name: "TODO", pattern: /\bTODO\b/ },
  { name: "FIXME", pattern: /\bFIXME\b/ },
  { name: "lorem ipsum", pattern: /lorem ipsum/i },
  { name: "[placeholder]", pattern: /\[(placeholder|your [a-z ]+|link|url)\]/i },
  { name: 'href="#"', pattern: /href=(?:"#"|'#'|\{\s*["']#["']\s*\})/ },
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (SKIPPED.some((pattern) => pattern.test(path))) continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|css|md|json)$/.test(entry)) yield path;
  }
}

/** Placeholder findings of `files`, as `{ file, line, name, text }`. */
export function findPlaceholders(files, read = (path) => readFileSync(path, "utf8")) {
  const found = [];
  for (const file of files) {
    if (OWN_RULES.some((pattern) => pattern.test(file))) continue;
    read(file)
      .split(/\r?\n/)
      .forEach((text, index) => {
        for (const { name, pattern } of PLACEHOLDERS) {
          if (pattern.test(text)) found.push({ file, line: index + 1, name, text: text.trim() });
        }
      });
  }
  return found;
}

export function formatReport({ missing, placeholders }) {
  const lines = [];
  lines.push(`Links (apps/web/app/(landing)/landing.config.ts): ${missing.length} open`);
  for (const entry of missing) lines.push(`  - ${entry.key.padEnd(24)} ${entry.reason}`);
  lines.push("");
  lines.push(`Placeholders in what a visitor reads: ${placeholders.length} open`);
  for (const hit of placeholders) {
    lines.push(
      `  - ${relative(ROOT, hit.file).replaceAll("\\", "/")}:${hit.line}  ${hit.name}: ${hit.text}`,
    );
  }
  lines.push("");
  const open = missing.length + placeholders.length;
  lines.push(
    open === 0
      ? "landing-check: nothing open."
      : `landing-check: ${open} open. Not a CI job: red until the page is ready.`,
  );
  return lines.join("\n");
}

async function main() {
  const { landingLinks } = await import(
    pathToFileURL(join(WEB, "app", "(landing)", "landing.config.ts")).href
  );
  const { missingLinks } = await import(
    pathToFileURL(join(WEB, "lib", "landing", "links.ts")).href
  );
  const missing = missingLinks(landingLinks);
  const placeholders = findPlaceholders(READ_DIRS.flatMap((dir) => [...walk(dir)]));
  console.log(formatReport({ missing, placeholders }));
  return missing.length + placeholders.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(
        `landing-check failed to run: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(2);
    },
  );
}
