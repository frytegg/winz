import { cn } from "@/lib/utils";

/**
 * The thin lime diagonals of the brand pattern (MASTER section 4): like field lines, behind hero
 * cards, the splash and success screens. Decorative, never interactive.
 */
export function Diagonals({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cn("pointer-events-none absolute inset-0 size-full text-lime-line", className)}
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      vectorEffect="non-scaling-stroke"
    >
      <path d="M92 0 L58 240" vectorEffect="non-scaling-stroke" />
      <path d="M164 0 L118 240" vectorEffect="non-scaling-stroke" />
      <path d="M232 0 L196 240" vectorEffect="non-scaling-stroke" />
      <path d="M318 0 L262 240" vectorEffect="non-scaling-stroke" />
      <path d="M404 20 L330 240" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
