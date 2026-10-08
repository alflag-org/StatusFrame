import { z } from "zod";
import { idSchema, publicStates, type PublicState } from "./config";
import { worst } from "./projection";
import type { PublicComponent, PublicHistory } from "./types";

const dayMs = 86_400_000;
export const historyDays = 90;
const durationSchema = z.number().int().min(0).max(dayMs);
const bucketSchema = z.object({
  date: z.iso.date(),
  durations: z.tuple([durationSchema, durationSchema, durationSchema, durationSchema, durationSchema])
}).strict().refine(bucket => bucket.durations.reduce((sum, duration) => sum + duration, 0) <= dayMs);
const historySchema = z.object({
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

function startOfUtcDay(time: number): number {
  return Math.floor(time / dayMs) * dayMs;
}

function utcDateKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function historyNeedsUpdate(history: HistoryState | null, components: PublicComponent[], now: number): boolean {
  return !history || startOfUtcDay(history.recorded_at) !== startOfUtcDay(now) ||
    history.components.length !== components.length || components.some(component =>
      history.components.find(previous => previous.id === component.id)?.status !== component.status
    );
}

function appendSpan(days: DailyBucket[], status: PublicState, start: number, end: number): void {
  const statusIndex = publicStates.indexOf(status);
  while (start < end) {
    const stop = Math.min(startOfUtcDay(start) + dayMs, end);
    const date = utcDateKey(start);
    let bucket = days.find(day => day.date === date);
    if (!bucket) {
      bucket = { date, durations: [0, 0, 0, 0, 0] };
      days.push(bucket);
    }
    bucket.durations[statusIndex] = bucket.durations[statusIndex]! + stop - start;
    start = stop;
  }
}

// A published state lasts until its next transition. Only closed spans and day
// boundaries are persisted; reads extend the open span without writing to D1.
export function advanceHistory(history: HistoryState | null, components: PublicComponent[], now: number): HistoryState {
  const end = Math.max(now, history?.recorded_at ?? now);
  const cutoff = startOfUtcDay(end) - (historyDays - 1) * dayMs;
  return {
    recorded_at: end,
    components: components.map(component => {
      const previous = history?.components.find(entry => entry.id === component.id);
      const days = (previous?.days ?? [])
        .filter(day => Date.parse(day.date) >= cutoff)
        .map(day => ({ date: day.date, durations: [...day.durations] as DailyBucket["durations"] }));
      if (previous && history) {
        appendSpan(days, previous.status, Math.max(history.recorded_at, cutoff), end);
      }
      return { id: component.id, status: component.status, days };
    })
  };
}

function presentComponentHistory(buckets: DailyBucket[], start: number): PublicHistory {
  let totalKnownMs = 0;
  let totalOperationalMs = 0;
  const days: PublicHistory["days"] = Array.from({ length: historyDays }, (_, index) => {
    const date = utcDateKey(start + index * dayMs);
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

export function presentHistory(history: HistoryState | null, components: PublicComponent[], now: number): PublicComponent[] {
  const current = advanceHistory(history, components, now);
  const start = startOfUtcDay(current.recorded_at) - (historyDays - 1) * dayMs;
  return components.map(component => {
    const stored = current.components.find(entry => entry.id === component.id)!;
    return { ...component, history: presentComponentHistory(stored.days, start) };
  });
}
