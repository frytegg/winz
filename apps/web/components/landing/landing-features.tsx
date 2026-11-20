import { landingCopy } from "@/lib/landing/copy";

import { RevealOnScroll } from "./reveal-on-scroll";

const { features } = landingCopy;

/**
 * Features (`sections/06-features.md`, mockup `features/features-winz.png`, COPY.md section 6). The mockup is
 * 1376 px wide, not 1728 like the others: everything below is its measure times 1728 / 1376 (1.2558), so
 * that it sits on the page the way the full-page mockup (`winz-landing.png`) shows it. The cards come out at
 * 340 x 204 with 20 px between them, the grid at 1060 px, as How's: the brief said ~272 x 162 and a 1290 px
 * grid, which are the mockup's own pixels before the scale and not the page's.
 *
 * The background fades from white (26 % down) to the pale lime the CTA starts on (`--color-landing-lime-from`),
 * so that the two sections meet without a seam.
 *
 * The cards are not links. Their icons are decoration: the title says it all.
 */
export function LandingFeatures(): React.JSX.Element {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="bg-[linear-gradient(to_bottom,#fff_26.4%,var(--color-landing-lime-from))] px-4 pb-20 pt-16 text-center md:px-6 lg:px-0 lg:pb-[calc(148*var(--u))] lg:pt-[calc(139*var(--u))]"
    >
      <div className="flex flex-col items-center">
        <p className="rounded-full bg-lime px-4 py-2 text-xs uppercase text-ink md:text-base lg:px-[calc(20*var(--u))] lg:pb-[calc(9*var(--u))] lg:pt-[calc(11*var(--u))] lg:text-[max(14px,calc(18*var(--u)))] lg:leading-[calc(23*var(--u))]">
          {features.eyebrow}
        </p>

        <h2
          id="features-title"
          className="mt-5 text-balance text-[clamp(28px,8cqw,40px)] font-semibold leading-[1.15] text-ink md:text-5xl lg:mt-[calc(10*var(--u))] lg:text-[max(40px,calc(52*var(--u)))] lg:leading-[1.255]"
        >
          {features.title}
        </h2>

        <p className="mt-3 max-w-[22em] text-balance text-base leading-5 text-landing-gray lg:mt-[calc(11*var(--u))] lg:max-w-none lg:text-[max(16px,calc(16*var(--u)))]">
          {features.subtitle}
        </p>
      </div>

      <RevealOnScroll className="mt-10 flex justify-center lg:mt-[calc(88*var(--u))]">
        <ul role="list" className="features-grid">
          {features.items.map((item, index) => (
            <li
              key={item.title}
              style={{ "--i": index } as React.CSSProperties}
              className="reveal-card relative flex min-h-[204px] flex-col justify-end rounded-3xl border border-landing-line bg-landing-card pb-[27px] pl-5 pr-4 pt-[72px] text-left transition-[translate,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-ink/15 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              {/* A 24 px box, so that the six icons (20 to 24 px wide) are centered on one column. */}
              <span
                aria-hidden="true"
                className="absolute left-[17px] top-6 grid size-6 place-items-center"
              >
                {/* The files are SVG at their own size (20 x 24, 24 x 17 ...): a plain img keeps it. */}
                <img
                  src={`/landing/features/${item.icon}.svg`}
                  alt=""
                  decoding="async"
                  className="max-w-none"
                />
              </span>
              <h3 className="text-xl font-semibold leading-7 text-ink">{item.title}</h3>
              <p className="mt-3 text-base leading-5 text-landing-gray">{item.body}</p>
            </li>
          ))}
        </ul>
      </RevealOnScroll>
    </section>
  );
}
