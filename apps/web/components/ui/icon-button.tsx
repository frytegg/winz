import { cva, type VariantProps } from "class-variance-authority";
import { ChevronLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/** A round 48px button with one icon (back, share, close). Always labelled for screen readers. */
const iconButton = cva(
  [
    "inline-grid size-12 shrink-0 place-items-center rounded-full",
    "transition-[transform,background-color] duration-150 ease-out active:scale-[0.96]",
  ],
  {
    variants: {
      tone: {
        outline: "border border-lime text-lime",
        lime: "bg-lime text-ink hover:bg-lime-press",
        white: "bg-white-pill text-ink",
        card: "bg-card-raised text-text",
      },
    },
    defaultVariants: { tone: "outline" },
  },
);

interface IconButtonProps extends VariantProps<typeof iconButton> {
  icon: LucideIcon;
  /** What the button does, for assistive technology. */
  label: string;
  href?: string;
  className?: string;
}

export function IconButton({
  icon: Icon,
  label,
  tone,
  href,
  className,
  ...rest
}: IconButtonProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof IconButtonProps>): React.JSX.Element {
  const classes = cn(iconButton({ tone }), className);
  const icon = <Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />;
  if (href !== undefined) {
    return (
      <Link href={href} aria-label={label} className={classes}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} className={classes} {...rest}>
      {icon}
    </button>
  );
}

/** The round lime-outlined chevron at the top left of every wizard screen. */
export function BackButton({
  onClick,
  href,
  className,
}: {
  onClick?: () => void;
  href?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <IconButton
      icon={ChevronLeft}
      label={copy.common.back}
      tone="outline"
      onClick={onClick}
      href={href}
      className={className}
    />
  );
}
