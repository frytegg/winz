import { test } from "@playwright/test";

/**
 * The defects this suite found in the screens, each kept as an expectation marked `test.fail` (see
 * knownDefectFromHere): the test passes while the defect is there and turns red the day it is fixed,
 * so the mark can then be removed. The front's files are not this suite's to change. Listed in the
 * receipts' README too.
 */
export const KNOWN_DEFECTS = {
  fanLinkDeadEnd: {
    reason:
      "M0's fan link (« winz ▾ » → /TICKETS) opens /tickets, which has no page: 404 " +
      "(components/winz/start-screen.tsx:69; no app/**/tickets/page.tsx, C4 « My tickets » is U-09). " +
      "The link reads « winz /TICKETS » (start-screen.tsx:75), not SPEC M0's « I'm a fan »",
  },
  ticketChanceWording: {
    reason:
      "C3 before the game shows « 14% · CHANCE IT'S FREE », not SPEC 5.4's « 14 % chance this is free »: " +
      "that sentence (copy.ticket.chanceTitle) is only the gauge's aria-label (components/ui/gauge.tsx:26, " +
      "visible text gauge.tsx:67)",
  },
  posterDownload: {
    reason:
      "M8 has no « Download poster » (SPEC M8 « Télécharger l'affiche (PNG) »; copy.live.downloadPoster " +
      "is unused): only « Download QR » (components/winz/live-screen.tsx:291). The poster is ◇ in U-08",
  },
} as const satisfies Record<string, { reason: string }>;

export type KnownDefect = keyof typeof KNOWN_DEFECTS;

/**
 * Marks the running test as expected to fail from this line on, because of `defect`. A test calls
 * it after asserting everything the defect's observation depends on (the sign-in, the navigation,
 * the screen's heading, the menu that holds the link), right before the expectation that shows the
 * defect. A failure before the call fails the test as usual: only the defect's own expectation is
 * inverted, not the whole test, so a broken sign-in can no longer pass for the known defect.
 */
export function knownDefectFromHere(defect: KnownDefect): void {
  test.fail(true, KNOWN_DEFECTS[defect].reason);
}
