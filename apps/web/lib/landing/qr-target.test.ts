import { describe, expect, it } from "vitest";

import { decorativeQr, hostOf, qrTarget } from "./qr-target";

describe("qrTarget", () => {
  it("is null when there is no live demo", () => {
    expect(qrTarget(null, "https://winz-nu.vercel.app/")).toBeNull();
  });

  it("makes a path absolute, against the app's address", () => {
    expect(qrTarget("/", "https://winz-nu.vercel.app/")).toBe("https://winz-nu.vercel.app/");
    expect(qrTarget("/start", "https://winz-nu.vercel.app/")).toBe(
      "https://winz-nu.vercel.app/start",
    );
  });

  it("keeps an absolute https address as it is", () => {
    expect(qrTarget("https://example.com/demo", null)).toBe("https://example.com/demo");
  });

  it("is null for anything a scan could not use: a path with no base, a protocol-relative or http base", () => {
    expect(qrTarget("/", null)).toBeNull();
    expect(qrTarget("//evil.example/", "https://winz-nu.vercel.app/")).toBeNull();
    expect(qrTarget("/", "http://winz-nu.vercel.app/")).toBeNull();
    expect(qrTarget("javascript:alert(1)", "https://winz-nu.vercel.app/")).toBeNull();
  });
});

describe("hostOf", () => {
  it("reads the host", () => {
    expect(hostOf("https://winz-nu.vercel.app/")).toBe("winz-nu.vercel.app");
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("decorativeQr", () => {
  const { size, modules } = decorativeQr();

  it("is the same every time", () => {
    expect(decorativeQr().modules).toEqual(modules);
  });

  it("has no finder square, so no reader would take it for a code", () => {
    // A finder pattern is a dark 7 x 7 ring: its top-left module and the row under it are dark in a real code.
    const at = (row: number, column: number): boolean => modules[row * size + column] === true;
    for (const [row, column] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      const ring = Array.from({ length: 7 }, (_, i) => at(row, column + i));
      expect(ring.every(Boolean)).toBe(false);
    }
  });
});
