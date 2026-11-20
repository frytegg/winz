import { Fragment, type CSSProperties } from "react";

import { landingCopy } from "@/lib/landing/copy";

import { ProcessPhone } from "./process-phone";
import { ProcessScroll } from "./process-scroll";
import {
  BuyScreen,
  FundScreen,
  OnboardingScreen,
  PickScreen,
  RefundScreen,
  ShareScreen,
} from "./process-screens";

const { process: copy } = landingCopy;

/**
 * The share of the phone's progress bar each step stands for. The first is the mockup's (66 of 254 px); the
 * last is a full bar, and the four between are evenly spaced.
 */
const FILLS = [0.26, 0.408, 0.556, 0.704, 0.852, 1] as const;

/** Every step has a screen. */
const STEPS = 6;

const two = (n: number): string => String(n).padStart(2, "0");

/**
 * The "Test it in three minutes" section (`sections/05-process.md`, mockup `process/process.png`, 1728 px wide;
 * text in `COPY.md` section 5). `id="live-demo"` is where the navigation's "Live demo" lands.
 *
 * The header is left-aligned, unlike the other sections'. Below it, on a desktop, a light card with a phone is
 * sticky on the left while the steps' text scrolls past on the right, and the phone's screen changes with the
 * step (`ProcessScroll`, `process.css`); under 1024 px each step is its own card with its screen above its text.
 * Both pictures are in the markup (one is hidden by CSS at any width): they are decoration, so `aria-hidden`,
 * and a reader meets the section as a header and six steps in order, the sticky card last.
 */
export function LandingProcess({ qrUrl }: { qrUrl: string | null }): React.JSX.Element {
  const content = (index: number): React.JSX.Element => {
    switch (index) {
      case 0:
        return <OnboardingScreen />;
      case 1:
        return <PickScreen />;
      case 2:
        return <FundScreen />;
      case 3:
        return <ShareScreen qrUrl={qrUrl} />;
      case 4:
        return <BuyScreen />;
      default:
        return <RefundScreen />;
    }
  };

  const screen = (index: number): React.JSX.Element => (
    <div className="process-screen" data-process-screen data-index={index}>
      {content(index)}
    </div>
  );

  return (
    <section
      id="live-demo"
      aria-labelledby="process-title"
      className="process px-4 pb-20 pt-16 md:px-6 lg:px-0 lg:pb-[calc(194*var(--u))] lg:pt-[calc(220*var(--u))]"
    >
      <div className="mx-auto max-w-[560px] lg:max-w-none lg:w-[calc(1290*var(--u))]">
        <p className="inline-block rounded-full bg-lime px-4 py-2 text-xs uppercase text-ink md:text-base lg:px-[calc(20*var(--u))] lg:pb-[calc(9*var(--u))] lg:pt-[calc(11*var(--u))] lg:text-[max(14px,calc(18*var(--u)))] lg:leading-[calc(23*var(--u))]">
          {copy.eyebrow}
        </p>

        <h2
          id="process-title"
          className="mt-5 text-balance text-[clamp(28px,8cqw,40px)] font-semibold leading-[1.15] text-ink md:text-5xl lg:mt-[calc(28*var(--u))] lg:text-[max(40px,calc(52*var(--u)))] lg:leading-[1.255]"
        >
          {copy.title}
        </h2>

        <ProcessScroll className="process-grid mt-10 lg:mt-[calc(62*var(--u))]">
          <ol role="list" className="process-list">
            {copy.steps.map((step, index) => (
              <li
                key={step.title}
                className="process-step"
                data-process-step
                data-index={index}
                style={{ "--i": index } as CSSProperties}
              >
                <article
                  aria-labelledby={`process-step-${index + 1}`}
                  className="process-block"
                  data-process-block
                  data-index={index}
                  data-fill={FILLS[index]}
                >
                  <p className="process-label">
                    {copy.stepLabel} {two(index + 1)}
                  </p>
                  <h3 id={`process-step-${index + 1}`} className="process-title">
                    {step.title}
                  </h3>
                  <p className="process-body">{step.body}</p>
                </article>

                {/* The step's own picture, for the layouts with no sticky card. */}
                <div className="process-art" aria-hidden="true" data-process-art>
                  <ProcessPhone fill={FILLS[index] ?? 1}>{screen(index)}</ProcessPhone>
                </div>
              </li>
            ))}
          </ol>

          {/* The sticky card: one phone, and the six screens take turns on it. */}
          <div className="process-stage" aria-hidden="true" data-process-stage>
            <div className="process-sticky">
              <div className="process-box">
                <ProcessPhone fill={FILLS[0]}>
                  {Array.from({ length: STEPS }, (_, index) => (
                    <Fragment key={index}>{screen(index)}</Fragment>
                  ))}
                </ProcessPhone>
              </div>
            </div>
          </div>
        </ProcessScroll>
      </div>
    </section>
  );
}
