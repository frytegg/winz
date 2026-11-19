"use client";

import { SPORTS, type EventSummary, type Sport } from "@winz/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChipRow } from "@/components/ui/chip-row";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { SPORT_ICONS } from "@/components/ui/sport-icons";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchCard } from "@/components/winz/match-card";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { useAsync } from "@/lib/api/use-async";
import { copy } from "@/lib/copy";
import { startGroup, type StartGroup } from "@/lib/format";
import { journeyProgress } from "@/lib/journey";

import { useWizardNav } from "./use-wizard-nav";
import { useWizard } from "./wizard-context";
import { WizardFrame } from "./wizard-frame";

/** How long the chosen card stays lime before the screen moves on (the 180ms colour change + a beat). */
const ADVANCE_DELAY_MS = 260;
const SEARCH_DEBOUNCE_MS = 250;
const GROUP_ORDER: readonly StartGroup[] = ["tonight", "weekend", "later"];

function allTemplatesClosed(event: EventSummary): boolean {
  return event.templates.every((template) => !template.available);
}

/** M3: pick a game. Tapping a card turns it lime, then the wizard moves on by itself. */
export function StepGame(): React.JSX.Element {
  const nav = useWizardNav("game");
  const { draft, update } = useWizard();
  const [search, setSearch] = useState("");
  const [sport, setSport] = useState<Sport | "all">("all");
  const [picked, setPicked] = useState<string | null>(draft.event?.ticker ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = search.trim();
  const events = useAsync(
    (signal) => apiFetch("events", { query: query === "" ? undefined : { search: query }, signal }),
    [query],
    { debounceMs: query === "" ? 0 : SEARCH_DEBOUNCE_MS },
  );

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const all = events.data?.events;
  const sportsPresent = useMemo(
    () => SPORTS.filter((value) => all?.some((event) => event.sport === value) ?? false),
    [all],
  );
  const groups = useMemo(() => {
    const now = new Date();
    const shown = (all ?? [])
      .filter((event) => sport === "all" || event.sport === sport)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return GROUP_ORDER.map((group) => ({
      group,
      events: shown.filter((event) => startGroup(event.startsAt, now) === group),
    })).filter((entry) => entry.events.length > 0);
  }, [all, sport]);

  function select(event: EventSummary): void {
    if (timer.current !== null) return;
    setPicked(event.ticker);
    // A different game starts the promo choice over; the same one keeps it.
    update({
      event,
      templateId: draft.event?.ticker === event.ticker ? draft.templateId : null,
    });
    timer.current = setTimeout(() => {
      timer.current = null;
      nav.forward("promo");
    }, ADVANCE_DELAY_MS);
  }

  return (
    <WizardFrame
      stepKey="game"
      progress={journeyProgress("game")}
      stepNumber={copy.wizard.stepNumber.game}
      title={copy.wizard.steps.game}
      subtitle={copy.pickGame.body}
      onBack={nav.back}
    >
      <SearchField
        label={copy.pickGame.searchPlaceholder}
        placeholder={copy.pickGame.searchPlaceholder}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {sportsPresent.length > 1 ? (
        <ChipRow label={copy.pickGame.sportsLabel} className="-mt-2">
          <Chip
            label={copy.pickGame.allSports}
            active={sport === "all"}
            onClick={() => setSport("all")}
          />
          {sportsPresent.map((value) => (
            <Chip
              key={value}
              label={copy.sports[value]}
              icon={SPORT_ICONS[value]}
              active={sport === value}
              onClick={() => setSport(value)}
            />
          ))}
        </ChipRow>
      ) : null}

      {events.data === null && events.error === null ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={copy.common.loading}>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[188px]" />
          ))}
        </div>
      ) : events.error !== null && events.data === null ? (
        <EmptyState
          title={errorMessage(events.error, copy.common.genericError)}
          action={
            <Button variant="dark" size="md" arrow={false} onClick={events.reload}>
              {copy.common.tryAgain}
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState title={query === "" ? copy.pickGame.empty : copy.pickGame.noMatch} />
      ) : (
        <div className="flex flex-col gap-6" aria-live="polite">
          {groups.map(({ group, events: inGroup }) => (
            <section key={group} className="flex flex-col gap-4">
              <h2 className="text-label uppercase text-muted">{copy.pickGame.groups[group]}</h2>
              {inGroup.map((event) => {
                const closed = allTemplatesClosed(event);
                return (
                  <MatchCard
                    key={event.ticker}
                    sport={event.sport}
                    away={event.away}
                    home={event.home}
                    startsAt={event.startsAt}
                    awayChanceBps={event.away.winProbabilityBps}
                    homeChanceBps={event.home.winProbabilityBps}
                    selected={picked === event.ticker}
                    disabled={closed}
                    disabledLabel={copy.pickGame.oddsNotOpen}
                    onSelect={() => select(event)}
                  />
                );
              })}
            </section>
          ))}
        </div>
      )}
    </WizardFrame>
  );
}
