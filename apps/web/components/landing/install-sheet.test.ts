import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { landingCopy } from "@/lib/landing/copy";
import type { InstallQr, SheetKind } from "@/lib/landing/install";

import { InstallSheet, type OpenSheet } from "./install-sheet";

const { install } = landingCopy;

const QR: InstallQr = {
  size: 25,
  path: "M0 0h7v1h-7z",
  target: "https://winz-nu.vercel.app/",
  host: "winz-nu.vercel.app",
};

function open(kind: SheetKind, extra: Partial<OpenSheet> = {}): OpenSheet {
  return {
    kind,
    origin: "demo",
    anchor: { left: 0, right: 100, top: 0, bottom: 50 },
    ipad: false,
    ...extra,
  };
}

/** The text of a markup, as a reader has it: entities decoded. */
function decode(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

function render(
  sheet: OpenSheet | null,
  props: { openUrl?: string | null; qr?: InstallQr | null } = {},
): string {
  return renderToStaticMarkup(
    createElement(InstallSheet, {
      sheet,
      openUrl: props.openUrl === undefined ? "/" : props.openUrl,
      qr: props.qr === undefined ? QR : props.qr,
      onClose: () => undefined,
      onInstall: () => undefined,
    }),
  );
}

describe("InstallSheet, closed", () => {
  it("is an empty, labelled, modal dialog: nothing of it is read before it is opened", () => {
    const html = render(null);
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-kind="closed"');
    expect(html).not.toContain(install.title);
    expect(html).not.toContain(install.openInBrowser);
  });
});

describe("InstallSheet, the header and the way out", () => {
  const kinds: SheetKind[] = [
    "desktop-qr",
    "android-prompt",
    "android-accepted",
    "android-menu",
    "ios",
    "in-app",
  ];

  it.each(kinds)(
    "%s: the title, the subtitle, a close button and 'Open in browser instead'",
    (kind) => {
      const html = decode(render(open(kind)));
      expect(html).toContain(install.title);
      expect(html).toContain(install.subtitle);
      expect(html).toContain(install.close);
      expect(html).toContain(install.openInBrowser);
      expect(html).toMatch(/<h2 id="[^"]+"[^>]*>Get Winz on your phone<\/h2>/);
      // The dialog is named by its title and described by its subtitle.
      const labelled = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
      const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
      expect(html).toContain(`id="${labelled}"`);
      expect(html).toContain(`id="${described}"`);
    },
  );

  it("opens the app in the browser, here on a phone and in a tab on a desktop", () => {
    expect(render(open("ios"))).toMatch(/<a href="\/" [^>]*>Open in browser instead/);
    expect(render(open("ios"))).not.toContain('target="_blank"');
    expect(render(open("desktop-qr"))).toMatch(
      /<a href="\/" target="_blank" rel="noopener noreferrer"/,
    );
  });

  it("has no way out to nowhere while the address is not decided", () => {
    expect(render(open("ios"), { openUrl: null })).not.toContain(install.openInBrowser);
  });

  it("never says a word about wallets, chains or tokens", () => {
    for (const kind of kinds) {
      expect(render(open(kind)).toLowerCase()).not.toMatch(/wallet|crypto|usdc|blockchain|token/);
    }
  });
});

describe("InstallSheet, by platform", () => {
  it("desktop: the QR of the app, what it is for and the host under it", () => {
    const html = render(open("desktop-qr"));
    expect(html).toContain(`aria-label="${install.qrLabel}"`);
    expect(html).toContain('d="M0 0h7v1h-7z"');
    // A 4-module quiet zone around the 25 modules.
    expect(html).toContain('viewBox="-4 -4 33 33"');
    expect(html).toContain(install.desktop);
    expect(html).toContain("winz-nu.vercel.app");
  });

  it("desktop with no QR: the sentence, no broken picture", () => {
    const html = render(open("desktop-qr"), { qr: null });
    expect(html).not.toContain('<svg role="img"');
    expect(html).toContain(install.desktop);
  });

  it("android with the install event: the primary button, and nothing about the menu", () => {
    const html = render(open("android-prompt"));
    expect(html).toContain("<button");
    expect(html).toContain(install.addToHome);
    expect(html).not.toContain(install.androidMenu);
  });

  it("android once accepted: says Winz is on the home screen, as a status", () => {
    const html = render(open("android-accepted"));
    expect(html).toMatch(
      /role="status"[^>]*>.*Winz is on your home screen\. Open it from there\./s,
    );
    expect(html).not.toContain(install.addToHome);
  });

  it("android without the event: the steps of the browser menu", () => {
    const html = render(open("android-menu"));
    expect(html).toContain(
      "Open the browser menu (⋮), then choose Add to Home screen or Install app.",
    );
    expect(html).not.toContain('<button type="button" class="group/btn');
  });

  it("iPhone: three numbered steps with their icons, and the arrow toward the bottom bar", () => {
    const html = render(open("ios"));
    expect(html).toContain("<ol");
    expect(html.match(/<li[ >]/g)).toHaveLength(3);
    const steps = install.iosSteps;
    expect(html.indexOf(steps[0])).toBeLessThan(html.indexOf(steps[1]));
    expect(html.indexOf(steps[1])).toBeLessThan(html.indexOf(steps[2]));
    expect(html).toContain(install.iosArrowIphone);
    expect(html).not.toContain(install.iosArrowIpad);
    expect(html).toContain("install-arrow");
  });

  it("iPad: the arrow and the sentence point at the top of the screen", () => {
    const html = render(open("ios", { ipad: true }));
    expect(html).toContain(install.iosArrowIpad);
    expect(html).not.toContain(install.iosArrowIphone);
  });

  it("an in-app browser: asks for Safari or Chrome, with Copy link and a status line that waits", () => {
    const html = render(open("in-app"));
    expect(html).toContain(install.inApp);
    expect(html).toContain(install.copyLink);
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    // The address is shown in a field one can long-press, in case the clipboard is refused.
    expect(html).toMatch(/<input[^>]*readOnly=""|<input[^>]*readonly=""/);
  });
});

describe("InstallSheet, the dialog and its placement", () => {
  it("marks the panel of a desktop apart from the bottom sheet of a phone, for the stylesheet", () => {
    expect(render(open("desktop-qr"))).toContain('data-kind="desktop-qr"');
    expect(render(open("ios"))).toContain('data-kind="ios"');
  });

  it("has a handle only the bottom sheet shows, and a close button of at least 44 px", () => {
    const html = render(open("ios"));
    expect(html).toContain("install-handle");
    expect(html).toContain("size-11");
  });
});
