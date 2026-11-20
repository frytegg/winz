import { Fragment } from "react";

import { landingCopy } from "@/lib/landing/copy";
import { nameSeparator, projectLinks, teamNames } from "@/lib/landing/footer";
import { linkOrNull, type LandingLinks } from "@/lib/landing/links";

import { FooterInstallButton } from "./footer-install-button";
import { Wordmark } from "./wordmark";

const { footer } = landingCopy;

const COLUMN_TITLE = "text-base text-landing-gray lg:text-[max(15px,calc(16*var(--u)))]";
const LINK =
  "inline-flex min-h-11 items-center rounded-md text-base text-ink underline-offset-4 hover:underline lg:text-[max(16px,calc(18*var(--u)))]";

/**
 * The footer (`sections/08-footer.md`, COPY.md section 8). Designed, not taken from a mockup: the structure of
 * the reference (a statement in two tones on the left, quiet columns of links under it, an action block on the
 * right) in Winz's own voice (Sora, black on white, no certification badges, no "Ask AI").
 *
 * A link that is not decided is NOT rendered (00-CONTEXTE.md): the Project column shows only the links that
 * exist, and not at all while there are none; a team member is a link only when they have one.
 *
 * Sizes at 1728 px are the page's pixels times `--u`, as in the other sections: the content is 1290 px wide,
 * the statement 44, the links 18.
 */
export function LandingFooter({
  links,
}: {
  links: Pick<
    LandingLinks,
    "githubUrl" | "devpostUrl" | "videoUrl" | "repoUrl" | "teamLinks" | "appInstallUrl"
  >;
}): React.JSX.Element {
  const project = projectLinks(links, footer.project);
  const names = teamNames(links.teamLinks);
  const repo = linkOrNull(links.repoUrl);

  return (
    <footer
      aria-label={footer.label}
      className="landing-footer bg-white px-5 pb-8 pt-14 md:px-8 md:pt-20 lg:px-[max(32px,calc(219*var(--u)))] lg:pb-[calc(40*var(--u))] lg:pt-[calc(112*var(--u))]"
    >
      <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
        <div>
          <Wordmark tone="ink" className="h-auto w-[88px] lg:w-[max(88px,calc(111*var(--u)))]" />
          <p className="mt-6 text-[clamp(28px,8cqw,36px)] leading-[1.2] md:text-[40px] lg:mt-[calc(36*var(--u))] lg:text-[max(36px,calc(44*var(--u)))]">
            <span className="block text-landing-gray-faint">{footer.statement.first}</span>
            <span className="block text-ink">{footer.statement.second}</span>
          </p>
        </div>

        <div className="lg:w-[calc(300*var(--u))] lg:min-w-64 lg:pt-[calc(8*var(--u))]">
          <p className="text-base font-medium text-ink">{footer.app.title}</p>
          <p className="mt-2 max-w-[22em] text-base leading-6 text-landing-gray">
            {footer.app.body}
          </p>
          <div className="mt-5">
            <FooterInstallButton url={links.appInstallUrl} />
          </div>
        </div>
      </div>

      <div className="mt-14 grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-3 lg:mt-[calc(96*var(--u))] lg:flex lg:gap-x-0">
        <div className="lg:w-[calc(300*var(--u))]">
          <p id="footer-winz" className={COLUMN_TITLE}>
            {footer.winz.title}
          </p>
          <ul aria-labelledby="footer-winz" className="mt-3 flex flex-col">
            {footer.winz.links.map((link) => (
              <li key={link.href}>
                <a href={link.href} className={LINK}>
                  {link.label}
                </a>
              </li>
            ))}
            {repo === null ? null : (
              <li>
                <a href={repo} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {footer.github}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            )}
          </ul>
        </div>

        {project.length === 0 ? null : (
          <div className="lg:w-[calc(300*var(--u))]">
            <p id="footer-project" className={COLUMN_TITLE}>
              {footer.project.title}
            </p>
            <ul aria-labelledby="footer-project" className="mt-3 flex flex-col">
              {project.map((link) => (
                <li key={link.label}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {link.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="lg:w-[calc(300*var(--u))]">
          <p id="footer-built-at" className={COLUMN_TITLE}>
            {footer.builtAt.title}
          </p>
          <ul aria-labelledby="footer-built-at" className="mt-3 flex flex-col">
            {footer.builtAt.items.map((item) => (
              <li
                key={item}
                className="inline-flex min-h-11 items-center text-base text-ink lg:text-[max(16px,calc(18*var(--u)))]"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-12 flex flex-col gap-2 border-t border-landing-line pt-6 text-sm text-landing-gray lg:mt-[calc(80*var(--u))] lg:flex-row lg:justify-between lg:gap-8 lg:text-[max(13px,calc(14*var(--u)))]">
        <p>
          {footer.legal.copyright} · {footer.legal.builtBy}{" "}
          {names.map((person, index) => (
            <Fragment key={person.name}>
              {nameSeparator(index, names.length, footer.legal.and)}
              {person.href === null ? (
                person.name
              ) : (
                <a
                  href={person.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink underline underline-offset-4"
                >
                  {person.name}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </Fragment>
          ))}
          .
        </p>
        <p className="lg:text-right">{footer.legal.note}</p>
      </div>
    </footer>
  );
}
