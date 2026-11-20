import type { CSSProperties } from "react";

import { landingCopy } from "@/lib/landing/copy";

const { onboarding, pick } = landingCopy.process.scene;

/**
 * The screens of the phone, one per step (`sections/05-process.md`): what the app shows at that moment, in HTML
 * and CSS, with fixed data and no request. They are decoration: the wrapper that holds them is `aria-hidden`,
 * and the text next to them carries the meaning.
 *
 * Each is a few `pb` groups, from the top of the screen down. A group is what comes in, one after another,
 * when the screen is rebuilt after a change of step (`process.css`, `process-build`): `--i` is its place in
 * that order. Inside a group, the classes that start with `pe-` are what the step's own animation moves
 * (the same file), and the markup itself is the END of that animation: what a visitor who asked for less
 * motion sees, and what a browser without the stylesheet's animations shows. The animation starts from the
 * mockup's picture (an empty field) and ends on that.
 */

/** The order of a group in the rebuild. */
const at = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;

/** Step 01: sign in. The e-mail is typed, then the code that was sent to it. `process.png`'s screen is its first frame. */
export function OnboardingScreen(): React.JSX.Element {
  return (
    <>
      <div className="pb" style={at(0)}>
        <h4 className="ps-title">{onboarding.title}</h4>
        <p className="ps-sub">{onboarding.subtitle}</p>
      </div>

      <div className="pb ps-form" style={at(1)}>
        <p className="ps-label">{onboarding.emailLabel}</p>
        <div className="ps-field">
          <span className="ps-hint pe-ph">{onboarding.emailPlaceholder}</span>
          {/* What the typing leaves: the letters, the ring, the tick. It fades as one when the loop starts over. */}
          <span className="ps-live pe-live">
            <span className="ps-typed">
              <span className="ps-typed-text">{onboarding.email}</span>
              {/* A cover, the colour of the screen, slides off the text in one step per letter. */}
              <span className="ps-cover pe-type">
                <i className="ps-caret pe-caret" />
              </span>
            </span>
            <span className="ps-ring pe-ring" />
            <svg className="ps-tick" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path className="pe-tick" pathLength={1} d="M3 8.5 6.5 12 13 4.5" />
            </svg>
          </span>
        </div>
      </div>

      <div className="pb ps-code" style={at(2)}>
        <div className="pe-code">
          <div className="ps-code-row">
            <span className="ps-digits">
              {[...onboarding.code].map((digit, index) => (
                <span key={index}>{digit}</span>
              ))}
            </span>
            <span className="ps-cover pe-codecover" />
            {/* The outlines are over the cover: the boxes are there before their digits are. */}
            <span className="ps-boxes">
              {[...onboarding.code].map((_, index) => (
                <i key={index} />
              ))}
            </span>
            <span className="ps-boxes ps-boxes-ok pe-codeok">
              {[...onboarding.code].map((_, index) => (
                <i key={index} />
              ))}
            </span>
          </div>
          <span className="ps-ok pe-ok">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3.5 8.5 6.5 11.5 12.5 5" />
            </svg>
          </span>
        </div>
      </div>
    </>
  );
}

/** Step 02: the first screen of the wizard, a game to pick, the promise and the budget. */
export function PickScreen(): React.JSX.Element {
  return (
    <>
      <div className="pb" style={at(0)}>
        <h4 className="ps-title">{pick.title}</h4>
      </div>

      <div className="pb ps-match" style={at(1)}>
        <div className="ps-match-card">
          <span className="ps-team">
            <img src="/landing/how/helmet-pit.webp" alt="" width={128} height={128} />
            <b>{pick.home}</b>
          </span>
          <span className="ps-vs">{pick.versus}</span>
          <span className="ps-team ps-team-away">
            <img src="/landing/how/helmet-phi.webp" alt="" width={128} height={128} />
            <b>{pick.away}</b>
          </span>
        </div>
      </div>

      <div className="pb ps-chips" style={at(2)}>
        <span className="ps-chip">{pick.back}</span>
      </div>

      <div className="pb ps-budget" style={at(3)}>
        <p>
          <span>{pick.budget}</span>
          <b>{pick.amount}</b>
        </p>
        <span className="ps-slider">
          <span className="ps-slider-fill" />
        </span>
      </div>
    </>
  );
}

/** Steps 03 to 06 do not have their screen yet: the phone's own chrome, with an empty screen. */
export function PendingScreen(): React.JSX.Element {
  return <></>;
}
