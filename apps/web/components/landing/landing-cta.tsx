import { landingCopy } from "@/lib/landing/copy";
import { linkOrNull } from "@/lib/landing/links";

import { GithubIcon } from "./github-icon";
import { LandingPicture } from "./landing-picture";
import { PrimaryButton } from "./primary-button";
import { RevealOnScroll } from "./reveal-on-scroll";
import { Wordmark } from "./wordmark";

const { cta } = landingCopy;

/**
 * The closing call to action (`sections/07-cta.md`, mockup `cta/cta.png`, COPY.md section 7): the wordmark,
 * the title, the one button, and the three phones that end exactly where the footer starts. Measured on the
 * 1728 px mockup (`winz-landing.png`): the section is 930 px, the wordmark 111 px wide at 48 px, the button
 * at 197 px, the phones (849 px wide, 606 high) at 325 px and flush with the bottom edge.
 *
 * The background is the pale lime the Features section fades into, one step further down: it starts at
 * `--color-landing-lime-from` and ends on `--color-landing-lime-to`, the footer's white meets it with a
 * straight edge (the mockup's page ends there).
 *
 * The phones hold a QR code that was re-exported to carry the app's address.
 */
export function LandingCta({
  githubUrl,
  repoUrl,
}: {
  githubUrl: string | null;
  /** `landingLinks.repoUrl`: `null` and the secondary link is not rendered. */
  repoUrl: string | null;
}): React.JSX.Element {
  const repo = linkOrNull(repoUrl);
  return (
    <section
      id="cta"
      aria-labelledby="cta-title"
      className="overflow-hidden bg-[linear-gradient(to_bottom,var(--color-landing-lime-from),var(--color-landing-lime-to))] text-center"
    >
      <RevealOnScroll className="flex flex-col items-center px-4 pt-12 md:px-6 lg:px-0 lg:pt-[calc(48*var(--u))]">
        <div className="cta-fade" style={{ "--i": 0 } as React.CSSProperties}>
          <Wordmark tone="ink" className="h-auto w-[88px] lg:w-[max(88px,calc(111*var(--u)))]" />
        </div>

        <h2
          id="cta-title"
          style={{ "--i": 1 } as React.CSSProperties}
          className="cta-fade mt-6 text-balance text-[clamp(28px,8.4cqw,40px)] font-semibold leading-[1.15] text-ink md:text-5xl lg:mt-[calc(25*var(--u))] lg:text-[max(40px,calc(52*var(--u)))] lg:leading-[1.255]"
        >
          {cta.title}
        </h2>

        <div
          className="cta-fade mt-6 lg:mt-[calc(24*var(--u))]"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <PrimaryButton href={githubUrl} tone="on-light">
            {cta.button}
          </PrimaryButton>
        </div>

        {repo === null ? null : (
          // Secondary: an outlined pill under the lime one, in the gap above the phones (which keep their place at 1728 px:
          // their margin is this link's 44 px and its 10 px of margin less).
          <div
            className="cta-fade mt-2.5 lg:mt-[calc(10*var(--u))]"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <a
              href={repo}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2.5 rounded-full border border-ink/25 px-5 text-base text-ink no-underline transition-colors duration-150 hover:border-ink hover:bg-ink/5 focus-visible:outline-ink"
            >
              <GithubIcon className="size-5" />
              {cta.repo}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        )}

        {/* `leading-[0]` and `block`: the image is the last thing in the section, with no line box under it. */}
        <div
          className={`cta-rise w-full max-w-[560px] leading-[0] md:w-[80%] md:max-w-none lg:w-[calc(849*var(--u))] ${
            repo === null
              ? "mt-10 lg:mt-[calc(73*var(--u))]"
              : "mt-8 lg:mt-[max(12px,calc(73*var(--u)-54px))]"
          }`}
        >
          <LandingPicture
            base="/landing/cta/cta-illustration"
            widths={[849, 1698]}
            width={1698}
            height={1212}
            alt={cta.illustrationAlt}
            sizes="(min-width: 1728px) 849px, (min-width: 1024px) 49vw, (min-width: 768px) 80vw, 100vw"
            className="block h-auto w-full"
          />
        </div>
      </RevealOnScroll>
    </section>
  );
}
