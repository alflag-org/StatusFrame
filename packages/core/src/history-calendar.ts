const dayMs = 86_400_000;
// Timezone transitions can make a local calendar day longer than 24 hours.
export const maxHistoryDayMs = 2 * dayMs;

export interface HistoryDay {
  date: string;
  start: number;
  end: number;
}

export function createHistoryCalendar(timezone: string) {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  const canonicalTimezone = formatter.resolvedOptions().timeZone;

  function dateKey(time: number): string {
    if (canonicalTimezone === "UTC") return new Date(time).toISOString().slice(0, 10);
    const parts = formatter.formatToParts(time);
    const value = (type: string) => parts.find(part => part.type === type)!.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  function startOfDay(time: number, expectedStart: number): number {
    if (canonicalTimezone === "UTC") return Math.floor(time / dayMs) * dayMs;
    const date = dateKey(time);
    if (dateKey(expectedStart) === date && dateKey(expectedStart - 1) < date) return expectedStart;

    // Find the first instant of the local date, including days whose midnight
    // is skipped by a timezone transition. Adjacent 24-hour days use the fast path.
    let low = time - 2 * dayMs;
    let high = time;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (dateKey(middle) < date) low = middle;
      else high = middle;
    }
    return high;
  }

  return {
    timezone: canonicalTimezone,
    dateKey,
    daysThrough(time: number, count: number): HistoryDay[] {
      let start = startOfDay(time, Math.floor(time / dayMs) * dayMs);
      // The current day's open span ends at the request/checkpoint time.
      const days: HistoryDay[] = [{ date: dateKey(time), start, end: time }];
      while (days.length < count) {
        const end = start;
        start = startOfDay(end - 1, end - dayMs);
        days.unshift({ date: dateKey(start), start, end });
      }
      return days;
    }
  };
}
