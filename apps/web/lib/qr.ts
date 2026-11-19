import QRCode from "qrcode";

/**
 * The QR code of a promo link, drawn by us from the module matrix (no HTML injection, crisp at
 * any size). Error correction is "H" (30%): that is what lets the Winz mark sit over the middle
 * without making the code unreadable.
 */
export interface QrMatrix {
  size: number;
  /** One boolean per module, row by row. */
  modules: boolean[];
}

export function buildQrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  return { size: qr.modules.size, modules: Array.from(qr.modules.data, (bit) => bit === 1) };
}

/** An SVG path covering every dark module, one 1×1 square each. */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let start = -1;
    for (let column = 0; column <= matrix.size; column += 1) {
      const dark = column < matrix.size && matrix.modules[row * matrix.size + column] === true;
      if (dark && start === -1) start = column;
      if (!dark && start !== -1) {
        parts.push(
          `M${start.toString()} ${row.toString()}h${(column - start).toString()}v1h-${(column - start).toString()}z`,
        );
        start = -1;
      }
    }
  }
  return parts.join("");
}

/** The Winz glyph (87 × 71) as one path, for the middle of the code: on screen and in the PNG. */
export const QR_GLYPH_PATH =
  "M30.0636 71L39.2173 22.0663H55.2364L65.8548 71H54.5041L43.6112 22.4356H50.1103L40.3158 71H30.0636ZM26.5852 71L26.4936 58.7204H36.5628L36.6543 71H26.5852ZM19.9944 71L0 0H13.0768L33.4505 71H19.9944ZM58.2572 71L58.3487 58.7204H68.4179V71H58.2572ZM62.3764 71L73.544 20.4044H87L74.917 71H62.3764Z";

/** The side of the Winz mark over the middle, as a share of the code. 22% stays well inside H. */
export const QR_LOGO_RATIO = 0.22;
const QUIET_ZONE_MODULES = 2;

/** A PNG of the code with the Winz mark in the middle, for "Download QR". */
export async function renderQrPng(text: string, pixels = 1024): Promise<Blob> {
  const matrix = buildQrMatrix(text);
  const total = matrix.size + QUIET_ZONE_MODULES * 2;
  const unit = Math.floor(pixels / total);
  const side = unit * total;
  // A canvas cannot read the CSS tokens: these are --color-white-pill, --color-ink and --color-lime.
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Canvas is not available");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, side, side);
  context.fillStyle = "#131314";
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.modules[row * matrix.size + column] === true) {
        context.fillRect(
          (column + QUIET_ZONE_MODULES) * unit,
          (row + QUIET_ZONE_MODULES) * unit,
          unit,
          unit,
        );
      }
    }
  }

  const logo = Math.round(side * QR_LOGO_RATIO);
  const x = Math.round((side - logo) / 2);
  const radius = Math.round(logo * 0.24);
  context.fillStyle = "#d8fe35";
  context.beginPath();
  context.roundRect(x, x, logo, logo, radius);
  context.fill();
  // Drawn from the path, not loaded as an image: no network, so "Download QR" works at a counter
  // with a bad signal, and nothing can finish after the picture is taken.
  const glyphWidth = logo * 0.62;
  const glyphScale = glyphWidth / 87;
  context.save();
  context.translate(x + (logo - glyphWidth) / 2, x + (logo - 71 * glyphScale) / 2);
  context.scale(glyphScale, glyphScale);
  context.fillStyle = "#131314";
  context.fill(new Path2D(QR_GLYPH_PATH));
  context.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("Could not encode the QR code"));
      else resolve(blob);
    }, "image/png");
  });
}
