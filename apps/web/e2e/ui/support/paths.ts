import { fileURLToPath } from "node:url";

/** `apps/web`. */
export const WEB_DIR = fileURLToPath(new URL("../../../", import.meta.url));

/** Where the screenshots and their README go, overwritten at each run. */
export const RECEIPTS_DIR = fileURLToPath(
  new URL("../../../../../docs/receipts/ui/", import.meta.url),
);

/** Each measurement of this run, one JSON file per key (git-ignored, under `test-results/`). */
export const MEASURES_DIR = fileURLToPath(
  new URL("../../../test-results/ui-measures/", import.meta.url),
);
