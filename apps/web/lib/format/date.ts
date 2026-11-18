/**
 * US dates and times, in the viewer's own time zone. The API sends UTC ISO strings; the viewer
 * reads "7:00 PM". Call these from client components (after hydration): a server renders in its
 * own time zone and would not match.
 */

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "long" });

function parse(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a date: ${iso}`);
  return date;
}

/** "7:00 PM" */
export function formatTime(iso: string): string {
  return TIME.format(parse(iso));
}

/** "Nov 22" */
export function formatShortDate(iso: string): string {
  return SHORT_DATE.format(parse(iso));
}

/** "Sat 2:25 PM" */
export function formatWeekdayTime(iso: string): string {
  const date = parse(iso);
  return `${WEEKDAY.format(date)} ${TIME.format(date)}`;
}

/** "Saturday, Nov 21 · 2:30 PM" */
export function formatLongDateTime(iso: string): string {
  const date = parse(iso);
  return `${WEEKDAY_LONG.format(date)}, ${SHORT_DATE.format(date)} · ${TIME.format(date)}`;
}

/** The three groups of the game list (M3). */
export type StartGroup = "tonight" | "weekend" | "later";

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "Tonight" is today and after, "This weekend" is the next Saturday or Sunday (or the current
 * one), "Later" is anything else.
 */
export function startGroup(iso: string, now: Date): StartGroup {
  const start = parse(iso);
  const today = startOfDay(now);
  const day = startOfDay(start);
  if (day === today) return "tonight";
  const dayOfWeek = start.getDay();
  const daysAway = Math.round((day - today) / 86_400_000);
  const isWeekend = dayOfWeek === 6 || dayOfWeek === 0;
  if (isWeekend && daysAway > 0 && daysAway <= 7) return "weekend";
  return "later";
}
