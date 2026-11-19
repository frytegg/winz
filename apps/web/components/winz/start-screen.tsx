"use client";

import { ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Diagonals } from "@/components/ui/diagonals";
import { Logo } from "@/components/ui/logo";
import { useAuth } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const AUTO_ADVANCE_MS = 4000;

/** The three marketing slides, each with the illustration of the mockups. */
const SLIDE_ART = [
  { src: "/onboarding/slide-1.png", width: 356, height: 385 },
  { src: "/onboarding/slide-2.png", width: 238, height: 485 },
  { src: "/onboarding/slide-3.png", width: 238, height: 485 },
] as const;

/** The "winz ▾" pill: the venue's side, with the fan's side (« I'm a fan », C4) one tap away. */
function RoleMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative z-20 flex flex-col items-center gap-2">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${copy.start.roleMenu.label}: ${copy.start.roleMenu.venues}`}
        onClick={() => setOpen((current) => !current)}
        className="flex h-[59px] w-[167px] items-center justify-center gap-3 rounded-full bg-card-raised/90 backdrop-blur-sm transition-transform duration-150 ease-out active:scale-[0.97]"
      >
        <Logo className="h-[26px]" />
        <ChevronDown
          className={cn(
            "size-5 text-lime transition-transform duration-200 ease-out",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <Link
          href="/tickets"
          className="flex h-[52px] w-[167px] animate-screen-in items-center justify-center rounded-full bg-card-raised/90 text-body text-text backdrop-blur-sm transition-transform duration-150 ease-out active:scale-[0.97]"
        >
          {copy.start.roleMenu.fan}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * M0. One horizontal carousel of four panels (the photo, then the three slides of the mockups),
 * with "Start a promo" pinned below all of them: no "Continue" button, so the slides cost no tap.
 * It advances by itself every 4 seconds until the first touch, and never with reduced motion.
 */
export function StartScreen(): React.JSX.Element {
  const router = useRouter();
  const { status, me } = useAuth();
  const reduced = usePrefersReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const total = copy.start.slides.length + 1;

  // Someone already signed in as a merchant has no use for the pitch.
  useEffect(() => {
    if (status === "authenticated" && me?.merchant != null) router.replace("/home");
  }, [status, me, router]);

  const goTo = useCallback((index: number): void => {
    const element = track.current;
    if (element === null) return;
    element.scrollTo({ left: index * element.clientWidth, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!autoplay || reduced) return;
    const timer = setInterval(() => {
      const element = track.current;
      if (element === null) return;
      const index = Math.round(element.scrollLeft / element.clientWidth);
      goTo((index + 1) % total);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [autoplay, reduced, goTo, total]);

  return (
    <div className="relative flex h-dvh min-h-[640px] flex-col overflow-hidden bg-ink">
      <div
        ref={track}
        role="region"
        aria-roledescription="carousel"
        aria-label={copy.start.carouselLabel}
        tabIndex={0}
        onScroll={(event) => {
          const element = event.currentTarget;
          setActive(Math.round(element.scrollLeft / element.clientWidth));
        }}
        onPointerDown={() => setAutoplay(false)}
        onWheel={() => setAutoplay(false)}
        onKeyDown={() => setAutoplay(false)}
        className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {/* Panel 1: the photo, the promise */}
        <section
          role="group"
          aria-roledescription="slide"
          aria-label={copy.start.slideLabel(1, total)}
          className="relative flex w-full shrink-0 snap-center flex-col justify-end"
        >
          <Image
            src="/onboarding/hero.jpg"
            alt={copy.start.heroAlt}
            fill
            priority
            sizes="(min-width: 430px) 430px, 100vw"
            className="object-cover object-[26%_30%]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-ink from-[24%] via-ink/70 via-[42%] to-transparent"
          />
          <div className="absolute inset-x-0 top-0 flex justify-center pt-[calc(var(--safe-top)+2rem)]">
            <RoleMenu />
          </div>
          <div className="relative px-6 pb-[calc(var(--safe-bottom)+10.5rem)] text-center">
            <h1 className="text-hero uppercase">
              {copy.start.title.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mx-auto mt-3 max-w-[22rem] text-body text-muted">{copy.start.subtitle}</p>
          </div>
        </section>

        {/* Panels 2 to 4: the three slides */}
        {copy.start.slides.map((slide, index) => {
          const art = SLIDE_ART[index];
          return (
            <section
              key={slide.title}
              role="group"
              aria-roledescription="slide"
              aria-label={copy.start.slideLabel(index + 2, total)}
              className="relative flex w-full shrink-0 snap-center flex-col"
            >
              <Diagonals />
              <div className="flex flex-1 items-center justify-center pt-[calc(var(--safe-top)+1.5rem)]">
                {art === undefined ? null : (
                  <Image
                    src={art.src}
                    alt=""
                    width={art.width}
                    height={art.height}
                    draggable={false}
                    sizes="360px"
                    className="h-auto max-h-[46dvh] w-auto max-w-[88%] select-none object-contain"
                  />
                )}
              </div>
              <div className="px-6 pb-[calc(var(--safe-bottom)+10.5rem)] pt-6 text-center">
                <h2 className="text-hero uppercase">{slide.title}</h2>
                <p className="mx-auto mt-3 max-w-[20rem] text-body text-muted">{slide.body}</p>
              </div>
            </section>
          );
        })}
      </div>

      {/* Pinned over every panel: the dots and the one button */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-ink from-60% to-transparent px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-10">
        <div className="pointer-events-auto flex">
          {Array.from({ length: total }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label={copy.start.goToSlide(index + 1)}
              aria-current={active === index}
              onClick={() => {
                setAutoplay(false);
                goTo(index);
              }}
              className="grid h-11 w-7 place-items-center"
            >
              <span
                className={cn(
                  "size-2 rounded-full transition-colors duration-200 ease-out",
                  active === index ? "bg-lime" : "bg-subtle",
                )}
              />
            </button>
          ))}
        </div>
        <Button href="/start" className="pointer-events-auto">
          {copy.start.cta}
        </Button>
      </div>
    </div>
  );
}
