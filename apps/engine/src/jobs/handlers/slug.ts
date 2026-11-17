import type { TransactionSql } from "postgres";

import { slugSchema } from "@winz/shared";

/** Longest slug the schema accepts. */
export const SLUG_MAX_LENGTH = 64;
const SLUG_MIN_LENGTH = 3;
/** Collisions tried before giving up (a thousand promos of one bar on one team). */
const MAX_SUFFIX = 1_000;

/** Lower-case ASCII letters and digits separated by single hyphens. */
function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/['’`]/g, "") // "Joe's" → "joes", not "joe-s"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `text` cut to `max` characters, without a trailing hyphen. */
function truncate(text: string, max: number): string {
  return text.slice(0, max).replace(/-+$/, "");
}

/** Throws unless `slug` matches `slugSchema` (the shared contract of the public URL). */
function checked(slug: string): string {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) throw new RangeError(`slug "${slug}" does not match slugSchema`);
  return parsed.data;
}

/**
 * The slug a campaign would get without collisions: the merchant name, then the team or the
 * condition, e.g. "Joe's Bar" and "Texas wins" → `joes-bar-texas-wins`. Never shorter than 3 or
 * longer than 64 characters; `promo` stands in when the names have no letter or digit.
 */
export function campaignSlugBase(merchantName: string, condition: string): string {
  let base = truncate([slugify(merchantName), slugify(condition)].filter(Boolean).join("-"), 64);
  if (base.length < SLUG_MIN_LENGTH) base = base === "" ? "promo" : `${base}-promo`;
  return checked(base);
}

/** The n-th candidate for `base`: `base` itself, then `base-2`, `base-3`... within 64 characters. */
export function slugCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n.toString()}`;
  return checked(`${truncate(base, SLUG_MAX_LENGTH - suffix.length)}${suffix}`);
}

/**
 * A slug for a campaign that no campaign (and no public row) uses yet: `base`, else the first
 * free `base-<n>`. Inside the caller's transaction, under an advisory lock on `base`, so two
 * campaigns created at once with the same names cannot both take the same candidate.
 */
export async function allocateSlug(sql: TransactionSql, base: string): Promise<string> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`slug:${base}`}, 0))`;
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    const candidate = slugCandidate(base, n);
    const [row] = await sql<{ taken: boolean }[]>`
      select exists (select 1 from campaigns where slug = ${candidate})
          or exists (select 1 from live_campaigns where slug = ${candidate}) as taken
    `;
    if (row?.taken === false) return candidate;
  }
  throw new RangeError(`no free slug for "${base}" after ${MAX_SUFFIX.toString()} candidates`);
}
