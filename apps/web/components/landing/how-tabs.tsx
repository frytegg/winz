"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type HowTabId = "merchant" | "fan";

const ORDER: readonly HowTabId[] = ["merchant", "fan"];

/**
 * The Merchant / Fan control and its two panels (`sections/03-how.md`), the WAI-ARIA tabs pattern:
 * a `tablist` of two `tab`s, one `tabpanel` each, the selected tab alone in the tab order (the arrows,
 * Home and End move between them, and select as they go: a panel costs nothing to show).
 *
 * Both panels are always in the page, stacked in one grid cell, so the section is as tall as the taller
 * of the two and does not jump when the tab changes; the one that is not selected is `visibility:
 * hidden` (out of the accessibility tree, the tab order and the pointer's reach). The panels arrive
 * already rendered, by the server: this component only holds which one is on.
 *
 * The sliding pill is three layers moved by `transform` only (`landing.css`, `.how-pill-*`), driven by
 * `data-tab`; the buttons have fixed widths so that nothing has to be measured, and the page is right
 * before any script has run.
 */
export function HowTabs({
  label,
  labels,
  panels,
}: {
  /** The name of the tab list for a screen reader. */
  label: string;
  labels: Record<HowTabId, string>;
  panels: Record<HowTabId, ReactNode>;
}): React.JSX.Element {
  const [active, setActive] = useState<HowTabId>("merchant");
  const base = useId();
  const tabRefs = useRef<Partial<Record<HowTabId, HTMLButtonElement | null>>>({});

  const tabId = (id: HowTabId): string => `${base}-tab-${id}`;
  const panelId = (id: HowTabId): string => `${base}-panel-${id}`;

  function select(id: HowTabId, focus: boolean): void {
    setActive(id);
    if (focus) tabRefs.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const at = ORDER.indexOf(active);
    let next: HowTabId | undefined;
    if (event.key === "ArrowRight") next = ORDER[(at + 1) % ORDER.length];
    else if (event.key === "ArrowLeft") next = ORDER[(at + ORDER.length - 1) % ORDER.length];
    else if (event.key === "Home") next = ORDER[0];
    else if (event.key === "End") next = ORDER[ORDER.length - 1];
    if (next === undefined) return;
    event.preventDefault();
    select(next, true);
  }

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        data-tab={active}
        onKeyDown={onKeyDown}
        className="how-tabs relative mt-[calc(48*var(--u))] flex h-[46px] w-[234px] shrink-0 items-center rounded-full bg-landing-track p-[3px] max-lg:mt-8"
      >
        <span aria-hidden="true" className="how-pill how-pill-left" />
        <span aria-hidden="true" className="how-pill how-pill-mid" />
        <span aria-hidden="true" className="how-pill how-pill-right" />
        {ORDER.map((id) => (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={active === id}
            aria-controls={panelId(id)}
            tabIndex={active === id ? 0 : -1}
            onClick={() => {
              select(id, false);
            }}
            className={cn(
              // A hit area of the track's height (46): the pill is 40, the track's padding is 3 on each side.
              "relative z-10 h-10 cursor-pointer rounded-full text-base leading-none text-ink outline-none before:absolute before:-inset-y-[3px] before:inset-x-0 before:content-['']",
              "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-white",
              id === "merchant" ? "w-[142px]" : "w-[86px]",
            )}
          >
            {labels[id]}
          </button>
        ))}
      </div>

      <div className="mt-[calc(38*var(--u))] grid w-full justify-items-center max-lg:mt-8">
        {ORDER.map((id) => (
          <div
            key={id}
            role="tabpanel"
            id={panelId(id)}
            aria-labelledby={tabId(id)}
            tabIndex={active === id ? 0 : -1}
            data-active={active === id}
            className="how-panel rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-8 focus-visible:ring-offset-white"
          >
            {panels[id]}
          </div>
        ))}
      </div>
    </>
  );
}
