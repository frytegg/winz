/**
 * What "Try the live demo" and "Add to Home Screen" do, per visitor (`sections/09-install-flow.md`).
 * Pure, with no `@/` import and no DOM: the page reads the browser once and hands the facts in, so every
 * rule here is tested without one.
 *
 * What the platforms allow, and the whole design follows from it:
 *  - no browser installs a web app by itself, there is always a gesture;
 *  - Android (Chrome, Edge, Samsung Internet) fires `beforeinstallprompt`, which can be kept and replayed
 *    on a tap: the closest thing to automatic;
 *  - iPhone and iPad have no such event: all a page can do is explain the Share menu;
 *  - the browser inside Instagram, TikTok, Facebook and the like cannot install anything;
 *  - an app that is already installed has nothing to be offered.
 */

export type Platform =
  /** Already running as an installed app (`display-mode: standalone`, or `navigator.standalone` on iOS). */
  | "standalone"
  /** A browser inside another app (Instagram, TikTok, Facebook, LinkedIn ...): no installation exists there. */
  | "in-app"
  | "ios"
  | "android"
  | "desktop";

/** What is read from the browser, once, to tell the platforms apart. */
export interface BrowserFacts {
  readonly userAgent: string;
  /** `navigator.platform`: an iPad in desktop mode says "MacIntel". */
  readonly platform: string;
  readonly maxTouchPoints: number;
  /** `display-mode: standalone` or `navigator.standalone`. */
  readonly standalone: boolean;
}

/**
 * The tokens an app's own browser puts in its user agent. Facebook's `FBAN`/`FBAV`/`FB_IAB` also cover
 * Messenger; `Bytedance` and `musical_ly` are TikTok's; `; wv)` is any Android WebView.
 */
const IN_APP =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|TikTok|musical_ly|Bytedance|LinkedInApp|Snapchat|Pinterest|Twitter|\bLine\/|MicroMessenger|; wv\)/i;

function isIos(facts: BrowserFacts): boolean {
  if (/iPhone|iPad|iPod/.test(facts.userAgent)) return true;
  return facts.platform === "MacIntel" && facts.maxTouchPoints > 1;
}

export function detectPlatform(facts: BrowserFacts): Platform {
  if (facts.standalone) return "standalone";
  if (IN_APP.test(facts.userAgent)) return "in-app";
  if (isIos(facts)) {
    // Safari, Chrome, Firefox and Edge on iOS all carry `Safari/`; the web view of an app that is not in
    // the list above does not.
    return /Safari\//.test(facts.userAgent) ? "ios" : "in-app";
  }
  if (/Android/.test(facts.userAgent)) return "android";
  return "desktop";
}

/** An iPad puts the Share button at the top of the screen, an iPhone at the bottom. */
export function isIpad(facts: BrowserFacts): boolean {
  return (
    /iPad/.test(facts.userAgent) || (facts.platform === "MacIntel" && facts.maxTouchPoints > 1)
  );
}

/** What the sheet shows. `desktop-qr` is the small panel; the others are the phone's bottom sheet. */
export type SheetKind =
  "desktop-qr" | "android-prompt" | "android-accepted" | "android-menu" | "ios" | "in-app";

/** The sheet of a platform, or `null` where there is nothing to offer (an app that is already installed). */
export function sheetKindFor(platform: Platform, canPrompt: boolean): SheetKind | null {
  switch (platform) {
    case "standalone":
      return null;
    case "desktop":
      return "desktop-qr";
    case "android":
      return canPrompt ? "android-prompt" : "android-menu";
    case "ios":
      return "ios";
    case "in-app":
      return "in-app";
  }
}

export type ClickOutcome =
  /** Let the link do what it does: open the app (a new tab on a desktop). */
  | { readonly action: "follow" }
  /** Open the app in this tab, on purpose: the installed app has no use for a second window. */
  | { readonly action: "open-app" }
  | { readonly action: "sheet"; readonly kind: SheetKind };

/**
 * A tap on "Try the live demo". `platform` is `null` until the page has read the browser (and for ever
 * without a script): the link then simply goes where it points.
 *
 * A visitor who closed or refused the sheet during this session gets the app, not the sheet again: the
 * button is a way in first, and the sheet an offer.
 */
export function demoClickOutcome(input: {
  platform: Platform | null;
  canPrompt: boolean;
  dismissedThisSession: boolean;
}): ClickOutcome {
  const { platform } = input;
  if (platform === null || platform === "desktop") return { action: "follow" };
  if (platform === "standalone") return { action: "open-app" };
  if (input.dismissedThisSession) return { action: "follow" };
  const kind = sheetKindFor(platform, input.canPrompt);
  return kind === null ? { action: "follow" } : { action: "sheet", kind };
}

/**
 * A tap on the footer's "Add to Home Screen". The visitor asked for the sheet by name, so a past dismissal
 * does not count; on a desktop it is the QR straight away (there is nothing to open in a new tab: the
 * point is the phone).
 */
export function footerClickOutcome(input: {
  platform: Platform | null;
  canPrompt: boolean;
}): ClickOutcome {
  const { platform } = input;
  if (platform === null) return { action: "follow" };
  if (platform === "standalone") return { action: "open-app" };
  const kind = sheetKindFor(platform, input.canPrompt);
  return kind === null ? { action: "follow" } : { action: "sheet", kind };
}

/**
 * Whether the sheet was closed or refused during this session, kept in `sessionStorage` and, where that is
 * not allowed (a private window of an older Safari, a blocked store, an in-app browser), in memory: the
 * answer is then per page load, which is the best a page can do.
 */
export interface SessionFlag {
  get(): boolean;
  set(): void;
}

export function createSessionFlag(
  key: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): SessionFlag {
  let inMemory = false;
  return {
    get(): boolean {
      if (inMemory) return true;
      try {
        return storage?.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    set(): void {
      inMemory = true;
      try {
        storage?.setItem(key, "1");
      } catch {
        // Kept in memory above.
      }
    },
  };
}

/** The panel's position: its top-left corner, in the window's coordinates. */
export interface PanelPosition {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the desktop panel goes: under the button, its right edge on the button's right edge when that keeps
 * it in the window, flipped above the button when there is no room below, and always at least `margin` from
 * every edge. (A panel taller than the window sits at the top margin: the window scrolls it.)
 */
export function anchorPanel(input: {
  anchor: { left: number; right: number; top: number; bottom: number };
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
  margin?: number;
}): PanelPosition {
  const { anchor, panel, viewport } = input;
  const gap = input.gap ?? 12;
  const margin = input.margin ?? 16;

  const maxLeft = Math.max(margin, viewport.width - panel.width - margin);
  const centred = anchor.left + (anchor.right - anchor.left) / 2 - panel.width / 2;
  const left = Math.min(Math.max(centred, margin), maxLeft);

  const below = anchor.bottom + gap;
  const fitsBelow = below + panel.height <= viewport.height - margin;
  const above = anchor.top - gap - panel.height;
  const top = fitsBelow ? below : Math.max(margin, above);
  return { left: Math.round(left), top: Math.round(top) };
}
