import { cva, type VariantProps } from "class-variance-authority";
import { ArrowUpRight, LoaderCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The signature pill (MASTER section 5): a label on the left, a black round arrow on the right.
 * One big lime button per screen. Text is always dark on lime, never white.
 */
const button = cva(
  [
    "group relative inline-flex w-full items-center rounded-full font-normal",
    "transition-[transform,background-color,opacity] duration-150 ease-out",
    "active:scale-[0.98] disabled:pointer-events-none aria-disabled:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-lime text-ink hover:bg-lime-press disabled:bg-lime-dim aria-disabled:bg-lime-dim",
        white: "bg-white-pill text-ink disabled:opacity-50 aria-disabled:opacity-50",
        dark: "bg-card-raised text-text disabled:opacity-50 aria-disabled:opacity-50",
      },
      size: {
        lg: "h-16 pl-6 pr-1.5 text-lead",
        md: "h-12 pl-5 pr-1 text-body",
      },
      centered: {
        true: "justify-center px-5",
        false: "justify-between",
      },
    },
    defaultVariants: { variant: "primary", size: "lg", centered: false },
  },
);

const arrowCircle = cva("grid shrink-0 place-items-center rounded-full bg-ink", {
  variants: {
    variant: {
      primary: "text-lime ring-1 ring-lime",
      white: "text-text",
      dark: "text-lime",
    },
    size: { lg: "size-[52px]", md: "size-10" },
  },
});

type Variant = NonNullable<VariantProps<typeof button>["variant"]>;
type Size = NonNullable<VariantProps<typeof button>["size"]>;

interface ButtonBaseProps {
  variant?: Variant;
  size?: Size;
  /** Show the round arrow on the right. On by default; turn it off for a centered label. */
  arrow?: boolean;
  /** Another icon in the round (the Withdraw button points down-left). */
  icon?: LucideIcon;
  /** Something before the label, in the flow (a card or Apple icon). */
  leading?: ReactNode;
  loading?: boolean;
  className?: string;
  children: ReactNode;
}

export type ButtonProps = ButtonBaseProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof ButtonBaseProps> & { href?: string };

export function Button({
  variant = "primary",
  size = "lg",
  arrow = true,
  icon: Icon = ArrowUpRight,
  leading,
  loading = false,
  className,
  children,
  href,
  disabled,
  type = "button",
  ...rest
}: ButtonProps): React.JSX.Element {
  const inactive = disabled === true || loading;
  const classes = cn(button({ variant, size, centered: !arrow }), className);
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-2.5 truncate">
        {leading}
        <span className="truncate">{children}</span>
      </span>
      {arrow ? (
        <span className={arrowCircle({ variant, size })} aria-hidden="true">
          {loading ? (
            <LoaderCircle className="size-5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Icon className="size-5" strokeWidth={1.5} />
          )}
        </span>
      ) : null}
    </>
  );

  if (href !== undefined && !inactive) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={inactive}
      aria-busy={loading || undefined}
    >
      {content}
    </button>
  );
}
