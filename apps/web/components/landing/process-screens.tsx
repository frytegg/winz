import type { CSSProperties, ReactNode } from "react";

import { AppleMark } from "@/components/ui/icons";
import { landingCopy } from "@/lib/landing/copy";
import { decorativeQr, hostOf } from "@/lib/landing/qr-target";
import { buildQrMatrix, qrPath } from "@/lib/qr";

const { onboarding, pick, fund, share, fan } = landingCopy.process.scene;

/**
 * The screens of the phone, one per step (`sections/05-process.md`): what the app shows at that moment, in HTML
 * and CSS, with fixed data and no request. They are decoration: the wrapper that holds them is `aria-hidden`,
 * and the text next to them carries the meaning.
 *
 * Each is a few `pb` groups, from the top of the screen down. A group is what comes in, one after another,
 * when the screen is rebuilt after a change of step (`process.css`, `process-build`): `--i` is its place in
 * that order. Inside a group, an element that moves carries `pa` and a class that names its keyframes (`pe-`
 * for step 01, `p2-` to `p6-` for the others, in the same file), and the markup itself is the END of that
 * animation: what a visitor who asked for less motion sees, and what a browser without the stylesheet's
 * animations shows. The animation starts from another picture (an empty field, an unselected card) and ends
 * on that one.
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

/** Step 02: the first screen of the wizard. A game is picked, the promise lit, the budget set to $250. */
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
          <span className="ps-vs pa p2-vs">{pick.versus}</span>
          <span className="ps-team ps-team-away">
            <img src="/landing/how/helmet-phi.webp" alt="" width={128} height={128} />
            <b>{pick.away}</b>
          </span>
          <span className="ps-match-ring pa p2-ring" />
        </div>
      </div>

      <div className="pb ps-chips" style={at(2)}>
        <span className="ps-chip pa p2-chip">{pick.back}</span>
      </div>

      <div className="pb ps-budget" style={at(3)}>
        <p>
          <span>{pick.budget}</span>
          {/* The amount is a counter of the stylesheet, which counts up to $250 with the slider. */}
          <b className="ps-amount pa p2-amount" />
        </p>
        <span className="ps-slider">
          <span className="ps-slider-fill pa p2-fill" />
        </span>
        <span className="ps-knob pa p2-knob" />
      </div>
    </>
  );
}

/** Step 03: paying by card. The number is typed by groups, the button pressed, the promo goes live. */
export function FundScreen(): React.JSX.Element {
  return (
    <>
      <div className="pb" style={at(0)}>
        <h4 className="ps-title">{fund.title}</h4>
      </div>

      <div className="pb ps-form ps-form-tight" style={at(1)}>
        <p className="ps-label">{fund.cardLabel}</p>
        <div className="ps-field">
          <span className="ps-live pa pe-live-loop">
            <span className="ps-card-digits">
              {fund.card.map((group, index) => (
                <span key={index}>{group}</span>
              ))}
              {/* Four steps, one per group of the number. */}
              <span className="ps-cover pa p3-cover" />
            </span>
          </span>
        </div>
      </div>

      <div className="pb ps-fund" style={at(2)}>
        <span className="ps-btn pa p3-btn">{fund.button}</span>
        <span className="ps-status pa p3-status">
          {fund.pending}
          <span className="ps-indeterminate">
            <i className="pa p3-bar" />
          </span>
        </span>
        <span className="ps-live-badge pa p3-badge">
          <i className="ps-dot pa p3-dot" />
          {fund.live}
        </span>
      </div>
    </>
  );
}

