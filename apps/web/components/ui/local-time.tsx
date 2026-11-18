"use client";

import { formatLongDateTime, formatShortDate, formatTime, formatWeekdayTime } from "@/lib/format";
import { useHydrated } from "@/lib/hooks";

type Style = "time" | "date" | "weekday-time" | "long";

const formatters: Record<Style, (iso: string) => string> = {
  time: formatTime,
  date: formatShortDate,
  "weekday-time": formatWeekdayTime,
  long: formatLongDateTime,
};

/**
 * A date or time in the viewer's time zone. The server does not know it, so this renders the
 * placeholder first and the real value after hydration (no mismatch, no flash of a wrong hour).
 */
export function LocalTime({
  iso,
  style,
  placeholder = "--",
  className,
}: {
  iso: string;
  style: Style;
  placeholder?: string;
  className?: string;
}): React.JSX.Element {
  const hydrated = useHydrated();
  return (
    <time dateTime={iso} className={className}>
      {hydrated ? formatters[style](iso) : placeholder}
    </time>
  );
}
