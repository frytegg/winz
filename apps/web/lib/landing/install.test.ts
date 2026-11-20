import { describe, expect, it } from "vitest";

import {
  anchorPanel,
  createSessionFlag,
  demoClickOutcome,
  detectPlatform,
  footerClickOutcome,
  isIpad,
  sheetKindFor,
  type BrowserFacts,
  type Platform,
} from "./install";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.14.82 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 570933190)",
  iphoneTikTok:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_35.1.0 BytedanceWebview/d8a21c6",
  // A web view that names nobody: an iPhone, no `Safari/`.
  iphoneBareWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ in its default mode: the user agent of a Mac.
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]",
  androidLinkedIn:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 LinkedInApp",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
} as const;

function facts(partial: Partial<BrowserFacts> & { userAgent: string }): BrowserFacts {
  return { platform: "", maxTouchPoints: 0, standalone: false, ...partial };
}

describe("detectPlatform", () => {
  it("tells an iPhone in Safari, in Chrome and in an iPad apart from a desktop", () => {
    expect(detectPlatform(facts({ userAgent: UA.iphoneSafari, platform: "iPhone" }))).toBe("ios");
    expect(detectPlatform(facts({ userAgent: UA.iphoneChrome, platform: "iPhone" }))).toBe("ios");
    expect(detectPlatform(facts({ userAgent: UA.ipadSafari, platform: "iPad" }))).toBe("ios");
  });

  it("takes an iPad that says it is a Mac for an iPad, and a real Mac for a desktop", () => {
    expect(
      detectPlatform(facts({ userAgent: UA.ipadAsMac, platform: "MacIntel", maxTouchPoints: 5 })),
    ).toBe("ios");
    expect(
      detectPlatform(facts({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 })),
    ).toBe("desktop");
  });

  it("reads Android and desktop", () => {
    expect(detectPlatform(facts({ userAgent: UA.androidChrome, platform: "Linux armv8l" }))).toBe(
      "android",
    );
    expect(detectPlatform(facts({ userAgent: UA.windowsChrome, platform: "Win32" }))).toBe(
      "desktop",
    );
  });

  it("calls the browser of another app an in-app browser, on both systems", () => {
    for (const userAgent of [
      UA.iphoneInstagram,
      UA.iphoneTikTok,
      UA.androidFacebook,
      UA.androidLinkedIn,
      UA.androidWebView,
    ]) {
      expect(detectPlatform(facts({ userAgent }))).toBe("in-app");
    }
  });

  it("takes an iPhone web view with no Safari token for an in-app browser", () => {
    expect(detectPlatform(facts({ userAgent: UA.iphoneBareWebView, platform: "iPhone" }))).toBe(
      "in-app",
    );
  });

  it("puts an installed app first, whatever it runs on", () => {
    for (const userAgent of [
      UA.iphoneSafari,
      UA.androidChrome,
      UA.windowsChrome,
      UA.iphoneInstagram,
    ]) {
      expect(detectPlatform(facts({ userAgent, standalone: true }))).toBe("standalone");
    }
  });
});

describe("isIpad", () => {
  it("is true for an iPad and an iPad that says it is a Mac, false for an iPhone and a Mac", () => {
    expect(isIpad(facts({ userAgent: UA.ipadSafari }))).toBe(true);
    expect(
      isIpad(facts({ userAgent: UA.ipadAsMac, platform: "MacIntel", maxTouchPoints: 5 })),
    ).toBe(true);
    expect(isIpad(facts({ userAgent: UA.iphoneSafari }))).toBe(false);
    expect(isIpad(facts({ userAgent: UA.macSafari, platform: "MacIntel" }))).toBe(false);
  });
});

describe("sheetKindFor", () => {
  it("is the table of 09-install-flow.md", () => {
    expect(sheetKindFor("desktop", false)).toBe("desktop-qr");
    expect(sheetKindFor("android", true)).toBe("android-prompt");
    expect(sheetKindFor("android", false)).toBe("android-menu");
    expect(sheetKindFor("ios", false)).toBe("ios");
    expect(sheetKindFor("in-app", true)).toBe("in-app");
  });

  it("offers nothing to an app that is already installed", () => {
    expect(sheetKindFor("standalone", true)).toBeNull();
  });

  it("does not let a prompt change what iOS and an in-app browser get", () => {
    expect(sheetKindFor("ios", true)).toBe("ios");
    expect(sheetKindFor("in-app", true)).toBe("in-app");
  });
});

