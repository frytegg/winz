/**
 * The merchant journey as one continuous bar: sign-in, business, then the five steps of the
 * wizard. Eight stops, the bar is full on the review screen. The numbers shown in the titles are
 * the wizard's own (1 to 5, M6 is 4 and M7 is 5, as in the mockups); the sign-in and business
 * screens carry no number, so a title never repeats one.
 */
export const JOURNEY = [
  "email",
  "code",
  "business",
  "game",
  "promo",
  "offer",
  "margin",
  "review",
] as const;

export type JourneyStage = (typeof JOURNEY)[number];

/** 0 to 1: how far along the bar is at `stage`. */
export function journeyProgress(stage: JourneyStage): number {
  return (JOURNEY.indexOf(stage) + 1) / JOURNEY.length;
}
