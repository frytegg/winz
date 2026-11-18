import type { EventSummary } from "@winz/shared";
import { CalendarDays, Clock } from "lucide-react";

import { copy } from "@/lib/copy";
import { pickTeamArt } from "@/lib/team-art";

import { LocalTime } from "../ui/local-time";

import { TeamBadge } from "./team-badge";

/** The game, on one line: the two teams, "Arkansas vs Texas", the time and the date (M4, M7). */
export function MatchSummary({ event }: { event: EventSummary }): React.JSX.Element {
  const art = pickTeamArt(event.sport, event.away.abbreviation, event.home.abbreviation);
  return (
    <div className="flex items-center gap-3 rounded-card-sm bg-card-raised px-4 py-3">
      <div className="flex shrink-0 items-center">
        <TeamBadge
          abbreviation={event.away.abbreviation}
          src={event.away.logoUrl ?? art?.away ?? null}
          side="a"
          size={40}
        />
        <span
          aria-hidden="true"
          className="z-10 -mx-1.5 grid size-6 place-items-center rounded-full bg-lime text-micro font-semibold text-ink"
        >
          {copy.pickGame.vs}
        </span>
        <TeamBadge
          abbreviation={event.home.abbreviation}
          src={event.home.logoUrl ?? art?.home ?? null}
          side="b"
          size={40}
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-body">{event.title}</p>
        <p className="mt-0.5 flex items-center gap-3 text-caption text-muted">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            <LocalTime iso={event.startsAt} style="time" />
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            <LocalTime iso={event.startsAt} style="date" />
          </span>
        </p>
      </div>
    </div>
  );
}
