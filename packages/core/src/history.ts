import { z } from "zod";
import { idSchema, publicStates, type PublicState } from "./config";
import { worst } from "./projection";
import type { PublicComponent, PublicHistory } from "./types";
import { createHistoryCalendar, maxHistoryDayMs, type HistoryDay } from "./history-calendar";

export const historyDays = 90;
const durationSchema = z.number().int().min(0).max(maxHistoryDayMs);
const bucketSchema = z.object({
  date: z.iso.date(),
  durations: z.tuple([durationSchema, durationSchema, durationSchema, durationSchema, durationSchema])
}).strict().refine(bucket => bucket.durations.reduce((sum, duration) => sum + duration, 0) <= maxHistoryDayMs);
const historySchema = z.object({
  timezone: z.string().default("UTC").refine(value => {
    try { createHistoryCalendar(value); return true; } catch { return false; }
  }),
  recorded_at: z.number().int().nonnegative(),
  components: z.array(z.object({
    id: idSchema,
    status: z.enum(publicStates),
    days: z.array(bucketSchema).max(historyDays).refine(days =>
      days.every((day, index) => index === 0 || days[index - 1]!.date < day.date)
    )
  }).strict()).max(100).refine(components => new Set(components.map(component => component.id)).size === components.length)
}).strict();

export type HistoryState = z.infer<typeof historySchema>;
type DailyBucket = z.infer<typeof bucketSchema>;

export function parseHistory(source: string): HistoryState {
  return historySchema.parse(JSON.parse(source));
}

export function historyNeedsUpdate(history: HistoryState | null, components: PublicComponent[], now: number, timezone = "UTC"): boolean {
  const calendar = createHistoryCalendar(timezone);
  return !history || history.timezone !== calendar.timezone || calendar.dateKey(history.recorded_at) !== calendar.dateKey(now) ||
    history.components.length !== components.length || components.some(component =>
      history.components.find(previous => previous.id === component.id)?.status !== component.status
    );
}

function appendSpan(days: DailyBucket[], status: PublicState, start: number, calendarDays: HistoryDay[]): void {
  const statusIndex = publicStates.indexOf(status);
  for (const day of calendarDays) {
    const duration = day.end - Math.max(start, day.start);
    if (duration <= 0) continue;
    const date = day.date;
    let bucket = days.find(day => day.date === date);
    if (!bucket) {
      bucket = { date, durations: [0, 0, 0, 0, 0] };
      days.push(bucket);
    }
    bucket.durations[statusIndex] = bucket.durations[statusIndex]! + duration;
  }
}

// A published state lasts until its next transition. Only closed spans and day
// boundaries are persisted; reads extend the open span without writing to D1.
function advanceWithCalendar(history: HistoryState | null, components: PublicComponent[], end: number, timezone: string, calendarDays: HistoryDay[]): HistoryState {
  // Closed daily totals cannot be split accurately into a different timezone.
  // Keep legacy UTC history, but start fresh when its aggregation timezone changes.
  if (history?.timezone !== timezone) history = null;
  const cutoff = calendarDays[0]!.date;
  return {
    timezone,
    recorded_at: end,
    components: components.map(component => {
      const previous = history?.components.find(entry => entry.id === component.id);
      const days = (previous?.days ?? [])
        .filter(day => day.date >= cutoff)
        .map(day => ({ date: day.date, durations: [...day.durations] as DailyBucket["durations"] }));
      if (previous && history) appendSpan(days, previous.status, history.recorded_at, calendarDays);
      return { id: component.id, status: component.status, days };
    })
  };
}

export function advanceHistory(history: HistoryState | null, components: PublicComponent[], now: number, timezone = "UTC"): HistoryState {
  const calendar = createHistoryCalendar(timezone);
  const end = Math.max(now, history?.recorded_at ?? now);
  return advanceWithCalendar(history, components, end, calendar.timezone, calendar.daysThrough(end, historyDays));
}

function presentComponentHistory(buckets: DailyBucket[], calendarDays: HistoryDay[]): PublicHistory {
  let totalKnownMs = 0;
  let totalOperationalMs = 0;
  const days: PublicHistory["days"] = calendarDays.map(({ date }) => {
    const durations = buckets.find(bucket => bucket.date === date)?.durations ?? [0, 0, 0, 0, 0];
    // Duration order follows publicStates; the final (unknown) bucket is excluded from uptime.
    const knownMs = durations.slice(0, 4).reduce((sum, duration) => sum + duration, 0);
    const operationalMs = durations[0]!;
    totalKnownMs += knownMs;
    totalOperationalMs += operationalMs;
    const recordedStates = publicStates.filter((_, stateIndex) => durations[stateIndex]! > 0);
    return {
      date,
      status: recordedStates.length ? worst(recordedStates) : "unknown",
      known_ms: knownMs,
      uptime_percent: knownMs ? operationalMs / knownMs * 100 : null
    };
  });
  return {
    days,
    uptime_percent: totalKnownMs ? totalOperationalMs / totalKnownMs * 100 : null
  };
}

export function presentHistory(history: HistoryState | null, components: PublicComponent[], now: number, timezone = "UTC"): PublicComponent[] {
  const calendar = createHistoryCalendar(timezone);
  const end = Math.max(now, history?.recorded_at ?? now);
  const days = calendar.daysThrough(end, historyDays);
  const current = advanceWithCalendar(history, components, end, calendar.timezone, days);
  return components.map(component => {
    const stored = current.components.find(entry => entry.id === component.id)!;
    return { ...component, history: presentComponentHistory(stored.days, days) };
  });
}
