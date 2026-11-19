import { test } from "@playwright/test";

/**
 * The defects this suite found in the screens, each kept as an expectation marked `test.fail` (see
 * knownDefectFromHere): the test passes while the defect is there and turns red the day it is fixed,
 * so the mark can then be removed. The front's files are not this suite's to change. Listed in the
 * receipts' README too.
 */
// Empty since 19 Nov 2026: the three defects the suite found (the fan link's dead end, M8's
// missing poster, C3's chance sentence) are fixed, and their expectations are ordinary ones. The
// type stays wide so that the next defect found is one entry away.
export const KNOWN_DEFECTS: Readonly<Record<string, { readonly reason: string }>> = {};

export type KnownDefect = keyof typeof KNOWN_DEFECTS;

/**
 * Marks the running test as expected to fail from this line on, because of `defect`. A test calls
 * it after asserting everything the defect's observation depends on (the sign-in, the navigation,
 * the screen's heading, the menu that holds the link), right before the expectation that shows the
 * defect. A failure before the call fails the test as usual: only the defect's own expectation is
 * inverted, not the whole test, so a broken sign-in can no longer pass for the known defect.
 */
export function knownDefectFromHere(defect: KnownDefect): void {
  test.fail(true, KNOWN_DEFECTS[defect]?.reason ?? defect);
}
