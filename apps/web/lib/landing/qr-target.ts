/**
 * What the QR code of the Process section's step 04 encodes: the live demo's address, made absolute (a code is
 * scanned away from this site, so a path would lead nowhere), or `null` when there is no live demo to send
 * anyone to. `null` is drawn as a pattern that cannot be read (`decorativeQr`), never a code to a domain that
 * is not ours.
 *
 * Pure, with no `@/` import: it is tested outside Next.
 */
export function qrTarget(liveDemoUrl: string | null, appUrl: string | null): string | null {
  if (liveDemoUrl === null) return null;
  const link = liveDemoUrl.trim();
  if (/^https:\/\/[^\s/]/.test(link)) return link;
  if (!link.startsWith("/") || link.startsWith("//") || appUrl === null) return null;
  try {
    const base = new URL(appUrl);
    return base.protocol === "https:" ? new URL(link, base).href : null;
  } catch {
    return null;
  }
}

/** The host of an address, for the chip that shows the link ("winz-nu.vercel.app"). */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Modules that look like a QR code and are not one: noise from a fixed seed, with the three finder squares
 * left out (no reader locks onto it), so that nothing can be scanned from the page by mistake.
 */
export function decorativeQr(size = 25): { size: number; modules: boolean[] } {
  let seed = 0x2f6e2b1;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const modules: boolean[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const corner = (row < 9 || row >= size - 8) && (column < 9 || column >= size - 8);
      const farCorner = row >= size - 8 && column >= size - 8;
      modules.push(corner && !farCorner ? false : next() % 100 < 46);
    }
  }
  return { size, modules };
}
