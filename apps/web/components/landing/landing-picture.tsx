import { preload } from "react-dom";

type Format = "avif" | "webp";

/**
 * The `srcset` of an image exported at `widths` (`/landing/hero/hero-illustration` stands for
 * `/landing/hero/hero-illustration-1033.avif`, and so on): one candidate per export, each with its own
 * real width. The browser then picks the narrowest file that is sharp at the size it shows the image.
 */
export function exportedSrcSet(base: string, widths: readonly number[], format: Format): string {
  return widths.map((width) => `${base}-${width}.${format} ${width}w`).join(", ");
}

export interface LandingPictureProps {
  /** The exported files, without the width and the extension. */
  base: string;
  /** The widths that were exported (the real pixel widths of the files), in ascending order. */
  widths: readonly number[];
  /** The pixel size of the widest export: the browser reserves the box from its ratio, before the file lands. */
  width: number;
  height: number;
  /** `alt=""` for a decoration. */
  alt: string;
  /** The width the image is shown at, as the `sizes` attribute says it. */
  sizes: string;
  /** The image of the first screen: loaded first, and announced in the head. */
  priority?: boolean;
  className?: string;
}

/**
 * An image the page exports itself, in AVIF with a WebP fallback, at a few widths
 * (`winz-front-kit/landing/tools/build-assets.mjs`). Not `next/image`: its ladder of sizes (384, 640,
 * 750, 828, 1080 ...) cannot say "three files, 860, 1033 and 2066 px wide", and would send the 72 KB
 * file where a 1728 px screen needs the 37 KB one; it would also run a second compression over
 * files that are already compressed. What it adds (a reserved box, `fetchpriority`, lazy loading,
 * the preload) is written here instead.
 */
export function LandingPicture({
  base,
  widths,
  width,
  height,
  alt,
  sizes,
  priority = false,
  className,
}: LandingPictureProps): React.JSX.Element {
  const avif = exportedSrcSet(base, widths, "avif");
  const webp = exportedSrcSet(base, widths, "webp");
  const widest = widths[widths.length - 1] ?? width;

  if (priority) {
    // Announce the file in the head, with the same candidates: the image is the page's LCP.
    preload(`${base}-${widest}.avif`, {
      as: "image",
      type: "image/avif",
      fetchPriority: "high",
      imageSrcSet: avif,
      imageSizes: sizes,
    });
  }

  return (
    <picture>
      <source type="image/avif" srcSet={avif} sizes={sizes} />
      <source type="image/webp" srcSet={webp} sizes={sizes} />
      {/* The fallback is the widest WebP, for a browser that reads neither source. */}
      <img
        src={`${base}-${widest}.webp`}
        alt={alt}
        width={width}
        height={height}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        className={className}
      />
    </picture>
  );
}
