"use client";

import type { Sport, Team } from "@winz/shared";

import { copy } from "@/lib/copy";
import { formatShortDate, formatTime, bpsToWholePercent } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";
import { pickTeamArt } from "@/lib/team-art";
import { cn } from "@/lib/utils";

import { TeamBadge, TeamDot } from "./team-badge";

interface MatchCardProps {
  sport: Sport;
  /** Shown on the left, as in the game title ("Arkansas vs Texas"). */
  away: Team;
  /** Shown on the right. */
  home: Team;
  startsAt: string;
  /** Chance each team wins, in basis points, when a moneyline model exists. */
  awayChanceBps?: number | null;
  homeChanceBps?: number | null;
  selected?: boolean;
  disabled?: boolean;
  /** Why it cannot be picked ("Odds not open yet"). */
  disabledLabel?: string;
  onSelect?: () => void;
  className?: string;
}

function Side({
  team,
  art,
  side,
  chanceBps,
}: {
  team: Team;
  art: string | null;
  side: "a" | "b";
  chanceBps: number | null | undefined;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <TeamBadge abbreviation={team.abbreviation} src={team.logoUrl ?? art} side={side} size={72} />
      <span className="line-clamp-2 min-h-11 w-full break-words text-body">{team.name}</span>
      <span className="flex items-center gap-1.5 text-label opacity-70">
        {team.abbreviation}
        {chanceBps === null || chanceBps === undefined ? null : (
          <span className="figures flex items-center gap-1 font-semibold opacity-100">
            <TeamDot side={side} />
            {bpsToWholePercent(chanceBps).toString()}%
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * A game in the picker (M3): the two teams, the start time, a round VS. Tapping it turns it lime
 * (180ms); the screen then moves on by itself.
 */
export function MatchCard({
  sport,
  away,
  home,
  startsAt,
  awayChanceBps,
  homeChanceBps,
  selected = false,
  disabled = false,
  disabledLabel,
  onSelect,
  className,
}: MatchCardProps): React.JSX.Element {
  const hydrated = useHydrated();
  const art = pickTeamArt(sport, away.abbreviation, home.abbreviation);
  const [clock = "--:--", meridiem = ""] = (hydrated ? formatTime(startsAt) : "--:--").split(" ");

  const content = (
    <>
      <div className={cn("flex items-start gap-2", disabled && "opacity-40")}>
        <Side team={away} art={art?.away ?? null} side="a" chanceBps={awayChanceBps} />
        <div className="flex w-[96px] shrink-0 flex-col items-center gap-1 pt-1">
          <span className="figures text-clock">
            {clock}
            <span className="ml-1 text-label font-normal">{meridiem}</span>
          </span>
          <span className={cn("text-label", selected ? "text-ink/70" : "text-muted")}>
            {hydrated ? formatShortDate(startsAt) : "--"}
          </span>
          <span
            className={cn(
              "mt-2 grid size-11 place-items-center rounded-full text-label font-semibold",
              "transition-colors duration-150 ease-out",
              selected ? "bg-white-pill text-ink" : "bg-lime text-ink",
            )}
          >
            {copy.pickGame.vs}
          </span>
        </div>
        <Side team={home} art={art?.home ?? null} side="b" chanceBps={homeChanceBps} />
      </div>
      {disabled && disabledLabel !== undefined ? (
        <p className="mt-3 text-center text-label text-muted">{disabledLabel}</p>
      ) : null}
    </>
  );

  const classes = cn(
    "block w-full rounded-card-sm p-5 text-left",
    "transition-[transform,background-color,color,opacity] duration-180 ease-out",
    selected ? "scale-[1.01] bg-lime text-ink" : "bg-card-raised text-text",
    className,
  );

  if (onSelect === undefined || disabled) {
    return (
      <div className={classes} aria-disabled={disabled || undefined}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(classes, "active:scale-[0.985]")}
    >
      {content}
    </button>
  );
}
