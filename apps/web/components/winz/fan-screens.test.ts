import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { CRYPTO_WORDS } from "../../lib/crypto-words";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The files a fan's screen is made of: C1, C2, C3, what they use, and their data. */
const FAN_FILES = [
  "app/(fan)",
  "components/winz/campaign-page.tsx",
  "components/winz/checkout-sheet.tsx",
  "components/winz/stripe-payment.tsx",
  "components/winz/ticket-screen.tsx",
  "components/winz/add-to-home.tsx",
  "components/winz/money.tsx",
  "components/winz/team-badge.tsx",
  "components/winz/ticket-shell.tsx",
  "components/winz/celebration.tsx",
  "components/ui/qty-stepper.tsx",
  "components/ui/gauge.tsx",
  "components/ui/countdown.tsx",
  "components/ui/sheet.tsx",
  "components/ui/demo-banner.tsx",
  "lib/fan",
  "lib/stripe",
  "lib/realtime",
  "lib/share.ts",
  // What a link preview and a printed poster say: fans read them too.
  "components/og",
  "app/(merchant)/poster",
  "lib/og/poster.ts",
];

function sourceFiles(path: string): string[] {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [join(ROOT, child)]
      : [];
  });
}

/**
 * The text a screen can show: string literals, template parts, JSX text. Identifiers, imports and
 * property names are code, not copy: `ticketToken` is a field of the API and never reaches a screen.
 */
function visibleText(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      found.push(node.text);
    } else if (ts.isJsxText(node)) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function offenders(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    visibleText(file)
      .filter((text) => pattern.test(text))
      .map((text) => `${relative(ROOT, file)}: ${text.trim().slice(0, 60)}`),
  );
}

describe("fan screens", () => {
  const files = FAN_FILES.flatMap(sourceFiles);

  it("finds the screens it is going to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.some((file) => file.endsWith("ticket-screen.tsx"))).toBe(true);
  });

  it("writes no crypto word in anything a fan can read", () => {
    expect(offenders(files, CRYPTO_WORDS)).toEqual([]);
  });

  it("writes no domain by hand", () => {
    expect(offenders(files, /https?:\/\/[a-z0-9-]+\.[a-z]{2,}/i)).toEqual([]);
  });
});
