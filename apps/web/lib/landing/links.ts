/**
 * The landing page's links: their shape, and what makes a value usable. Pure, and with no `@/` import,
 * so that `scripts/landing-check.mjs` (run by tsx, outside Next) can load it.
 *
 * A link is either `null` (not decided yet) or a string the page may put in an `href`. The rule of the
 * page (00-CONTEXTE.md): a `null` is never rendered as a dead link, `#`, `[placeholder]` or a note to
 * self: the button is hidden or shown inactive with an honest label.
 */

export interface TeamLink {
  /** As it is written in the footer. */
  readonly name: string;
  readonly url: string | null;
}

export interface LandingLinks {
  /** The entry of the app, where a merchant who discovers it arrives: "Try the live demo" (three places). */
  readonly liveDemoUrl: string | null;
  /** The demo video, for the player of the Demo section and the footer. */
  readonly videoUrl: string | null;
  /** The code, for "View the code" and the footer. */
  readonly githubUrl: string | null;
  readonly devpostUrl: string | null;
  /**
   * The repository's address, for the secondary "View on GitHub" of the CTA and the "GitHub" of the footer's
   * Winz column. Its own entry on purpose: `githubUrl` still commands the primary "View the code" and the
   * footer's Project column, which wait for the repository to be public (00-CONTEXTE.md).
   */
  readonly repoUrl: string | null;
  /** The footer's people, one entry each. */
  readonly teamLinks: readonly TeamLink[];
  /** What the "Add to Home Screen" entry of the footer opens (09-install-flow.md). */
  readonly appInstallUrl: string | null;
  /**
   * What the QR codes encode: the two baked into the illustrations (the merchant card of How and the
   * CTA phone), and the install sheet's desktop panel. Absolute on purpose: a QR is scanned away from
   * this site, so a path would lead nowhere. The images are re-exported when it changes (see
   * winz-front-kit/landing/tools/build-assets.mjs), they do not read this file at runtime.
   */
  readonly appQrUrl: string | null;
}

/**
 * An absolute https URL, or a path of this site (`/`, `/start`). Not `#`, not an empty string, not a
 * protocol-relative `//host`, not `http:` or `javascript:`.
 */
const USABLE = /^(https:\/\/[^\s/]\S*|\/(?!\/)\S*)$/;

export function isUsableLink(value: unknown): value is string {
  return typeof value === "string" && USABLE.test(value.trim());
}

/** The link to render, or `null` when there is nothing to render. Never a placeholder. */
export function linkOrNull(value: string | null | undefined): string | null {
  return isUsableLink(value) ? value.trim() : null;
}

export interface MissingLink {
  /** `liveDemoUrl`, or `teamLinks.Alexandre`. */
  readonly key: string;
  /** Why it counts as missing: not set, or set to something a page cannot use. */
  readonly reason: "not set" | "not a usable link";
}

/** Every value of `links` that the page cannot use yet, in the file's order. */
export function missingLinks(links: LandingLinks): MissingLink[] {
  const out: MissingLink[] = [];
  const check = (key: string, value: string | null): void => {
    if (value === null) out.push({ key, reason: "not set" });
    else if (!isUsableLink(value)) out.push({ key, reason: "not a usable link" });
  };
  check("liveDemoUrl", links.liveDemoUrl);
  check("videoUrl", links.videoUrl);
  check("githubUrl", links.githubUrl);
  check("devpostUrl", links.devpostUrl);
  check("repoUrl", links.repoUrl);
  for (const person of links.teamLinks) check(`teamLinks.${person.name}`, person.url);
  check("appInstallUrl", links.appInstallUrl);
  check("appQrUrl", links.appQrUrl);
  return out;
}
