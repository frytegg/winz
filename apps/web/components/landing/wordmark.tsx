import Image from "next/image";

/** The wordmark in the app's lime (on the dark hero and menu), or in ink (on the light CTA and footer). */
export type WordmarkTone = "lime" | "ink";

const SOURCES: Record<WordmarkTone, string> = {
  lime: "/brand/logo-winz-lime.svg",
  ink: "/brand/logo-winz-dark.svg",
};

/**
 * The Winz wordmark (`public/brand/`, 83 x 26). An SVG file: the image optimizer has nothing to do with
 * it. Decorative here: the link or the heading around it carries the name. Only the lime one, in the
 * navigation of the first screen, is announced in the head: the ink one sits far below it.
 */
export function Wordmark({
  className,
  tone = "lime",
}: {
  className?: string;
  tone?: WordmarkTone;
}): React.JSX.Element {
  return (
    <Image
      src={SOURCES[tone]}
      alt=""
      width={83}
      height={26}
      unoptimized
      priority={tone === "lime"}
      className={className}
    />
  );
}
