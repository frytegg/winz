import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The wordmark is always the SVG, never text: the dotless "ı" and the "w" are drawn
 * (MASTER section 3).
 */
export function Logo({
  variant = "wordmark",
  className,
}: {
  variant?: "wordmark" | "glyph";
  className?: string;
}): React.JSX.Element {
  if (variant === "glyph") {
    return (
      <img
        src="/brand/icon-winz-lime.svg"
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
      src="/brand/logo-winz-lime.svg"
      alt={copy.brand.name}
      width={83}
      height={26}
      className={cn("h-6 w-auto", className)}
      draggable={false}
    />
  );
}
