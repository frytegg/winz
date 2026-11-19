import { OG_COLORS } from "@/lib/og/colors";
import { QR_GLYPH_PATH, QR_LOGO_RATIO, buildQrMatrix, qrPath } from "@/lib/qr";

/** Four modules of white around the code: what the QR standard asks for, and what a printer needs. */
const QUIET_ZONE = 4;

/**
 * The promo's QR code for the poster, as an SVG the image renderer draws. The side is a whole number
 * of pixels per module (never a fraction), so every square has a hard edge: a code that is soft at
 * the edges scans worse once printed. Error correction is "H", which is what lets the Winz mark sit
 * over the middle.
 */
export function PosterQr({ value, target }: { value: string; target: number }): React.JSX.Element {
  const matrix = buildQrMatrix(value);
  const total = matrix.size + QUIET_ZONE * 2;
  const side = Math.max(1, Math.floor(target / total)) * total;
  const logo = matrix.size * QR_LOGO_RATIO;
  const start = QUIET_ZONE + (matrix.size - logo) / 2;
  const glyphWidth = logo * 0.62;
  const glyphScale = glyphWidth / 87;

  return (
    <svg width={side} height={side} viewBox={`0 0 ${total} ${total}`}>
      <rect width={total} height={total} fill={OG_COLORS.white} />
      <g transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`}>
        <path d={qrPath(matrix)} fill={OG_COLORS.ink} />
      </g>
      <rect x={start} y={start} width={logo} height={logo} rx={logo * 0.24} fill={OG_COLORS.lime} />
      <path
        d={QR_GLYPH_PATH}
        fill={OG_COLORS.ink}
        transform={`translate(${start + (logo - glyphWidth) / 2} ${start + (logo - 71 * glyphScale) / 2}) scale(${glyphScale})`}
      />
    </svg>
  );
}
