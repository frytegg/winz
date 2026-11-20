import { describe, expect, it } from "vitest";

import { installTarget } from "./install-target";

const APP = "https://winz-nu.vercel.app/";

describe("installTarget", () => {
  it("makes the QR of a path absolute, against the app's address", () => {
    const target = installTarget("/", APP);
    expect(target.url).toBe("/");
    expect(target.qr?.target).toBe("https://winz-nu.vercel.app/");
    expect(target.qr?.host).toBe("winz-nu.vercel.app");
  });

  it("draws a square code of a size a QR version has, with something dark in it", () => {
    const qr = installTarget("/", APP).qr;
    expect(qr).not.toBeNull();
    // Versions 1 to 40 are 21 + 4 (v - 1) modules wide.
    expect((qr?.size ?? 0) % 4).toBe(1);
    expect(qr?.size).toBeGreaterThanOrEqual(21);
    expect(qr?.path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
  });

  it("keeps an absolute https address as it is", () => {
    expect(installTarget("https://app.example.com/start", APP).qr?.target).toBe(
      "https://app.example.com/start",
    );
  });

  it("has no QR and no link without an address, and never a QR to an unusable one", () => {
    expect(installTarget(null, APP)).toEqual({ url: null, qr: null });
    expect(installTarget("/", null)).toEqual({ url: "/", qr: null });
    expect(installTarget("http://example.com", APP).qr).toBeNull();
    expect(installTarget("#", APP)).toEqual({ url: null, qr: null });
  });
});
