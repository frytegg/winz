import { cn } from "@/lib/utils";

interface TeamBadgeProps {
  abbreviation: string;
  /** Art picked by `pickTeamArt`, or the team's own `logoUrl`. `null` draws a monogram. */
  src: string | null;
  /** `a` is the amber team, `b` the green one (MASTER section 2). */
  side?: "a" | "b";
  /** Edge in pixels. */
  size?: number;
  className?: string;
}

/**
 * A team's picture: the sport illustration, or a round monogram of its abbreviation. Decorative:
 * the name is always written next to it.
 */
export function TeamBadge({
  abbreviation,
  src,
  side = "a",
  size = 72,
  className,
}: TeamBadgeProps): React.JSX.Element {
  if (src !== null) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn("shrink-0 object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        side === "a" ? "bg-team-a text-ink" : "bg-team-b text-text",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.3) }}
    >
      {abbreviation.slice(0, 3).toUpperCase()}
    </span>
  );
}

/** A small colored dot beside a team's chance (MatchCard). */
export function TeamDot({ side }: { side: "a" | "b" }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1.5 rounded-full", side === "a" ? "bg-team-a" : "bg-team-b")}
    />
  );
}
