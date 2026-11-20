import { linkOrNull } from "@/lib/landing/links";

/** What a primary button turns into, given what it was handed. */
export type PrimaryButtonKind =
  { kind: "inactive" } | { kind: "link"; href: string; external: boolean } | { kind: "action" };

/**
 * One rule for the three shapes of the button:
 *  - `href` is a usable link: a link. An absolute URL is external (a new tab) unless `external` says
 *    otherwise; a path of this site is not.
 *  - `href` is `null` or unusable (`#`, ``, `http:`): INACTIVE. Never a link to `#`.
 *  - no `href` but an action (`onClick`): a button that does something (the install sheet).
 *  - nothing at all, or `unavailable`: INACTIVE. A button that does nothing, silently, is worse than
 *    one that says "Opening soon".
 */
export function resolvePrimaryButton(input: {
  href?: string | null;
  external?: boolean;
  unavailable?: boolean;
  hasAction?: boolean;
}): PrimaryButtonKind {
  if (input.unavailable === true) return { kind: "inactive" };
  if (input.href !== undefined) {
    const href = linkOrNull(input.href);
    if (href === null) return { kind: "inactive" };
    return { kind: "link", href, external: input.external ?? href.startsWith("https://") };
  }
  return input.hasAction === true ? { kind: "action" } : { kind: "inactive" };
}
