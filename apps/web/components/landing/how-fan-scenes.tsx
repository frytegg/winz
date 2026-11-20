import { Flag, Gauge, MapPin, QrCode } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { AppleMark } from "@/components/ui/icons";
import { LimePercent } from "@/components/ui/lime-percent";
import { TeamBadge } from "@/components/winz/team-badge";
import { TicketShell } from "@/components/winz/ticket-shell";
import { landingCopy } from "@/lib/landing/copy";

import { HowChip } from "./how-chip";

const { scene } = landingCopy.how;

/**
 * The three illustrations of the Fan tab (`sections/03-how.md`): what a fan sees in the app, with fixed
 * data, drawn on the same 340 x 295 canvas as the Merchant ones (`merchant-01..03.svg`) and with the
 * chips in the same places (card 1 of each tab: a pill above the card on one side and one below it on
 * the other, and so on).
 *
 * What is the app's own, imported and given props: `Card` and `Diagonals` (the campaign card's shell), `TicketShell`
 * (the ticket's shape: header, dashed tear, two notches), `TeamBadge` (a team's picture), `LimePercent`,
 * `AppleMark`. They are laid out at the app's own size, then the whole card is scaled by `SCALE`: the
 * Merchant illustrations are the app's screens at about that scale (the mockup's campaign card is the
 * app's, 275 px wide instead of 348), so a Fan card next to a Merchant one has the same text sizes.
 * What is drawn here: the campaign card (above), the gauge (the app's `Gauge` is a client component that counts its number with a
 * hook and is 200 px wide; this one is a bar and moves with CSS, `landing.css`) and the chips.
 *
 * No crypto word anywhere in it: a fan reads none in the app.
 */
const SCALE = 0.79;

/** The two helmets of the Merchant tab's match card (extracted from `merchant-01.svg`, 128 px, WebP). */
const HELMET = {
  pit: "/landing/how/helmet-pit.webp",
  phi: "/landing/how/helmet-phi.webp",
} as const;

/** A box of the 340 x 295 canvas, holding app components at their own size, scaled down to fit. */
function Mini({
  x,
  y,
  width,
  height,
  children,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  children: ReactNode;
}): React.JSX.Element {
  const style: CSSProperties = { left: x, top: y, width, height };
  return (
    <div className="absolute" style={style}>
      <div
        className="origin-top-left text-text"
        style={{ width: width / SCALE, height: height / SCALE, transform: `scale(${SCALE})` }}
      >
        {children}
      </div>
    </div>
  );
}

/** A scene is one picture for a screen reader: what it shows is in `label`, not in its pieces. */
function Scene({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div role="img" aria-label={label} className="absolute inset-0">
      {children}
    </div>
  );
}

function Team({
  src,
  label,
  mirrored = false,
}: {
  src: string;
  label: string;
  mirrored?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1">
      <TeamBadge
        abbreviation={label}
        src={src}
        side={mirrored ? "b" : "a"}
        size={50}
        // The Merchant tab's match card turns the second helmet to face the first.
        className={mirrored ? "-scale-x-100" : undefined}
      />
      <span className="text-label text-muted">{label}</span>
    </div>
  );
}

/** The ticket's header: the two teams, and what stands between them (VS, then the score). */
function Teams({ between }: { between: ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <Team src={HELMET.pit} label={scene.pit} />
      {between}
      <Team src={HELMET.phi} label={scene.phi} mirrored />
    </div>
  );
}

/** The ticket, the app's shape, in the colors of the card behind the Merchant illustrations. */
function Ticket({ top, bottom }: { top: ReactNode; bottom: ReactNode }): React.JSX.Element {
  return (
    <TicketShell
      top={top}
      bottom={bottom}
      // The notches are bitten out of the card: they show what is behind it, the landing's card.
      notchColor="var(--color-landing-card)"
      className="flex h-full flex-col justify-between bg-card-raised"
    />
  );
}

/**
 * The campaign card, as the app's `CampaignHero` draws it (same classes: raised card with the diagonals, a
 * pulsing status dot, the promise in capitals with a lime %, the venue with its pin). Not imported:
 * `CampaignHero` imports the app's countdown, a client component, and with it a good part of the app's
 * client code, 60 kB on a page that has none of it (measured: /landing 129 kB to 189 kB).
 */
