/**
 * The success criteria of SPEC section 17 that the browser suite measures. Each limit is strict, as
 * the specification words it: « moins de 2 minutes et moins de 15 taps » (criterion 1), « en moins
 * de 30 secondes » (criterion 2). A flow of exactly 15 taps misses criterion 1. (The brief of this
 * suite said « at most 15 »: the specification is the reference.)
 */
export const CRITERIA = {
  onboardingTaps: 15,
  onboardingSeconds: 120,
  scanToTicketSeconds: 30,
} as const;

/** Whether a measured value meets a limit of SPEC 17: strictly under it. */
export function meetsLimit(value: number, limit: number): boolean {
  return value < limit;
}
