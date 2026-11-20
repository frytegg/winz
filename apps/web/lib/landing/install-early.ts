/**
 * A script that runs while the page is still being parsed, and keeps Android's `beforeinstallprompt` for the
 * install sheet. Chrome fires that event once, as soon as the page is installable, and a slow phone may not
 * have hydrated the page by then: the event would be lost, and with it the one-tap install. The sheet reads
 * `window.__winzInstallPrompt` when it mounts, and listens for the event itself from then on.
 *
 * `preventDefault()` here and not later: it is what stops the browser's own install bar, which the sheet
 * replaces. No `let`, no arrow, no template string: it runs as it is, in whatever the visitor has.
 */
export const EARLY_INSTALL_PROMPT_SCRIPT =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__winzInstallPrompt=e;});";
