import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The wordmark is always the SVG, never text: the dotless "ı" and the "w" are drawn
 * (MASTER section 3).
 */
export function Logo({
  variant = "wordmark",
  tone = "lime",
  className,
}: {
  variant?: "wordmark" | "glyph";
  /** `dark` is the ink one, for a lime screen (REFUNDED). */
  tone?: "lime" | "dark";
  className?: string;
}): React.JSX.Element {
  if (variant === "glyph") {
    return (
      <img
        src={`/brand/icon-winz-${tone}.svg`}
        alt={copy.brand.name}
        width={87}
        height={71}
        className={cn("h-8 w-auto", className)}
        draggable={false}
      />
    );
  }
  return (
    <img
      src={`/brand/logo-winz-${tone}.svg`}
      alt={copy.brand.name}
      width={83}
      height={26}
      className={cn("h-6 w-auto", className)}
      draggable={false}
    />
  );
}
