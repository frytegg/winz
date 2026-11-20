import type { ReactNode } from "react";

import { landingCopy } from "@/lib/landing/copy";

import { HowCard } from "./how-card";
import { FollowYourTicketScene, MoneyBackScene, ScanAndPayScene } from "./how-fan-scenes";
import { FundScene, PickGameScene, ShareScene } from "./how-merchant-scenes";
import { HowTabs } from "./how-tabs";

const { how } = landingCopy;

/**
 * The mockup breaks "Put it on the counter or / send the link." earlier than the card's width does
 * (its text boxes are set by hand in Figma): the width, in px, that gives the same break in Sora 16 px.
 */
const MERCHANT_BODY_WIDTH: readonly (number | undefined)[] = [undefined, undefined, 205];

/**
 * The cards of a tab: three in a row from 1110 px (3 x 340 + 2 x 20 = the mockup's 1060), then two
 * columns with the third card centered under them (tablet), then one column (phone). The illustrations
 * keep their size: a layout that changes reads better than a card that shrinks below what its text needs.
 */
function HowGrid({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="how-grid">{children}</div>;
}

/**
 * How it works (`sections/03-how.md`, mockup `how/how.png`, 1728 px wide; text in `COPY.md` section 3).
 * Vertical spacing and the type are in the mockup's pixels times `--u` (set once by the page), as the
 * hero's; the cards are not scaled (see `HowCard`). `id="how"` is where the navigation lands.
 */
export function LandingHow({ qrUrl }: { qrUrl: string | null }): React.JSX.Element {
  const merchantScenes = [
    (label: string) => <PickGameScene label={label} />,
    (label: string) => <FundScene label={label} />,
    (label: string) => <ShareScene label={label} qrUrl={qrUrl} />,
  ] as const;
  const merchant = (
    <HowGrid>
      {how.merchant.map((card, index) => {
        const drawScene = merchantScenes[index] ?? merchantScenes[0];
        return (
          <HowCard
            key={card.title}
            index={index}
            title={card.title}
            body={card.body}
            bodyMaxWidth={MERCHANT_BODY_WIDTH[index]}
            art={drawScene(card.alt)}
          />
        );
      })}
    </HowGrid>
  );

  const scenes = [ScanAndPayScene, FollowYourTicketScene, MoneyBackScene] as const;
  const fan = (
    <HowGrid>
      {how.fan.map((card, index) => {
        const Scene = scenes[index] ?? ScanAndPayScene;
        return (
          <HowCard
            key={card.title}
            index={index}
            title={card.title}
            body={card.body}
            art={<Scene label={card.alt} />}
          />
        );
      })}
    </HowGrid>
  );

  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="flex flex-col items-center px-4 pb-20 pt-16 text-center lg:pb-[calc(204*var(--u))] lg:pt-[calc(71*var(--u))]"
    >
      <p className="rounded-full bg-lime px-4 py-2 text-xs uppercase text-ink md:text-base lg:px-[calc(20*var(--u))] lg:pb-[calc(9*var(--u))] lg:pt-[calc(11*var(--u))] lg:text-[max(14px,calc(18*var(--u)))] lg:leading-[calc(23*var(--u))]">
        {how.eyebrow}
      </p>

      <h2
        id="how-title"
        className="mt-5 text-balance text-[clamp(28px,8cqw,40px)] font-semibold leading-[1.15] text-ink md:text-5xl lg:mt-[calc(10*var(--u))] lg:text-[max(40px,calc(52*var(--u)))] lg:leading-[1.255]"
      >
        {how.title}
      </h2>

      <p className="mt-3 max-w-[22em] text-balance text-base leading-5 text-landing-gray-faint lg:mt-[calc(11*var(--u))] lg:max-w-none lg:text-[max(16px,calc(16*var(--u)))]">
        {how.subtitleLines[0]}
        <br className="hidden lg:inline" /> {how.subtitleLines[1]}
      </p>

      <HowTabs label={how.tabsLabel} labels={how.tabs} panels={{ merchant, fan }} />
    </section>
  );
}
