import { linkOrNull, type LandingLinks, type TeamLink } from "./links";

/** A link of the footer's Project column: its label, and an address a page may put in an `href`. */
export interface FooterLink {
  readonly label: string;
  readonly href: string;
}

/**
 * The Project column: GitHub, Devpost and the demo video, in that order, and ONLY those that are decided
 * (a `null` is never rendered as a dead link). The column itself is not rendered when it is
 * empty: a title over nothing is a dead end too.
 */
export function projectLinks(
  links: Pick<LandingLinks, "githubUrl" | "devpostUrl" | "videoUrl">,
  labels: { github: string; devpost: string; video: string },
): FooterLink[] {
  const wanted: readonly (readonly [string, string | null])[] = [
    [labels.github, links.githubUrl],
    [labels.devpost, links.devpostUrl],
    [labels.video, links.videoUrl],
  ];
  const out: FooterLink[] = [];
  for (const [label, url] of wanted) {
    const href = linkOrNull(url);
    if (href !== null) out.push({ label, href });
  }
  return out;
}

/** One name of "Built by Téo and Alexandre", with its link when it has a usable one. */
export interface TeamName {
  readonly name: string;
  readonly href: string | null;
}

export function teamNames(team: readonly TeamLink[]): TeamName[] {
  return team.map((person) => ({ name: person.name, href: linkOrNull(person.url) }));
}

/**
 * The words between the names of a list: nothing before the first, " and " before the last, ", " between
 * the others ("A", "A and B", "A, B and C"). The separator that comes BEFORE the name at `index`.
 */
export function nameSeparator(index: number, count: number, and: string): string {
  if (index === 0) return "";
  return index === count - 1 ? ` ${and} ` : ", ";
}
