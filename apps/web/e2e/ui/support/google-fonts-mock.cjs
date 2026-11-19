/**
 * What `next/font/google` gets instead of Google Fonts while the browser suite runs: the dev server
 * the suite starts reads this file (NEXT_FONT_GOOGLE_MOCKED_RESPONSES, in playwright.config.ts) and
 * downloads nothing. CommonJS because Next.js loads it with `require`.
 *
 * The answer names no file to download: `local()` only, so the browser uses the Sora installed on
 * the machine if there is one, and the fallback font otherwise. The second `local()` name is the
 * marker the suite looks for (harness.spec.ts) to prove that this answer, and not Google's, is
 * the one the screens got.
 */

const CSS = `/* latin */
@font-face {
  font-family: 'Sora';
  font-style: normal;
  font-weight: 100 800;
  font-display: swap;
  src: local('Sora'), local('e2e-ui-no-network');
}
`;

/** Every URL `next/font/google` may ask for Sora in this app (app/layout.tsx). */
module.exports = {
  "https://fonts.googleapis.com/css2?family=Sora:wght@100..800&display=swap": CSS,
};
