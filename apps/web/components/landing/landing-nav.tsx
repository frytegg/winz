import { landingCopy } from "@/lib/landing/copy";

import { NavMenu } from "./nav-menu";
import { PrimaryButton } from "./primary-button";
import { Wordmark } from "./wordmark";

const { nav, hero } = landingCopy;

/**
 * The navigation (`sections/01-nav-hero.md`): the wordmark on the left, the four anchors and the main
 * button on the right. It sits over the top of the hero, as a banner of its own, and it is not sticky.
 * From 1024 px down the anchors and the button move into a menu (`NavMenu`): at 768 px they would not
 * fit on one line at a readable size.
 *
 * Sizes are the mockup's pixels times `--u`, as in the hero.
 */
export function LandingNav({ liveDemoUrl }: { liveDemoUrl: string | null }): React.JSX.Element {
  return (
    <header className="absolute inset-x-0 top-0 z-20 text-white">
      <div className="flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8 lg:px-[max(32px,calc(219*var(--u)))] lg:pt-[calc(32*var(--u))]">
        <a
          href="#top"
          aria-label={nav.homeLabel}
          className="inline-flex min-h-11 items-center rounded-md"
        >
          <Wordmark className="h-auto w-[88px] lg:w-[max(88px,calc(112*var(--u)))] lg:-translate-y-[calc(5*var(--u))]" />
        </a>

        <nav
          aria-label={nav.label}
          className="hidden items-center lg:flex lg:gap-[max(20px,calc(40*var(--u)))]"
        >
          <ul className="flex items-center gap-[max(20px,calc(40*var(--u)))]">
            {nav.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center rounded-md text-[max(15px,calc(18*var(--u)))] text-white no-underline transition-colors duration-150 hover:text-lime"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <PrimaryButton href={liveDemoUrl} tone="on-dark">
            {hero.cta}
          </PrimaryButton>
        </nav>

        <NavMenu links={nav.links}>
          <PrimaryButton href={liveDemoUrl} tone="on-dark">
            {hero.cta}
          </PrimaryButton>
        </NavMenu>
      </div>
    </header>
  );
}
