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

/** The side of the Winz mark over the middle, as a share of the code. 22% stays well inside H. */
export const QR_LOGO_RATIO = 0.22;
const QUIET_ZONE_MODULES = 2;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${src}`));
    image.src = src;
  });
}

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
  const glyph = await loadImage("/brand/icon-winz-dark.svg");
  const glyphWidth = Math.round(logo * 0.62);
  const glyphHeight = Math.round((glyphWidth * 71) / 87);
  context.drawImage(
    glyph,
    x + Math.round((logo - glyphWidth) / 2),
    x + Math.round((logo - glyphHeight) / 2),
    glyphWidth,
    glyphHeight,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("Could not encode the QR code"));
      else resolve(blob);
    }, "image/png");
  });
}
