import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cn, FONT_SIZE_TOKENS, RADIUS_TOKENS } from "./utils";

describe("cn with the Winz tokens", () => {
  it("keeps a text color and a font-size token side by side", () => {
    // Regression: tailwind-merge took `text-lead` for a color and dropped `text-ink`.
    expect(cn("bg-lime text-ink", "text-lead")).toBe("bg-lime text-ink text-lead");
    expect(cn("text-body", "text-text")).toBe("text-body text-text");
    expect(cn("text-text", "text-title")).toBe("text-text text-title");
  });

  it("still resolves two colors, or two sizes, to the last one", () => {
    expect(cn("text-ink", "text-lime")).toBe("text-lime");
    expect(cn("text-lead", "text-body")).toBe("text-body");
    expect(cn("text-sm", "text-lead")).toBe("text-lead");
  });

  it("lets a caller's radius replace the component's own", () => {
    expect(cn("rounded-card-sm", "rounded-full")).toBe("rounded-full");
    expect(cn("rounded-full", "rounded-card")).toBe("rounded-card");
  });

  it("keeps an arbitrary size and a color too", () => {
    expect(cn("text-ink", "text-[17px]")).toBe("text-ink text-[17px]");
  });
});

describe("token lists", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf-8");

  it("lists every --text-* size declared in globals.css", () => {
    const declared = new Set(
      [...css.matchAll(/^\s*--text-([a-z0-9-]+):/gm)]
        .map((match) => match[1] ?? "")
        .filter((name) => !name.includes("--")),
    );
    expect([...declared].sort()).toEqual([...FONT_SIZE_TOKENS].sort());
  });

  it("lists every --radius-* declared in globals.css", () => {
    const declared = [...css.matchAll(/^\s*--radius-([a-z0-9-]+):/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(declared.sort()).toEqual([...RADIUS_TOKENS].sort());
  });
});
