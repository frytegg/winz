import { cn } from "@/lib/utils";

/** A loading placeholder in the shape of what is coming (never a bare spinner on content). */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-skeleton rounded-card-sm bg-card-raised", className)}
    />
  );
}
