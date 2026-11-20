"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * What the section does on scroll (`sections/05-process.md`, and the reference recording it comes from,
 * measured frame by frame). The markup is the server's; this component only reads where the visitor is and
 * writes it back as `data-*` attributes, which `process.css` turns into motion. No React state: a change of
 * step re-renders nothing.
 *
 * Three modes, decided by the screen and by what the visitor asked for:
 *
 *   stage    from 1024 px: one card, sticky, and the step text scrolling past it. The step that is "on" is the
 *            block that crosses a line ~55 % down the screen (the middle between two titles, in both
 *            directions, as the reference does). When it changes, the card's screen empties and rebuilds
 *            (`data-state` of each screen: active, leaving, idle).
 *   cards    under 1024 px: each step is its own card, the picture above its text. A card comes in when it
 *            scrolls into view, and its screen moves while it is at least half in view.
 *   static   prefers-reduced-motion: nothing here runs. `process.css` shows every step stacked with the end
 *            state of its screen.
 *
 * One IntersectionObserver per mode, and nothing listens to `scroll`. Before this runs, and in a browser that
 * never runs it, the page is the static one: nothing is hidden on the strength of a script that might not come.
 */

const DESKTOP = "(min-width: 1024px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

/** The line that decides the step, as a share of the window's height from the top (measured: 55 to 60). */
const LINE = 55;

/** How long the screen that is being left takes to fade (`--p-out` in `process.css`), when it cannot be read. */
const OUT_FALLBACK_MS = 450;

/** A card counts as seen when this much of the window's height of it is in. */
const SEEN_MARGIN = "0px 0px -10% 0px";

function indexOf(element: Element): number {
  return Number((element as HTMLElement).dataset.index ?? 0);
}

function outMs(root: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--p-out"));
  return Number.isFinite(value) ? value : OUT_FALLBACK_MS;
}

/** The stage: one sticky card, six screens, the step that is on in `data-state`. Returns its undo. */
function stageMode(root: HTMLElement): () => void {
  const screens = [
    ...root.querySelectorAll<HTMLElement>("[data-process-stage] [data-process-screen]"),
  ];
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-process-block]")];
  if (screens.length === 0 || blocks.length === 0) return () => undefined;

  // The bar of the stage's phone advances with the step: each block carries the share it stands for.
  const card = root.querySelector<HTMLElement>("[data-process-stage] [data-process-card]");
  const crossing = new Set<number>();
  let active = 0;
  let leaving = -1;
  let live = false;
  let moved = false;
  let timer: number | undefined;

  const paint = (): void => {
    root.dataset.mode = "stage";
    root.dataset.moved = String(moved);
    root.dataset.active = String(active);
    const fill = blocks[active]?.dataset.fill;
    if (card !== null && fill !== undefined) card.style.setProperty("--fill", fill);
    screens.forEach((screen, index) => {
      const state = index === active ? "active" : index === leaving ? "leaving" : "idle";
      screen.dataset.state = state;
      // The picture of a step moves while it is on, and while the visitor is in the section. The one that is
      // being left holds its frame while it fades (a frozen picture, not one that snaps to its end state).
      if (state === "active") screen.dataset.anim = live ? "run" : "hold";
      else if (state === "leaving") screen.dataset.anim = "hold";
      else delete screen.dataset.anim;
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = indexOf(entry.target);
        if (entry.isIntersecting) crossing.add(index);
        else crossing.delete(index);
      }
      // Two blocks touch the line at the exact moment it passes between them: the later one wins, both ways.
      const next = crossing.size > 0 ? Math.max(...crossing) : active;
      live = crossing.size > 0;
      if (next !== active) {
        leaving = active;
        active = next;
        moved = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          leaving = -1;
          paint();
        }, outMs(root));
      }
      paint();
    },
    // A band of no height at LINE % of the window: the top edge is cut down to it, the bottom edge up to it.
    { rootMargin: `-${LINE}% 0px -${100 - LINE}% 0px` },
  );
  blocks.forEach((block) => observer.observe(block));
  paint();

  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
    delete root.dataset.mode;
    delete root.dataset.moved;
    delete root.dataset.active;
    card?.style.removeProperty("--fill");
    screens.forEach((screen) => {
      delete screen.dataset.state;
      delete screen.dataset.anim;
    });
  };
}

/** The cards: each step comes in as it scrolls into view, its picture moves while half of it is in. */
function cardsMode(root: HTMLElement): () => void {
  const steps = [...root.querySelectorAll<HTMLElement>("[data-process-step]")];
  if (steps.length === 0) return () => undefined;

  const screenOf = (step: HTMLElement): HTMLElement | null =>
    step.querySelector<HTMLElement>("[data-process-art] [data-process-screen]");

  root.dataset.mode = "cards";
  for (const step of steps) {
    // Hidden only if it is entirely below the first screen: nothing the visitor can already see goes away.
    const below = step.getBoundingClientRect().top >= window.innerHeight;
    step.dataset.reveal = below ? "armed" : "in";
    const screen = screenOf(step);
    if (screen !== null) screen.dataset.anim = "hold";
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (target.matches("[data-process-step]")) {
          if (entry.isIntersecting) target.dataset.reveal = "in";
        } else {
          const screen = target.querySelector<HTMLElement>("[data-process-screen]");
          if (screen !== null)
            screen.dataset.anim = entry.intersectionRatio >= 0.5 ? "run" : "hold";
        }
      }
    },
    { rootMargin: SEEN_MARGIN, threshold: [0, 0.5] },
  );
  steps.forEach((step) => {
    observer.observe(step);
    const art = step.querySelector("[data-process-art]");
    if (art !== null) observer.observe(art);
  });

  return () => {
    observer.disconnect();
    delete root.dataset.mode;
    for (const step of steps) {
      delete step.dataset.reveal;
      const screen = screenOf(step);
      if (screen !== null) delete screen.dataset.anim;
    }
  };
}

export function ProcessScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (root === null || typeof IntersectionObserver === "undefined") return;

    const desktop = window.matchMedia(DESKTOP);
    const reduced = window.matchMedia(REDUCED);
    let undo: () => void = () => undefined;

    // The mode follows the window and the visitor's setting: turned the phone, or asked for less motion.
    const apply = (): void => {
      undo();
      undo = reduced.matches
        ? () => undefined
        : desktop.matches
          ? stageMode(root)
          : cardsMode(root);
    };
    apply();
    desktop.addEventListener("change", apply);
    reduced.addEventListener("change", apply);
    return () => {
      desktop.removeEventListener("change", apply);
      reduced.removeEventListener("change", apply);
      undo();
    };
  }, []);

  return (
    <div ref={ref} data-process className={className}>
      {children}
    </div>
  );
}
