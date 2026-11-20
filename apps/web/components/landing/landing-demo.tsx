import { landingCopy } from "@/lib/landing/copy";

import { DemoPlayer } from "./demo-player";
import { LandingPicture } from "./landing-picture";
import { TryDemoButton } from "./try-demo-button";

const { demo, demoTitle } = landingCopy;

/**
 * Demo (`sections/04-demo.md`, mockup `demo/demo-winz.png`, 1728 x 1211; text in `COPY.md` section 4).
 * Written in the mockup's pixels times `--u` (set once by the page), as the hero and How are: a dark
 * block that is the page's full width and 1211 px tall at 1728, its four corners rounded (64 px measured:
 * the mockup notes said ~48), the eyebrow 152 px from its top, the title, the button, and the player.
 *
 * The block is inset by 16 px on a phone and keeps its corners (28 px there). Its background is the
 * mockup's gradient with the lines, an opaque image the block clips itself (`public/landing/demo/`).
 * `id="demo"` is where the navigation lands.
 */
export function LandingDemo({
  liveDemoUrl,
  videoUrl,
}: {
  /** `landingLinks.liveDemoUrl`: `null` makes the button inactive, never a dead link. */
  liveDemoUrl: string | null;
  /** `landingLinks.videoUrl`: `null` shows the player inactive, "Demo video coming soon." under it. */
  videoUrl: string | null;
}): React.JSX.Element {
  return (
    <section id="demo" aria-labelledby="demo-title" className="mx-4 md:mx-6 lg:mx-0">
      <div className="relative isolate flex flex-col items-center overflow-hidden rounded-[clamp(28px,calc(64*var(--u)),64px)] bg-landing-ink px-3 pb-3 pt-14 text-center text-white md:px-6 md:pb-6 md:pt-16 lg:h-[calc(1211*var(--u))] lg:px-0 lg:pb-0 lg:pt-[calc(152*var(--u))]">
        <LandingPicture
          base="/landing/demo/demo-winz-bg"
          widths={[864, 1728]}
          width={1728}
          height={1211}
          alt=""
          sizes="100vw"
          className="absolute inset-0 -z-10 size-full object-cover"
        />

        <p className="rounded-full bg-landing-chip px-4 py-2 text-xs font-normal uppercase md:text-base lg:px-[calc(20*var(--u))] lg:pb-[calc(9*var(--u))] lg:pt-[calc(11*var(--u))] lg:text-[max(14px,calc(18*var(--u)))] lg:leading-[calc(23*var(--u))]">
          {demo.eyebrow}
        </p>

        <h2
          id="demo-title"
          className="mt-5 text-balance text-[clamp(28px,9.6cqw,40px)] font-semibold leading-[1.15] md:mt-6 md:text-5xl lg:mt-[calc(17*var(--u))] lg:text-[max(40px,calc(52*var(--u)))] lg:leading-[1.255]"
        >
          {demoTitle.before}
          <span className="whitespace-nowrap text-lime">{demoTitle.highlight}</span>
          <br className="hidden md:inline" /> {demoTitle.second}
        </h2>

        <div className="mt-6 lg:mt-[calc(16*var(--u))]">
          <TryDemoButton href={liveDemoUrl} tone="on-dark" bestOnPhone>
            {demo.cta}
          </TryDemoButton>
        </div>

        <div className="mt-10 w-full lg:mt-[calc(73*var(--u))]">
          <DemoPlayer videoUrl={videoUrl} />
        </div>
      </div>
    </section>
  );
}
