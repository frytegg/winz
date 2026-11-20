import { Logo } from "./logo";

/**
 * The splash (screen 00): the big "W" drawn in thin lime lines at 15% behind the lime glyph. Shown
 * while the app checks the stored session and as the root `loading.tsx`.
 */
export function Splash(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-splash=""
      className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink"
    >
      <img
        src="/brand/icon-winz-background.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-x-0 top-1/2 w-full -translate-y-1/2 opacity-[0.15]"
      />
      <Logo variant="glyph" className="relative h-12 animate-pulse-dot" />
    </div>
  );
}
