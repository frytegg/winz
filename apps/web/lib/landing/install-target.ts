import { buildQrMatrix, qrPath } from "@/lib/qr";

import type { InstallQr, InstallTarget } from "./install";
import { hostOf, qrTarget } from "./qr-target";
import { linkOrNull } from "./links";

/**
 * Where the app is for one family of buttons, and the QR that leads a phone there. Built on the server, once,
 * from the module matrix (`lib/qr.ts`): the page ships a path, not a QR library.
 *
 * `url` is what "Open in browser instead" opens (a usable link, or `null`); the QR encodes the same address
 * made absolute against `appUrl`, or is `null` when there is none (a QR must never lead to a domain that is
 * not ours, and a relative path would lead nowhere from a phone).
 */
export function installTarget(url: string | null, appUrl: string | null): InstallTarget {
  const target = qrTarget(url, appUrl);
  let qr: InstallQr | null = null;
  if (target !== null) {
    const matrix = buildQrMatrix(target);
    qr = { size: matrix.size, path: qrPath(matrix), target, host: hostOf(target) ?? target };
  }
  return { url: linkOrNull(url), qr };
}
