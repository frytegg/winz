"use client";

import { useMemo } from "react";

import { QR_GLYPH_PATH, QR_LOGO_RATIO, buildQrMatrix, qrPath } from "@/lib/qr";
import { cn } from "@/lib/utils";

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
        d={QR_GLYPH_PATH}
        className="fill-ink"
        shapeRendering="geometricPrecision"
        transform={`translate(${(start + (logo - glyphWidth) / 2).toString()} ${(start + (logo - 71 * glyphScale) / 2).toString()}) scale(${glyphScale.toString()})`}
      />
    </svg>
  );
}
