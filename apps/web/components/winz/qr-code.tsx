"use client";

import { useMemo } from "react";

import { QR_LOGO_RATIO, buildQrMatrix, qrPath } from "@/lib/qr";
import { cn } from "@/lib/utils";

/** The mark of the Winz glyph (87 × 71), as one path, for the middle of the code. */
const GLYPH_PATH =
  "M30.0636 71L39.2173 22.0663H55.2364L65.8548 71H54.5041L43.6112 22.4356H50.1103L40.3158 71H30.0636ZM26.5852 71L26.4936 58.7204H36.5628L36.6543 71H26.5852ZM19.9944 71L0 0H13.0768L33.4505 71H19.9944ZM58.2572 71L58.3487 58.7204H68.4179V71H58.2572ZM62.3764 71L73.544 20.4044H87L74.917 71H62.3764Z";
const QUIET_ZONE = 2;

/**
 * A scannable QR code on a white tile (dark modules on white, whatever the theme: scanners need
 * the contrast), with the Winz mark over the middle.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}): React.JSX.Element {
  const matrix = useMemo(() => buildQrMatrix(value), [value]);
  const path = useMemo(() => qrPath(matrix), [matrix]);
  const total = matrix.size + QUIET_ZONE * 2;
  const logo = matrix.size * QR_LOGO_RATIO;
  const start = QUIET_ZONE + (matrix.size - logo) / 2;
  const glyphWidth = logo * 0.62;
  const glyphScale = glyphWidth / 87;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total.toString()} ${total.toString()}`}
      shapeRendering="crispEdges"
      className={cn("block aspect-square w-full rounded-2xl bg-white-pill", className)}
    >
      <g transform={`translate(${QUIET_ZONE.toString()} ${QUIET_ZONE.toString()})`}>
        <path d={path} className="fill-ink" />
      </g>
      <rect
        x={start}
        y={start}
        width={logo}
        height={logo}
        rx={logo * 0.24}
        className="fill-lime"
        shapeRendering="geometricPrecision"
      />
      <path
        d={GLYPH_PATH}
        className="fill-ink"
        shapeRendering="geometricPrecision"
        transform={`translate(${(start + (logo - glyphWidth) / 2).toString()} ${(start + (logo - 71 * glyphScale) / 2).toString()}) scale(${glyphScale.toString()})`}
      />
    </svg>
  );
}
