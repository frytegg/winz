import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { copy } from "@/lib/copy";

/**
 * Rules of the demo panel that no unit of logic can show, checked on the code that carries them:
 * the venue label is the API's, and the admin key goes nowhere but `sessionStorage` and the
 * `x-admin-key` header.
 */

function sources(dir: string, extension: string): { name: string; code: string }[] {
  const root = join(process.cwd(), dir);
  return readdirSync(root)
    .filter((name) => name.endsWith(extension) && !name.endsWith(`.test${extension}`))
    .map((name) => ({
      name: `${dir}/${name}`,
      // Comments explain the rules ("never localStorage"): only the code is judged.
      code: readFileSync(join(root, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    }));
}

const ADMIN_CODE = [
  ...sources("components/admin", ".tsx"),
  ...sources("lib/admin", ".ts"),
  ...sources("app/admin", ".tsx"),
];

describe("the demo panel's code", () => {
  it("finds the files it is going to check", () => {
    expect(ADMIN_CODE.length).toBeGreaterThan(15);
  });

  it("never types the execution venue: it is the API's `venueLabel`, as sent", () => {
    const offenders = ADMIN_CODE.filter(({ code }) => /PAPER|live Gemini book/.test(code));
    expect(offenders.map(({ name }) => name)).toEqual([]);
    expect(JSON.stringify(copy.admin)).not.toMatch(/PAPER|live Gemini book/);
  });

  it("never touches localStorage, a cookie, the URL or a log", () => {
    const offenders = ADMIN_CODE.filter(({ code }) =>
      /localStorage|document\.cookie|location\.(search|hash|href)|history\.(push|replace)State|console\./.test(
        code,
      ),
    );
    expect(offenders.map(({ name }) => name)).toEqual([]);
  });

  it("reads the key from storage in one file only, and only sessionStorage", () => {
    const readers = ADMIN_CODE.filter(({ code }) => /sessionStorage/.test(code));
    expect(readers.map(({ name }) => name)).toEqual(["lib/admin/key.ts"]);
  });

  it("lets the key leave the page in the apiFetch call only", () => {
    const senders = ADMIN_CODE.filter(({ code }) => /\badminKey\b/.test(code));
    expect(senders.map(({ name }) => name)).toEqual(["lib/admin/api.ts"]);
  });
});