function CampaignCard(): React.JSX.Element {
  return (
    <Card tone="raised" diagonals className="p-6">
      <span className="flex items-center gap-2 text-label uppercase">
        <span aria-hidden="true" className="size-2 rounded-full bg-lime animate-pulse-dot" />
        {scene.campaign}
      </span>
      <h2 className="mt-4 text-promise uppercase text-text">
        <LimePercent text={scene.promise} />
      </h2>
      <p className="mt-4 flex items-center gap-1.5 text-body text-muted">
        <MapPin className="size-4 text-lime" strokeWidth={1.5} aria-hidden="true" />
        {scene.merchant}
      </p>
    </Card>
  );
}

/** Card 1, Scan and pay: the promo's card, a QR to scan, and the Apple Pay button. */
export function ScanAndPayScene({ label }: { label: string }): React.JSX.Element {
  return (
    <Scene label={label}>
      <HowChip
        tone="lime"
        icon={<QrCode className="size-3" strokeWidth={1.75} aria-hidden="true" />}
        style={{ left: 15, top: 49 }}
      >
        {scene.scanTheQr}
      </HowChip>
      <Mini x={32} y={101} width={275} height={140}>
        <div className="h-full [&>div]:h-full">
          <CampaignCard />
        </div>
      </Mini>
      <HowChip
        tone="dark"
        icon={<AppleMark className="size-3" />}
        className="how-press"
        style={{ right: 20, top: 253 }}
      >
        {scene.payWithApplePay}
      </HowChip>
    </Scene>
  );
}

/** Card 2, Follow your ticket: the live ticket, its win chance swinging a little. */
export function FollowYourTicketScene({ label }: { label: string }): React.JSX.Element {
  return (
    <Scene label={label}>
      <HowChip
        tone="dark"
        icon={<span aria-hidden="true" className="how-live-dot size-1.5 rounded-full bg-lime" />}
        style={{ right: 28, top: 47 }}
      >
        {scene.live}
      </HowChip>
      <Mini x={54} y={92} width={248} height={144}>
        <Ticket
          top={
            <Teams
              between={
                <span className="grid size-9 place-items-center rounded-full bg-lime text-label font-semibold text-ink">
                  {scene.versus}
                </span>
              }
            />
          }
          bottom={
            <div className="flex items-center gap-3">
              {/* The number counts with the bar (landing.css): `how-pct` writes it, a counter. */}
              <span className="how-pct figures w-[3.6ch] text-clock text-lime" />
              <div className="relative h-2 flex-1 rounded-full bg-card">
                <div className="how-gauge absolute inset-0 origin-left rounded-full bg-lime" />
              </div>
            </div>
          }
        />
      </Mini>
      <HowChip
        tone="lime"
        icon={<Gauge className="size-3" strokeWidth={1.75} aria-hidden="true" />}
        style={{ left: 28, top: 251 }}
      >
        {scene.winChance}
      </HowChip>
    </Scene>
  );
}

/** The tick of the Refunded chip: a path that is drawn, once (`.how-check`). */
function Check(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path className="how-check" pathLength={1} d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

/** Card 3, Team wins, money back: the same ticket, final, and the refund that came by itself. */
export function MoneyBackScene({ label }: { label: string }): React.JSX.Element {
  return (
    <Scene label={label}>
      <HowChip
        tone="dark"
        icon={<Flag className="size-3" strokeWidth={1.75} aria-hidden="true" />}
        style={{ left: 17, top: 49 }}
      >
        {scene.final}
      </HowChip>
      <Mini x={46} y={99} width={248} height={144}>
        <Ticket
          top={
            <Teams
              between={
                <span className="figures whitespace-nowrap text-clock">
                  {scene.score[0]} <span className="text-muted">–</span> {scene.score[1]}
                </span>
              }
            />
          }
          bottom={
            <p className="text-center text-label uppercase leading-4">
              <LimePercent text={scene.promise} />
            </p>
          }
        />
      </Mini>
      <HowChip
        tone="lime"
        icon={<Check />}
        className="how-refunded"
        style={{ right: 17, top: 254 }}
      >
        {scene.refunded} · {scene.amount}
      </HowChip>
    </Scene>
  );
}
