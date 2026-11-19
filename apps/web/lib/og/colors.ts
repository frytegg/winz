/**
 * The app's colors, written out for the image renderer, which has no CSS variables. They are the
 * tokens of `globals.css`: --color-ink, --color-lime, --color-text, --color-muted, --color-white-pill.
 */
export const OG_COLORS = {
  ink: "#131314",
  lime: "#D8FE35",
  text: "#FFFFFF",
  muted: "#A1A1AA",
  white: "#FFFFFF",
} as const;

/**
 * The landing's hero, written out for the image renderer. Measured on `hero-bg.png`, the background
 * of the mockup: solid `ink` down to 36% of the height, then a straight line to `end` at the bottom.
 * (The ink is the landing's own `--color-landing-ink`, not the app's `--color-ink`.)
 */
export const OG_LANDING_HERO = {
  ink: "#1C1B20",
  end: "#A3C022",
  /** Where the solid ink stops and the fade to lime starts, as a share of the height. */
  fadeStart: 0.36,
} as const;
