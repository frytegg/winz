import { cn } from "@/lib/utils";

/**
 * The progress pill of the merchant journey: one continuous bar from sign-in to review. It grows
 * with `transform` (400ms), not `width`, so it stays smooth.
 */
export function ProgressBar({
  value,
  label,
  className,
}: {
  /** 0 to 1. */
  value: number;
  label: string;
  className?: string;
}): React.JSX.Element {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-card-raised", className)}
    >
      <div
        className="h-full origin-left rounded-full bg-lime transition-transform duration-400 ease-out"
        style={{ transform: `scaleX(${clamped.toString()})` }}
      />
    </div>
  );
}
