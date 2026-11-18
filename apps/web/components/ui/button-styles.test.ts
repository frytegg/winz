import { describe, expect, it } from "vitest";

import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-styles";

const VARIANTS: ButtonVariant[] = ["primary", "white", "dark"];
const SIZES: ButtonSize[] = ["lg", "md"];
const SIZE_TOKEN: Record<ButtonSize, string> = { lg: "text-lead", md: "text-body" };

/** The text color a variant must keep: dark on lime and white, white on the dark pill. */
const LABEL: Record<ButtonVariant, string> = {
  primary: "text-ink",
  white: "text-ink",
  dark: "text-text",
};

describe("buttonClasses", () => {
  for (const variant of VARIANTS) {
    for (const size of SIZES) {
      for (const loading of [false, true]) {
        for (const arrow of [true, false]) {
          const name = `${variant} ${size} ${loading ? "loading" : "idle"} ${arrow ? "with arrow" : "centered"}`;
          it(`keeps the label color AND the size token: ${name}`, () => {
            const classes = buttonClasses({ variant, size, arrow, loading }).split(" ");
            // Regression: tailwind-merge used to drop the color when a size token followed it.
            expect(classes).toContain(LABEL[variant]);
            expect(classes).toContain(SIZE_TOKEN[size]);
          });
        }
      }
    }
  }

  it("never makes the label white on a lime or white surface", () => {
    for (const variant of ["primary", "white"] as const) {
      const classes = buttonClasses({ variant }).split(" ");
      expect(classes).not.toContain("text-text");
      expect(classes).not.toContain("text-white");
    }
  });

  it("dims the lime, not the label, when a primary pill is disabled", () => {
    const classes = buttonClasses({ variant: "primary" }).split(" ");
    expect(classes).toContain("disabled:bg-lime-dim");
    expect(classes).toContain("disabled:text-ink");
  });

  it("does not use the disabled look while loading", () => {
    const classes = buttonClasses({ variant: "primary", loading: true }).split(" ");
    expect(classes).not.toContain("disabled:bg-lime-dim");
  });

  it("keeps a disabled white or dark pill readable with a muted label on a flat surface", () => {
    expect(buttonClasses({ variant: "white" })).toContain("disabled:text-muted");
    expect(buttonClasses({ variant: "dark" })).toContain("disabled:text-muted");
    expect(buttonClasses({ variant: "white" })).not.toMatch(/opacity/);
  });
});
