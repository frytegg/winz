import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

/** "STATISTICS ↗": a caps heading with a round lime arrow to the full screen (MH). */
export function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  /** What the arrow opens, for screen readers. */
  linkLabel: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-promise uppercase">{title}</h2>
      <Link
        href={href}
        aria-label={linkLabel}
        className="grid size-11 shrink-0 place-items-center rounded-full transition-transform duration-150 ease-out active:scale-[0.94]"
      >
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-lime text-ink"
        >
          <ArrowUpRight className="size-4" strokeWidth={1.75} />
        </span>
      </Link>
    </div>
  );
}
