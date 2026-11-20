import Image from "next/image";

import { landingCopy } from "@/lib/landing/copy";
import { cn } from "@/lib/utils";

const { logos } = landingCopy;

/**
 * The tools. `width` and `height` are the size of the file, which is also the size the mockup shows it at
 * (1728 px wide), so `--logo-u` scales them all together. Every file is a bitmap in an SVG, exported
 * already gray at 0.48 like the mockup: nothing is dimmed here.
 */
const LOGOS: readonly {
  readonly name: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
}[] = [
  { name: "Stripe", src: "/landing/logos/stripe.svg", width: 83, height: 37 },
  { name: "Arc", src: "/landing/logos/arc.svg", width: 88, height: 32 },
  { name: "Gemini", src: "/landing/logos/gemini.svg", width: 169, height: 37 },
  { name: "QuickNode", src: "/landing/logos/quicknode.svg", width: 159, height: 37 },
];

/**
 * How many lists make half of the track. The loop moves the track by half of its width and is seamless only
 * if that half is wider than the window it scrolls in: one list of four logos is about 820 px at 1728 px,
 * the window 1014, and on a wide monitor 4600. Six lists are 4900 px, enough up to a 5120 px screen.
 * `--marquee-duration` (landing.css) is the time of these six, at the same 40 px/s as before.
 */
export const MARQUEE_RUNS = 6;

/** One list of the logos. The same markup is rendered `2 * MARQUEE_RUNS` times, so that the loop has no seam. */
function LogoList({ copy }: { copy: boolean }): React.JSX.Element {
  return (
    <ul
      // The visible list is named; its twin is hidden from assistive technology, or a screen reader
      // would read every tool twice.
      {...(copy ? { "aria-hidden": true } : { "aria-label": logos.listLabel })}
      className={cn(
        "flex shrink-0 items-center gap-x-[calc(80*var(--logo-u))] pr-[calc(80*var(--logo-u))]",
        // Without motion there is no loop: one list, wrapped and centered (a grid on a phone).
        "motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-6 motion-reduce:pr-0",
        copy
          ? "motion-reduce:hidden"
          : "max-md:motion-reduce:grid max-md:motion-reduce:w-full max-md:motion-reduce:grid-cols-3 max-md:motion-reduce:place-items-center",
      )}
    >
      {LOGOS.map((logo) => (
        <li key={logo.name} className="flex items-center">
          <Image
            src={logo.src}
            alt={copy ? "" : logo.name}
            width={logo.width}
            height={logo.height}
            unoptimized
            // Eager: these are a few kilobytes each, and the twin sits outside the window, where a lazy
            // image would only start to load once the loop brought it in.
            loading="eager"
            style={{
              width: `calc(${logo.width} * var(--logo-u))`,
              height: `calc(${logo.height} * var(--logo-u))`,
            }}
            className="max-w-none"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The logo strip (`sections/02-logos.md`, mockup `logo/logo-winz.png`): "Built with the best tools" on
 * the left, and the tools scrolling to the left without end, with a fade at both edges.
 *
 * The scroll is CSS only (`landing.css`, `.landing-marquee-track`): the list is rendered twelve times in
 * one track, which moves by exactly half its width, six lists, so the second half takes the first one's
 * place and the loop closes without a jump, and never shows an empty end (see `MARQUEE_RUNS`). It stops under the pointer, while the
 * checkbox has focus (the one control a keyboard has; checked, it stays stopped), and entirely under
 * `prefers-reduced-motion`. A server component: nothing here needs JavaScript.
 *
 * Sizes are the mockup's pixels times `--u` (the page's), with a floor so that a logo is never
 * under 24 px high.
 */
export function LogoStrip(): React.JSX.Element {
  const [first = "", second = ""] = logos.labelLines;

  return (
    <section
      aria-labelledby="logos-label"
      className="flex flex-col items-center gap-5 px-5 py-10 [--logo-u:max(0.65px,var(--u))] lg:h-[calc(207*var(--u))] lg:flex-row lg:gap-0 lg:px-[calc(219*var(--u))] lg:py-0"
    >
      <p
        id="logos-label"
        className="text-center text-base text-landing-gray lg:w-[calc(276*var(--u))] lg:shrink-0 lg:pl-[calc(26*var(--u))] lg:text-left lg:text-[max(16px,calc(22*var(--u)))] lg:leading-[calc(28*var(--u))]"
      >
        <span className="lg:block">{first}</span> <span className="lg:block">{second}</span>
      </p>

      <div className="landing-marquee w-full min-w-0 rounded-lg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-ink lg:flex-1">
        <div className="landing-marquee-mask relative overflow-hidden">
          <input
            type="checkbox"
            aria-label={logos.pause}
            className="landing-marquee-pause peer sr-only motion-reduce:hidden"
          />
          <div className="landing-marquee-track flex w-max motion-reduce:w-full motion-reduce:justify-center">
            {Array.from({ length: 2 * MARQUEE_RUNS }, (_, index) => (
              <LogoList key={index} copy={index > 0} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