/** The modules of a code, as one path. */
function Qr({ target }: { target: string | null }): React.JSX.Element {
  const matrix = target === null ? decorativeQr() : buildQrMatrix(target);
  const quiet = 2;
  const total = matrix.size + quiet * 2;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${total} ${total}`}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <path d={qrPath(matrix)} />
    </svg>
  );
}

/**
 * Step 04: the full-screen QR, the link that is copied, the poster. The code is the live demo's address when
 * there is one (`qrUrl`), and a pattern that cannot be read when there is not.
 */
export function ShareScreen({ qrUrl }: { qrUrl: string | null }): React.JSX.Element {
  const host = qrUrl === null ? null : hostOf(qrUrl);
  return (
    <>
      <div className="pb ps-share" style={at(0)}>
        <div className="pa pe-live-loop">
          <div className="ps-qr">
            <Qr target={qrUrl} />
            {/* White, over the code: it shrinks toward the bottom, so the code is drawn from the top down. */}
            <span className="ps-qr-cover pa p4-cover" />
          </div>
        </div>
      </div>

      <div className="pb ps-share-row" style={at(1)}>
        <span className="ps-link pa p4-link">{host ?? share.linkFallback}</span>
        <span className="ps-poster">
          <svg className="pa p4-download" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
          </svg>
          {share.poster}
        </span>
      </div>

      <span className="ps-toast pa p4-toast">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3.5 8.5 6.5 11.5 12.5 5" />
        </svg>
        {share.toast}
      </span>
    </>
  );
}

/** The ticket's shape: a card, a dashed tear, a notch at each end of it. */
function TicketCard({ top, bottom }: { top: ReactNode; bottom: ReactNode }): React.JSX.Element {
  return (
    <div className="ps-ticket">
      <div className="ps-ticket-top">{top}</div>
      <div className="ps-ticket-tear" />
      <div className="ps-ticket-bottom">{bottom}</div>
    </div>
  );
}

function Helmets({ between }: { between: ReactNode }): React.JSX.Element {
  return (
    <div className="ps-helmets">
      <span className="ps-team">
        <img src="/landing/how/helmet-pit.webp" alt="" width={128} height={128} />
        <b>{fan.pit}</b>
      </span>
      {between}
      <span className="ps-team ps-team-away">
        <img src="/landing/how/helmet-phi.webp" alt="" width={128} height={128} />
        <b>{fan.phi}</b>
      </span>
    </div>
  );
}

/** Step 05: the fan's side. The promo, the Apple Pay sheet, then the ticket with its gauge. */
export function BuyScreen(): React.JSX.Element {
  return (
    <>
      <div className="pb" style={at(0)}>
        <h4 className="ps-title">{fan.merchant}</h4>
      </div>

      <div className="pb ps-buy" style={at(1)}>
        <div className="ps-buy-page pa p5-page">
          <div className="ps-promo">
            <b>
              <span className="ps-pct">100%</span> back if Pittsburgh wins!
            </b>
          </div>
          <span className="ps-pay pa p5-pay">
            <AppleMark />
            {fan.pay}
          </span>
        </div>

        <div className="ps-buy-ticket pa p5-ticket">
          <TicketCard
            top={<Helmets between={<span className="ps-vs">{pick.versus}</span>} />}
            bottom={
              <div className="ps-gauge-row">
                <span>{fan.winChance}</span>
                <span className="ps-gauge">
                  <i className="pa p5-gauge" />
                </span>
              </div>
            }
          />
        </div>
      </div>

      <div className="ps-sheet pa p5-sheet">
        <p>
          <AppleMark />
          {fan.pay}
        </p>
        <b>{fan.amount}</b>
        <span className="ps-faceid">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path className="pa p5-check" pathLength={1} d="M3.5 8.5 6.5 11.5 12.5 5" />
          </svg>
        </span>
      </div>
    </>
  );
}

/** Step 06: the final ticket. The score turns final, the ticket refunded, and the refund lands. */
export function RefundScreen(): React.JSX.Element {
  return (
    <>
      <div className="pb" style={at(0)}>
        <h4 className="ps-title">{fan.ticket}</h4>
      </div>

      <div className="pb ps-refund" style={at(1)}>
        <TicketCard
          top={
            <Helmets
              between={
                <span className="ps-score">
                  <span className="ps-score-a pa p6-before">
                    {fan.live} · {fan.scoreBefore[0]} – {fan.scoreBefore[1]}
                  </span>
                  <span className="ps-score-b pa p6-after">
                    {fan.final} · {fan.score[0]} – {fan.score[1]}
                  </span>
                </span>
              }
            />
          }
          bottom={
            <p className="ps-promise">
              <span className="ps-pct">100%</span> back if Pittsburgh wins!
            </p>
          }
        />
      </div>

      <div className="pb ps-refund-row" style={at(2)}>
        <span className="ps-statuses">
          <span className="ps-status-live pa p6-live">
            <i className="ps-dot pa p3-dot" />
            {fan.live}
          </span>
          <span className="ps-status-ref pa p6-refunded">{fan.refunded}</span>
        </span>
        <span className="ps-refund-chip pa p6-chip">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path className="pa p6-check" pathLength={1} d="M3.5 8.5 6.5 11.5 12.5 5" />
          </svg>
          {fan.refund}
        </span>
      </div>
    </>
  );
}
