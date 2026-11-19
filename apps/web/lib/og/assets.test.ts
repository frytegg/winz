import { describe, expect, it } from "vitest";

import { loadSoraFonts, wordmarkDataUrl } from "./assets";

describe("the assets of the generated images", () => {
  it("reads Sora in the two weights the images use, as complete TrueType files", async () => {
    const fonts = await loadSoraFonts();
    expect(fonts).toBeDefined();
    expect(fonts?.map((font) => [font.name, font.weight, font.style])).toEqual([
      ["Sora", 400, "normal"],
      ["Sora", 600, "normal"],
    ]);
    for (const font of fonts ?? []) {
      const bytes = new Uint8Array(font.data);
      // 0x00010000 opens a TrueType file. The renderer cannot read WOFF2, which opens with "wOF2".
      expect([...bytes.slice(0, 4)]).toEqual([0, 1, 0, 0]);
      expect(bytes.length).toBeGreaterThan(50_000);
    }
  });

  it("inlines the wordmark as an SVG data URL", async () => {
    const url = await wordmarkDataUrl();
    expect(url?.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });
});
