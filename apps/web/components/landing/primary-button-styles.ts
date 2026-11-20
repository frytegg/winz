import { cva, type VariantProps } from "class-variance-authority";

/**
 * The landing's primary button (`01-nav-hero.md`): a lime pill, the label in the app's ink, and at
 * the right a black round with a lime arrow inside a thin lime ring. Measured on the mockup, which
 * is 1728 px wide: the pill is 255 x 55, the round 50, the label starts 22 px from the left edge;
 * the nav, hero, demo and CTA buttons are all that size, whatever their label. Below `md` it is 48
 * high.
 *
 * Kept as plain strings (no `cn` merge): the colors are `lime`, `lime-dim`, `ink` of the app's
 * tokens, and nothing here should be reworded by a merge. The label is `ink` on every state: white on
 * lime is 1.2:1, and the app's rule is dark text on lime.
 *
 * Only `transform` and `opacity` move. Under `prefers-reduced-motion` nothing moves at all (the
 * state is still readable: it is the same shape and colour).
 */
export const primaryButton = cva(
  [
    "group/btn relative inline-flex h-12 min-w-56 items-center justify-between gap-6",
    "whitespace-nowrap rounded-full pl-5 pr-[2.5px] text-base font-normal text-ink no-underline",
    "transition-[transform,background-color] duration-150 ease-out",
    "md:h-[55px] md:min-w-[255px] md:pl-[22px] md:text-lg",
  ],
  {
    variants: {
      state: {
        active: "bg-lime active:scale-[0.98] motion-reduce:active:scale-100",
        // The mockups dim the lime, not the label (MASTER, "lime-dim": 4.8:1 with the ink).
        inactive: "cursor-not-allowed bg-lime-dim",
      },
      /**
       * The focus ring is never invisible: lime on a dark section, ink on a light one (a lime ring
       * on the pale-lime CTA would not show). `outline-2` and the offset come from the global rule.
       */
      tone: {
        "on-dark": "focus-visible:outline-lime",
        "on-light": "focus-visible:outline-ink",
      },
    },
    defaultVariants: { state: "active", tone: "on-dark" },
  },
);

export const primaryButtonKnob = cva(
  [
    "grid size-[43px] shrink-0 place-items-center rounded-full bg-ink ring-1 ring-inset",
    "transition-transform duration-200 ease-out md:size-[50px]",
  ],
  {
    variants: {
      state: {
        // On hover the round slides a little to the right (it has 2.5 px of room), the arrow turns.
        active:
          "text-lime ring-lime group-hover/btn:translate-x-0.5 motion-reduce:group-hover/btn:translate-x-0",
        inactive: "text-lime-dim ring-lime-dim",
      },
    },
    defaultVariants: { state: "active" },
  },
);

export const primaryButtonArrow = cva("size-9 transition-transform duration-200 ease-out", {
  variants: {
    state: {
      active: "group-hover/btn:rotate-12 motion-reduce:group-hover/btn:rotate-0",
      inactive: "",
    },
  },
  defaultVariants: { state: "active" },
});

/** The wrapper of an inactive button, so the hint can sit under it and follow its hover and focus. */
export const primaryButtonHintWrap = "group/hint relative inline-flex";

/**
 * "Opening soon", under an inactive button: on hover, on keyboard focus, and (data-shown) for a moment
 * after a tap, since a phone has no hover and does not always focus a tapped button. White on the
 * dark chip token: 13.6:1.
 */
export const primaryButtonHint = [
  "pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap",
  "rounded-full bg-landing-chip px-3 py-1 text-sm text-white opacity-0 transition-opacity duration-150",
  "group-hover/hint:opacity-100 group-focus-within/hint:opacity-100 data-[shown=true]:opacity-100",
].join(" ");

export type PrimaryButtonState = NonNullable<VariantProps<typeof primaryButton>["state"]>;
export type PrimaryButtonTone = NonNullable<VariantProps<typeof primaryButton>["tone"]>;
