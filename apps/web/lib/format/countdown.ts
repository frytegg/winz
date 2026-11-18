export interface Duration {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the target is reached; every field is then 0. */
  expired: boolean;
}

/** Splits the time left until `targetIso` into days, hours, minutes and seconds. */
export function timeLeft(targetIso: string, nowMs: number): Duration {
  const target = new Date(targetIso).getTime();
  if (Number.isNaN(target)) throw new RangeError(`Not a date: ${targetIso}`);
  const left = Math.max(0, target - nowMs);
  const totalSeconds = Math.floor(left / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: left === 0,
  };
}

/** 4 → "04". Countdowns always show two digits. */
export function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
