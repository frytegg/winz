import type { LandingLinks } from "../../lib/landing/links";

/**
 * Every link of the landing page, in one place. `null` means "not decided yet": the page then hides
 * the link or shows its button inactive ("Opening soon"), and never a dead link.
 *
 * `pnpm landing-check` lists what is still `null` and fails while anything is (outside CI). The build
 * never fails on a missing link: a deployment must not wait for a URL.
 *
 * Relative import on purpose (not `@/`): the check script loads this file outside Next.
 */
export const landingLinks: LandingLinks = {
  liveDemoUrl: "/",
  videoUrl: "https://youtu.be/8Bb5QzolJtY",
  githubUrl: "https://github.com/frytegg/winz",
  devpostUrl: "https://devpost.com/software/winz",
  repoUrl: "https://github.com/frytegg/winz/",
  teamLinks: [
    { name: "Téo", url: "https://www.linkedin.com/in/t%C3%A9o-creativ/" },
    { name: "Alexandre", url: "https://www.linkedin.com/in/alexandre-lemiere" },
  ],
  appInstallUrl: "/",
  appQrUrl: "https://winz-nu.vercel.app/",
};
