import { Check, Copy, CreditCard, Download } from "lucide-react";
import type { ReactNode } from "react";

import { AppleMark } from "@/components/ui/icons";
import { TeamBadge, TeamDot } from "@/components/winz/team-badge";
import { landingCopy } from "@/lib/landing/copy";
import { QR_GLYPH_PATH, QR_LOGO_RATIO, buildQrMatrix, qrPath } from "@/lib/qr";

import { HELMET, SIDES, type Side } from "./example-teams";
import { CampaignCard, Mini, Scene } from "./how-fan-scenes";
import { HowChip } from "./how-chip";

const { merchantScene: scene } = landingCopy.how;

/**
 * The three illustrations of the Merchant tab (`sections/03-how.md`): the wizard's first step, the funding
 * step and the share step, with the page's example (`landingCopy.example`). They replace the mockup's
 * Figma exports, whose text was vector paths and told another example; they keep their layout, on the
 * same 340 x 295 canvas, with the chips in the same places and at the same sizes, and they are drawn the
 * way the Fan tab's are (`how-fan-scenes.tsx`): the app's pieces at the app's own size, scaled by `Mini`.
 *
 * No client code: the app's `MatchCard` and `QrCode` are client components (a clock that waits for
 * hydration, a memo), so their markup is drawn here with the same classes, from the same helpers.
 */

/** The chips' tick (Budget, Promo): the step is done. */
function Done(): React.JSX.Element {
  return <Check className="size-3.5" strokeWidth={1.75} aria-hidden="true" />;
}

/** The dark round button at the end of a lime chip (copy the link, download the QR). */
function ChipButton({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="grid size-[26px] shrink-0 place-items-center rounded-full bg-ink text-lime"
    >
      {children}
    </span>
  );
}

/** One side of the match card, as the app's `MatchCard` draws it: helmet, name, abbreviation, chance. */
function MatchSide({ side, position }: { side: Side; position: "a" | "b" }): React.JSX.Element {
  const team = scene.teams[side];
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <TeamBadge
        abbreviation={team.abbreviation}
        src={HELMET[side]}
        side={position}
        size={72}
        // The team on the right is turned to face the other one.
        className={position === "b" ? "-scale-x-100" : undefined}
      />
      <span className="line-clamp-2 min-h-11 w-full break-words text-body text-text">
        {team.name}
      </span>
      <span className="flex items-center gap-1.5 text-label">
        <span className="text-muted opacity-70">{team.abbreviation}</span>
        <span className="figures flex items-center gap-1 font-semibold text-text">
          <TeamDot side={position} />
          {team.chance}%
        </span>
      </span>
    </div>
  );
}

/** The wizard's match card (M3): the two teams, the kickoff, the round VS. */
function MatchCard(): React.JSX.Element {
  const [left, right] = SIDES;
  return (
    <div className="h-full rounded-card-sm bg-card-raised p-5 text-text">
      <div className="flex items-start gap-2">
        <MatchSide side={left} position="a" />
        <div className="flex w-[96px] shrink-0 flex-col items-center gap-1 pt-1">
          <span className="figures text-clock">
            {scene.kickoff.time}
            <span className="ml-1 text-label font-normal">{scene.kickoff.meridiem}</span>
          </span>
          <span className="text-label text-muted">{scene.kickoff.date}</span>
          <span className="mt-2 grid size-11 place-items-center rounded-full bg-lime text-label font-semibold text-ink">
            {landingCopy.how.scene.versus}
          </span>
        </div>
        <MatchSide side={right} position="b" />
      </div>
    </div>
  );
}

/** Card 1, Pick a game and a budget: the game picked, the budget and the promo set. */
export function PickGameScene({ label }: { label: string }): React.JSX.Element {
  return (
    <Scene label={label}>
      <HowChip tone="lime" icon={<Done />} className="text-[13px]" style={{ left: 221, top: 47 }}>
        {scene.budget}
      </HowChip>
      <Mini x={54} y={94} width={248} height={140}>
        <MatchCard />
      </Mini>
      <HowChip
        tone="lime"
        icon={<Done />}
        className="text-[13px] uppercase"
        style={{ left: 28, top: 251 }}
      >
        {scene.promo}
      </HowChip>
    </Scene>
  );
}

/** Card 2, Pay by card: the promo's card, and the two ways to fund it. */
export function FundScene({ label }: { label: string }): React.JSX.Element {
  return (
    <Scene label={label}>
      <HowChip tone="lime" icon={<AppleMark className="size-3" />} style={{ left: 15, top: 49 }}>
        {scene.fundWithApplePay}
      </HowChip>
      <Mini x={32} y={101} width={275} height={140}>
        <div className="h-full [&>div]:h-full">
          <CampaignCard />
        </div>
      </Mini>
      <HowChip
        tone="dark"
        icon={<CreditCard className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
        className="how-press"
        style={{ right: 20, top: 252 }}
      >
        {scene.fundWithCard}
      </HowChip>
    </Scene>
  );
}

/** The promo's QR code, as the app's `QrCode` draws it: dark modules on white, the Winz mark in the middle. */
function PromoQr({ value }: { value: string }): React.JSX.Element {
  const quiet = 2;
  const matrix = buildQrMatrix(value);
  const total = matrix.size + quiet * 2;
  const logo = matrix.size * QR_LOGO_RATIO;
  const start = quiet + (matrix.size - logo) / 2;
  const glyphWidth = logo * 0.62;
  const glyphScale = glyphWidth / 87;
  return (
    <svg
      viewBox={`0 0 ${total.toString()} ${total.toString()}`}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
      className="block size-full rounded-[5px] bg-white-pill"
    >
      <g transform={`translate(${quiet.toString()} ${quiet.toString()})`}>
        <path d={qrPath(matrix)} className="fill-ink" />
      </g>
      <rect
        x={start}
        y={start}
        width={logo}
        height={logo}
        rx={logo * 0.24}
        className="fill-lime"
        shapeRendering="geometricPrecision"
      />
      <path
        d={QR_GLYPH_PATH}
        className="fill-ink"
        shapeRendering="geometricPrecision"
        transform={`translate(${(start + (logo - glyphWidth) / 2).toString()} ${(start + (logo - 71 * glyphScale) / 2).toString()}) scale(${glyphScale.toString()})`}
      />
    </svg>
  );
}

/** Card 3, Show the QR: the promo's link with its copy button, its QR code, and Download QR. */
export function ShareScene({ label }: { label: string }): React.JSX.Element {
  return (
    <Scene label={label}>
      <HowChip tone="lime" className="max-w-[306px] gap-2 pr-[2px]" style={{ left: 17, top: 49 }}>
        {/* The app's share screen cuts a link that does not fit the same way. */}
        <span className="min-w-0 truncate">{scene.link}</span>
        <ChipButton>
          <Copy className="size-3" strokeWidth={1.75} />
        </ChipButton>
      </HowChip>
      <div
        className="absolute grid place-items-center rounded-[10px] bg-card-raised"
        style={{ left: 99, top: 101, width: 142, height: 140 }}
      >
        <div className="size-[104px]">
          <PromoQr value={`https://${scene.link}`} />
        </div>
      </div>
      <HowChip tone="lime" className="gap-2 pr-[2px]" style={{ right: 16, top: 253 }}>
        {scene.downloadQr}
        <ChipButton>
          <Download className="size-3" strokeWidth={1.75} />
        </ChipButton>
      </HowChip>
    </Scene>
  );
}