describe("demoClickOutcome", () => {
  const base = { canPrompt: false, dismissedThisSession: false };

  it("follows the link before the page has read the browser, and on a desktop", () => {
    expect(demoClickOutcome({ ...base, platform: null })).toEqual({ action: "follow" });
    expect(demoClickOutcome({ ...base, platform: "desktop" })).toEqual({ action: "follow" });
  });

  it("opens the app, here, when it is installed", () => {
    expect(demoClickOutcome({ ...base, platform: "standalone" })).toEqual({ action: "open-app" });
  });

  it("opens the right sheet on a phone", () => {
    const outcomes = (
      [
        ["android", true, "android-prompt"],
        ["android", false, "android-menu"],
        ["ios", false, "ios"],
        ["in-app", false, "in-app"],
      ] as const
    ).map(([platform, canPrompt, kind]) => [
      demoClickOutcome({ ...base, platform, canPrompt }),
      { action: "sheet", kind },
    ]);
    for (const [got, want] of outcomes) expect(got).toEqual(want);
  });

  it("goes to the app, not to the sheet again, after the sheet was closed or refused", () => {
    for (const platform of ["android", "ios", "in-app"] as const) {
      expect(demoClickOutcome({ platform, canPrompt: true, dismissedThisSession: true })).toEqual({
        action: "follow",
      });
    }
  });

  it("still opens the installed app when the sheet was dismissed", () => {
    expect(
      demoClickOutcome({ platform: "standalone", canPrompt: false, dismissedThisSession: true }),
    ).toEqual({ action: "open-app" });
  });
});

describe("footerClickOutcome", () => {
  it("shows the QR on a desktop, where the demo button opens a tab", () => {
    expect(footerClickOutcome({ platform: "desktop", canPrompt: false })).toEqual({
      action: "sheet",
      kind: "desktop-qr",
    });
  });

  it("shows the sheet of the platform on a phone", () => {
    expect(footerClickOutcome({ platform: "ios", canPrompt: false })).toEqual({
      action: "sheet",
      kind: "ios",
    });
    expect(footerClickOutcome({ platform: "android", canPrompt: true })).toEqual({
      action: "sheet",
      kind: "android-prompt",
    });
  });

  it("follows the link before the browser is read, and opens the installed app", () => {
    expect(footerClickOutcome({ platform: null, canPrompt: false })).toEqual({ action: "follow" });
    expect(footerClickOutcome({ platform: "standalone", canPrompt: false })).toEqual({
      action: "open-app",
    });
  });

  it("is a different outcome for every platform that can be asked for", () => {
    const kinds = (["desktop", "android", "ios", "in-app"] as Platform[]).map((platform) =>
      footerClickOutcome({ platform, canPrompt: false }),
    );
    expect(new Set(kinds.map((outcome) => JSON.stringify(outcome))).size).toBe(4);
  });
});

describe("createSessionFlag", () => {
  function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  }

  it("starts unset, and stays set once set", () => {
    const flag = createSessionFlag("k", memoryStorage());
    expect(flag.get()).toBe(false);
    flag.set();
    expect(flag.get()).toBe(true);
  });

  it("is shared by what shares the storage, as a reload is", () => {
    const storage = memoryStorage();
    createSessionFlag("k", storage).set();
    expect(createSessionFlag("k", storage).get()).toBe(true);
    expect(createSessionFlag("other", storage).get()).toBe(false);
  });

  it("falls back to memory when the storage throws, on read and on write", () => {
    const blocked: Pick<Storage, "getItem" | "setItem"> = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const flag = createSessionFlag("k", blocked);
    expect(flag.get()).toBe(false);
    flag.set();
    expect(flag.get()).toBe(true);
  });

  it("works with no storage at all", () => {
    const flag = createSessionFlag("k", null);
    expect(flag.get()).toBe(false);
    flag.set();
    expect(flag.get()).toBe(true);
  });
});

