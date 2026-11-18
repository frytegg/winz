import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The signature pill (MASTER section 5): a label on the left, a black round arrow on the right.
 * One big lime button per screen. The label is `ink` (#131314) on every lime or white surface,
 * never white: that is a rule of the mockups and the only way to read it (white on lime is 1.2:1).
 *
 * Disabled keeps the label readable: the mockups dim the LIME (`lime-dim`), not the text.
 * Loading does not look disabled: the button stays full color and shows a spinner.
 */
export const button = cva(
  [
    "group relative inline-flex w-full items-center rounded-full font-normal",
    "transition-[transform,background-color,color] duration-150 ease-out",
    "active:scale-[0.98] disabled:pointer-events-none aria-disabled:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: "bg-lime text-ink hover:bg-lime-press",
        white: "bg-white-pill text-ink",
        dark: "bg-card-raised text-text",
      },
      size: {
        lg: "h-16 pl-6 pr-1.5 text-lead",
        md: "h-12 pl-5 pr-1 text-body",
      },
      centered: {
        true: "justify-center px-5",
        false: "justify-between",
      },
      /** `idle` shows the disabled look when disabled; `loading` keeps the full color. */
      state: {
        idle: "",
        loading: "",
      },
    },
    compoundVariants: [
      {
        variant: "primary",
        state: "idle",
        class: "disabled:bg-lime-dim disabled:text-ink aria-disabled:bg-lime-dim",
      },
      {
        variant: "white",
        state: "idle",
        class:
          "disabled:bg-card-raised disabled:text-muted aria-disabled:bg-card-raised aria-disabled:text-muted",
      },
      {
        variant: "dark",
        state: "idle",
        class:
          "disabled:bg-card disabled:text-muted aria-disabled:bg-card aria-disabled:text-muted",
      },
    ],
    defaultVariants: { variant: "primary", size: "lg", centered: false, state: "idle" },
  },
);

export const arrowCircle = cva("grid shrink-0 place-items-center rounded-full bg-ink", {
  variants: {
    variant: {
      primary: "text-lime ring-1 ring-inset ring-lime",
      white: "text-text",
      dark: "text-lime",
    },
    size: { lg: "size-[52px]", md: "size-10" },
  },
});

export type ButtonVariant = NonNullable<VariantProps<typeof button>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof button>["size"]>;

/** The classes of a pill, as the component applies them (conflicts resolved by `cn`). */
export function buttonClasses({
  variant = "primary",
  size = "lg",
  arrow = true,
  loading = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: boolean;
  loading?: boolean;
  className?: string;
}): string {
  return cn(
    button({ variant, size, centered: !arrow, state: loading ? "loading" : "idle" }),
    className,
  );
}
