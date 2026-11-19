import Image from "next/image";

/**
 * The Winz wordmark in the app's lime (`public/brand/logo-winz-lime.svg`, 83 x 26). An SVG file: the
 * image optimizer has nothing to do with it. Decorative here: the link that holds it carries the name.
 */
export function Wordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <Image
      src="/brand/logo-winz-lime.svg"
      alt=""
      width={83}
      height={26}
      unoptimized
      priority
      className={className}
    />
  );
}
