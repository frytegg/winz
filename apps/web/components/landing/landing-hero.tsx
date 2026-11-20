import { landingCopy } from "@/lib/landing/copy";

import { LandingPicture } from "./landing-picture";
import { TryDemoButton } from "./try-demo-button";

const { hero, heroTitle } = landingCopy;

/**
 * The hero (`sections/01-nav-hero.md`, mockup `hero/winz-hero.png`, 1728 px wide).
 *
 * Every size is written in the mockup's pixels and scaled by `--u` (set by the page: one mockup pixel
 * at the width of the page, `cqw`, which excludes a scrollbar as `vw` does not, and no more than 1:1
 * above 1728 px). So at 1728 px the page is the mockup, and below it the same page at a smaller scale;
 * `max()` floors keep the text readable. Under 1024 px the type and the spacing are the tablet's and
 * the phone's own, and the hero is as tall as its content.
 *
 * The navigation is not in here: it is a banner of its own that sits over the top of this section.
 */
export function LandingHero({
  liveDemoUrl,
}: {
  /** `landingLinks.liveDemoUrl`: `null` makes the button inactive, never a dead link. */
  liveDemoUrl: string | null;
}): React.JSX.Element {
  return (
    <section aria-labelledby="hero-title">
      <div className="relative isolate flex flex-col items-center overflow-hidden rounded-b-[clamp(28px,calc(48*var(--u)),48px)] bg-landing-ink pt-28 text-center text-white lg:h-[calc(1296*var(--u))] lg:pt-[calc(206*var(--u))]">
        <LandingPicture
          base="/landing/hero/hero-bg"
          widths={[864, 1728]}
          width={1728}
          height={1296}
          alt=""
          sizes="100vw"
          priority
          className="absolute inset-0 -z-10 size-full object-cover"
        />

        <p className="landing-rise rounded-full bg-landing-chip px-4 py-2 text-xs font-normal uppercase [--rise-step:0] md:text-base lg:px-[calc(20*var(--u))] lg:pb-[calc(9*var(--u))] lg:pt-[calc(11*var(--u))] lg:text-[max(14px,calc(18*var(--u)))] lg:leading-[calc(23*var(--u))]">
          {hero.eyebrow}
        </p>

        <h1
          id="hero-title"
          className="landing-rise mt-5 text-balance text-[clamp(34px,11cqw,56px)] font-semibold leading-[1.1] [--rise-step:1] md:mt-6 md:text-[58px] lg:mt-[calc(10*var(--u))] lg:text-[max(58px,calc(82*var(--u)))] lg:leading-[1.255]"
        >
          {heroTitle.before}
          <span className="text-lime">{heroTitle.highlight}</span>
          {heroTitle.firstLineEnd}
          <br className="hidden md:inline" /> {heroTitle.second}
        </h1>

        <p className="landing-rise mt-5 max-w-[22em] text-balance text-base leading-snug text-white/70 [--rise-step:2] md:mt-6 lg:mt-[calc(11*var(--u))] lg:text-[max(16px,calc(18*var(--u)))] lg:leading-[1.28]">
          {hero.subtitle}
        </p>

        <div className="landing-rise mt-6 [--rise-step:3] lg:mt-[calc(19*var(--u))]">
          <TryDemoButton href={liveDemoUrl} tone="on-dark" bestOnPhone>
            {hero.cta}
          </TryDemoButton>
        </div>

        <div className="landing-rise-phones -mb-[1.2cqw] mt-10 w-full md:w-[90%] lg:mt-[calc(95*var(--u))] lg:w-[calc(1033*var(--u))]">
          <LandingPicture
            base="/landing/hero/hero-illustration"
            widths={[860, 1033, 2066]}
            width={2066}
            height={1210}
            alt={hero.illustrationAlt}
            sizes="(min-width: 1728px) 1033px, (min-width: 1024px) 60vw, (min-width: 768px) 90vw, 100vw"
            priority
            className="h-auto w-full"
          />
        </div>
      </div>
    </section>
  );
}
