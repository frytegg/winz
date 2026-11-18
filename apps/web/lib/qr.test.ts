import { describe, expect, it } from "vitest";

import { buildQrMatrix, qrPath } from "./qr";

describe("the QR matrix", () => {
  it("is square and has the three finder patterns", () => {
    const matrix = buildQrMatrix("https://example.test/c/joes-texas");
    expect(matrix.modules).toHaveLength(matrix.size * matrix.size);
    const at = (row: number, column: number): boolean =>
      matrix.modules[row * matrix.size + column] === true;
    for (const [row, column] of [
      [0, 0],
      [0, matrix.size - 7],
      [matrix.size - 7, 0],
    ] as const) {
      expect(at(row, column)).toBe(true);
      expect(at(row + 3, column + 3)).toBe(true);
      expect(at(row + 1, column + 1)).toBe(false);
    }
  });

  it("draws every dark module once in its path", () => {
    const matrix = buildQrMatrix("https://example.test/c/joes-texas");
    const path = qrPath(matrix);
    const dark = matrix.modules.filter(Boolean).length;
    const covered = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, hit) => sum + Number(hit[1]), 0);
    expect(covered).toBe(dark);
  });
});