describe("anchorPanel", () => {
  const panel = { width: 320, height: 380 };
  const viewport = { width: 1440, height: 900 };

  it("puts the panel under the button, centred on it", () => {
    const position = anchorPanel({
      anchor: { left: 600, right: 860, top: 400, bottom: 455 },
      panel,
      viewport,
    });
    expect(position).toEqual({ left: 600 + 130 - 160, top: 455 + 12, scrollBy: 0 });
  });

  it("flips above the button when there is no room below it", () => {
    const position = anchorPanel({
      anchor: { left: 600, right: 860, top: 780, bottom: 835 },
      panel,
      viewport,
    });
    expect(position.top).toBe(780 - 12 - 380);
  });

  it("keeps the panel inside the window on both sides", () => {
    const left = anchorPanel({
      anchor: { left: 0, right: 100, top: 100, bottom: 150 },
      panel,
      viewport,
    });
    expect(left.left).toBe(16);
    const right = anchorPanel({
      anchor: { left: 1340, right: 1440, top: 100, bottom: 150 },
      panel,
      viewport,
    });
    expect(right.left).toBe(1440 - 320 - 16);
  });

  it("does not scroll the page when it flips above the button", () => {
    const position = anchorPanel({
      anchor: { left: 600, right: 860, top: 780, bottom: 835 },
      panel,
      viewport,
      scrollRoom: 5000,
    });
    expect(position.scrollBy).toBe(0);
  });

  // The hero's button is in the middle of a 900 px window and the panel is half as tall as the window:
  // below it there is no room, above it neither. It must not land on the button.
  it("scrolls the page up by what is missing, when neither side has room", () => {
    const tall = { width: 320, height: 498 };
    const position = anchorPanel({
      anchor: { left: 868, right: 1046, top: 459, bottom: 503 },
      panel: tall,
      viewport,
      scrollRoom: 8000,
    });
    // Below the button: 503 + 12 + 498 = 1013, 129 more than the 884 the window allows.
    expect(position.scrollBy).toBe(129);
    // The button moved up by what the page scrolled; the panel is under it, at its new place.
    expect(position.top).toBe(503 + 12 - 129);
    expect(position.top).toBeGreaterThanOrEqual(503 - 129);
    expect(position.top + tall.height).toBeLessThanOrEqual(900 - 16);
  });

  it("goes beside the button when the page cannot scroll far enough, never over it", () => {
    // The footer's button: near the end of the page, no room above it, and no page left to scroll.
    const tall = { width: 320, height: 482 };
    const anchor = { left: 1002, right: 1251, top: 418, bottom: 466 };
    const position = anchorPanel({ anchor, panel: tall, viewport, scrollRoom: 0 });
    expect(position.scrollBy).toBe(0);
    // To the right it would leave the window (1251 + 12 + 320 > 1424): to the left, 12 px from the button.
    expect(position.left).toBe(1002 - 12 - 320);
    expect(position.left + tall.width).toBeLessThanOrEqual(anchor.left);
    // Centred on the button, inside the window.
    expect(position.top).toBe(Math.round(418 + 24 - 241));
    expect(position.top + tall.height).toBeLessThanOrEqual(900 - 16);
  });

  it("goes to the right of the button when there is room there", () => {
    const tall = { width: 320, height: 482 };
    const anchor = { left: 100, right: 349, top: 418, bottom: 466 };
    const position = anchorPanel({ anchor, panel: tall, viewport, scrollRoom: 0 });
    expect(position.left).toBe(349 + 12);
    expect(position.scrollBy).toBe(0);
  });

  it("scrolls by what the page has when that is all it takes, and not when it is not", () => {
    const tall = { width: 320, height: 498 };
    const anchor = { left: 868, right: 1046, top: 459, bottom: 503 };
    expect(anchorPanel({ anchor, panel: tall, viewport, scrollRoom: 129 }).scrollBy).toBe(129);
    // 40 px of page is not enough: the panel goes beside the button instead of half under it.
    expect(anchorPanel({ anchor, panel: tall, viewport, scrollRoom: 40 })).toMatchObject({
      scrollBy: 0,
      left: 1046 + 12,
    });
  });

  it("never scrolls the button off the top of the window", () => {
    const position = anchorPanel({
      anchor: { left: 868, right: 1046, top: 60, bottom: 104 },
      panel: { width: 320, height: 880 },
      viewport,
      scrollRoom: 8000,
    });
    expect(60 - position.scrollBy).toBeGreaterThanOrEqual(16);
  });

  it("goes beside the button, at the top margin, in a window too short for above or below", () => {
    const position = anchorPanel({
      anchor: { left: 600, right: 860, top: 100, bottom: 155 },
      panel,
      viewport: { width: 1440, height: 400 },
    });
    expect(position.top).toBe(16);
    expect(position.left).toBe(860 + 12);
    expect(position.scrollBy).toBe(0);
  });

  it("covers the button only when there is no room beside it either, in a window too small for anything", () => {
    const position = anchorPanel({
      anchor: { left: 20, right: 380, top: 100, bottom: 155 },
      panel: { width: 320, height: 380 },
      viewport: { width: 400, height: 400 },
    });
    expect(position.top).toBe(16);
    expect(position.scrollBy).toBe(0);
  });
});
