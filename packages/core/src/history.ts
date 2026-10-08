import { z } from "zod";
import { idSchema, publicStates } from "./config";
import { worst } from "./projection";
import type { PublicComponent, PublicHistory } from "./types";

const dayMs = 86_400_000;
export const historyDays = 90;
const duration = z.number().int().min(0).max(dayMs);
const bucketSchema = z.object({
  date: z.iso.date(),
  durations: z.tuple([duration, duration, duration, duration, duration])
}).strict().refine(v => v.durations.reduce((sum, n) => sum + n, 0) <= dayMs);
const historySchema = z.object({
  recorded_at: z.number().int().nonnegative(),
  components: z.array(z.object({
    id: idSchema, status: z.enum(publicStates), days: z.array(bucketSchema).max(historyDays)
      .refine(days => days.every((day, index) => index === 0 || days[index - 1]!.date < day.date))
  }).strict()).max(100).refine(components => new Set(components.map(v => v.id)).size === components.length)
}).strict();
export type HistoryState = z.infer<typeof historySchema>;
export function parseHistory(source: string): HistoryState { return historySchema.parse(JSON.parse(source)); }
const dayStart = (time: number) => Math.floor(time / dayMs) * dayMs;
const dateKey = (time: number) => new Date(time).toISOString().slice(0, 10);

export function historyNeedsUpdate(history: HistoryState | null, components: PublicComponent[], now: number): boolean {
  return !history || dayStart(history.recorded_at) !== dayStart(now) ||
    history.components.length !== components.length || components.some(component =>
      history.components.find(v => v.id === component.id)?.status !== component.status);
}

// A published state lasts until its next transition. Only closed spans and day
// boundaries are persisted; reads extend the open span without writing to D1.
export function advanceHistory(history: HistoryState | null, components: PublicComponent[], now: number): HistoryState {
  const end = Math.max(now, history?.recorded_at ?? now);
  const cutoff = dayStart(end) - (historyDays - 1) * dayMs;
  return {
    recorded_at: end,
    components: components.map(component => {
      const previous = history?.components.find(v => v.id === component.id);
      const days = (previous?.days ?? []).filter(v => Date.parse(v.date) >= cutoff)
        .map(v => ({ date: v.date, durations: [...v.durations] as typeof v.durations }));
      if (previous && history) {
        let start = Math.max(history.recorded_at, cutoff);
        while (start < end) {
          const stop = Math.min(dayStart(start) + dayMs, end);
          const date = dateKey(start);
          let bucket = days.find(v => v.date === date);
          if (!bucket) { bucket = { date, durations: [0, 0, 0, 0, 0] }; days.push(bucket); }
          const index = publicStates.indexOf(previous.status);
          bucket.durations[index] = bucket.durations[index]! + stop - start;
          start = stop;
        }
      }
      return { id: component.id, status: component.status, days };
    })
  };
}

export function presentHistory(history: HistoryState | null, components: PublicComponent[], now: number): PublicComponent[] {
  const current = advanceHistory(history, components, now);
  const start = dayStart(current.recorded_at) - (historyDays - 1) * dayMs;
  return components.map(component => {
    const stored = current.components.find(v => v.id === component.id)!;
    let totalKnown = 0;
    let totalOperational = 0;
    const days: PublicHistory["days"] = Array.from({ length: historyDays }, (_, index) => {
      const date = dateKey(start + index * dayMs);
      const durations = stored.days.find(v => v.date === date)?.durations ?? [0, 0, 0, 0, 0];
      const known = durations.slice(0, 4).reduce((sum, n) => sum + n, 0);
      totalKnown += known;
      totalOperational += durations[0]!;
      const statuses = publicStates.filter((_, i) => durations[i]! > 0);
      return { date, status: statuses.length ? worst(statuses) : "unknown", known_ms: known,
        uptime_percent: known ? durations[0]! / known * 100 : null };
    });
    return { ...component, history: { days, uptime_percent: totalKnown ? totalOperational / totalKnown * 100 : null } };
  });
}
