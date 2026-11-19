import { describe, expect, it } from "vitest";

import { expressPayOf } from "./express-pay";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";

describe("expressPayOf: which express payment C1's main button names", () => {
  it("names Apple Pay on Apple's phones and tablets, whatever the browser", () => {
    expect(expressPayOf(IPHONE)).toBe("apple");
    expect(expressPayOf(IPHONE_CHROME)).toBe("apple");
    expect(expressPayOf(MAC_SAFARI, "MacIntel", 5)).toBe("apple");
  });

  it("names Google Pay on Android, never Apple Pay", () => {
    expect(expressPayOf(PIXEL, "Linux armv8l", 5)).toBe("google");
  });

  it("names Safari's Apple Pay and Chrome's Google Pay on a computer, and neither in Firefox", () => {
    expect(expressPayOf(MAC_SAFARI, "MacIntel", 0)).toBe("apple");
    expect(expressPayOf(MAC_CHROME, "MacIntel", 0)).toBe("google");
    expect(expressPayOf(FIREFOX, "Win32", 0)).toBeNull();
  });
});
