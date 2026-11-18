import { ArrowUpRight, LoaderCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { arrowCircle, buttonClasses, type ButtonSize, type ButtonVariant } from "./button-styles";

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
  const classes = buttonClasses({ variant, size, arrow, loading, className });
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
