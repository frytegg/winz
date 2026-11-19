import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ImageResponse } from "next/og";

import { serverLogger } from "@/lib/server/logger";

/**
 * What the generated images (the share preview of a promo, the poster) need from disk. `next/font`
 * cannot serve them: the image renderer wants the raw font files, and it reads TTF, OTF or WOFF only
 * (no WOFF2, no CSS). Sora is the app's own face (SIL OFL 1.1, see design-system/winz/CREDITS.md),
 * in the two weights the images use. The complete files, not the per-script subsets of a web font:
 * the renderer picks one font per word, so a venue called "Łódź Grill" set from a subset falls back
 * to another weight for the whole word.
 *
 * Every path is a literal under `process.cwd()` so that the file tracer ships the files with the
 * serverless function (checked in the build output, see the journal).
 */
type OgFont = NonNullable<
  NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]
>[number];

let cached: Promise<OgFont[] | undefined> | null = null;

async function readFonts(): Promise<OgFont[]> {
  const [regular, semiBold] = await Promise.all([
    readFile(join(process.cwd(), "lib/og/fonts/Sora-Regular.ttf")),
    readFile(join(process.cwd(), "lib/og/fonts/Sora-SemiBold.ttf")),
  ]);
  return [
    { name: "Sora", data: regular, weight: 400, style: "normal" },
    { name: "Sora", data: semiBold, weight: 600, style: "normal" },
  ];
}

/**
 * The fonts, read once per server instance. If they cannot be read the image is still produced, in
 * the renderer's default face: a link preview in the wrong font beats a broken preview. The failure
 * is logged and not remembered, so the next request tries again. It resolves to `undefined`, never
 * to an empty list: the renderer falls back to its own font only when none is given, and throws
 * "No fonts are loaded" on `[]`.
 */
export function loadSoraFonts(): Promise<OgFont[] | undefined> {
  cached ??= readFonts().catch((error: unknown) => {
    cached = null;
    serverLogger("og").error({ err: error }, "the Sora font files could not be read");
    return undefined;
  });
  return cached;
}

/** The lime wordmark, inlined as a data URL: no network at render time. `null` if it cannot be read. */
export async function wordmarkDataUrl(): Promise<string | null> {
  try {
    const svg = await readFile(join(process.cwd(), "public", "brand", "logo-winz-lime.svg"));
    return `data:image/svg+xml;base64,${svg.toString("base64")}`;
  } catch (error: unknown) {
    serverLogger("og").error({ err: error }, "the wordmark could not be read");
    return null;
  }
}
