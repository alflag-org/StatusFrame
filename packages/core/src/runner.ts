import { Budget, BudgetExceeded } from "./budget";
import { durationMs, type Config, type Incident, type Maintenance } from "./config";
import { assertPublic, effectiveMaintenance, project, sameContent, transitionEvents } from "./projection";
import { D1Store, type Commit } from "./storage";
import { advanceState, initialState } from "./state";
import type { MonitorRuntime, NotificationEvent, RunMonitor, RuntimeIO, StoredView, TickResult } from "./types";

export interface RunnerOptions {
  config: Config;
  db: D1Database;
  io: RuntimeIO;
  runMonitor: RunMonitor;
  notify?: (event: NotificationEvent, budget: Budget) => Promise<void>;
  secrets?: string[];
}
async function hash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
}
function merge<T extends { id: string }>(stored: T[], configured: T[]): T[] {
  const entries = new Map(stored.map(v => [v.id, v]));
  for (const v of configured) entries.set(v.id, v);
  return [...entries.values()];
}
function sortIncidents(entries: Incident[]): Incident[] {
  return [...entries].sort((a, b) => Number(b.status !== "resolved") - Number(a.status !== "resolved") || Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id)).slice(0, 50);
}
function sortMaintenance(entries: Maintenance[]): Maintenance[] {
  const active = (v: Maintenance) => Number(["scheduled", "in_progress"].includes(v.status));
  return [...entries].sort((a, b) => active(b) - active(a) || Date.parse(b.starts_at) - Date.parse(a.starts_at) || a.id.localeCompare(b.id)).slice(0, 50);
}
export function createRunner(options: RunnerOptions) {
  const { config } = options;
  return {
    async getSnapshot(now = Date.now()) {
      const store = new D1Store(options.db, new Budget(config.budget));
      const snapshot = await store.loadSnapshot() ?? project(config, [], [], [], now);
      assertPublic(snapshot, config, options.secrets);
      return snapshot;
    },
    async runScheduled(now = Date.now()): Promise<TickResult> {
      const budget = new Budget(config.budget);
      const store = new D1Store(options.db, budget);
      const result: TickResult = { checked: [], skipped: [], notified: 0, usage: budget.usage };
      const hashes = new Map(await Promise.all(config.monitors.map(async v => [v.id, await hash(v)] as const)));
      const runtimeStates = (view: StoredView): MonitorRuntime[] => config.monitors.map(m => {
        const saved = view.monitors.find(v => v.monitor_id === m.id && v.config_hash === hashes.get(m.id));
        return saved ?? initialState(m, hashes.get(m.id)!);
      });
      const projection = (view: StoredView, states: MonitorRuntime[]) => {
        const currentIds = new Set(config.components.map(v => v.id));
        const incidents = merge(view.incidents, config.incidents).map(v => ({ ...v, components: v.components.filter(id => currentIds.has(id)) })).filter(v => v.components.length);
        const maintenance = merge(view.maintenance, config.maintenance).map(v => effectiveMaintenance({ ...v, components: v.components.filter(id => currentIds.has(id)) }, now)).filter(v => v.components.length);
        return { incidents, maintenance, snapshot: project(config, states, sortIncidents(incidents), sortMaintenance(maintenance), now) };
      };
      let view = await store.loadView(config.incidents.map(v => v.id), config.maintenance.map(v => v.id));
      let states = runtimeStates(view);
      let next = projection(view, states);
      assertPublic(next.snapshot, config, options.secrets);
      const due = states.filter(v => v.next_due_at <= now);
      const visibleChange = !sameContent(view.snapshot, next.snapshot);
      const domainChange = next.incidents.some(v => JSON.stringify(view.incidents.find(old => old.id === v.id)) !== JSON.stringify(v)) ||
        next.maintenance.some(v => JSON.stringify(view.maintenance.find(old => old.id === v.id)) !== JSON.stringify(v));
      if (due.length || visibleChange || domainChange || view.monitors.some(v => !hashes.has(v.monitor_id))) {
        // Reserve room for the second read, lease release, and at least one snapshot write.
        if (!budget.can({ d1_reads: 4, d1_writes: 3, subrequests: 7 })) {
          result.skipped.push(...due.map(v => v.monitor_id));
          return result;
        }
        const owner = crypto.randomUUID();
        const wallStart = Date.now();
        if (!await store.acquire(owner, wallStart)) return result;
        try {
          view = await store.loadView(config.incidents.map(v => v.id), config.maintenance.map(v => v.id));
          states = runtimeStates(view);
          next = projection(view, states);
          const changes: Commit = {
            monitors: [],
            incidents: next.incidents.filter(v => JSON.stringify(view.incidents.find(old => old.id === v.id)) !== JSON.stringify(v)),
            maintenance: next.maintenance.filter(v => JSON.stringify(view.maintenance.find(old => old.id === v.id)) !== JSON.stringify(v)),
            snapshot: null, events: [], remove_monitor_ids: view.monitors.filter(v => !hashes.has(v.monitor_id)).map(v => v.monitor_id)
          };
          const domainEvents = config.notifications.webhook ? transitionEvents(view.snapshot, next.snapshot).length : 0;
          const reservedWrites = changes.incidents.length + changes.maintenance.length + domainEvents + 2 + Number(!!changes.remove_monitor_ids?.length);
          if (!budget.can({ d1_writes: reservedWrites, subrequests: reservedWrites })) throw new BudgetExceeded("d1_writes");
          for (const state of [...states].sort((a, b) => a.next_due_at - b.next_due_at || a.monitor_id.localeCompare(b.monitor_id))) {
            if (state.next_due_at > now) continue;
            const monitor = config.monitors.find(v => v.id === state.monitor_id)!;
            // Two writes conservatively reserve the runtime row and a possible transition event.
            const jobWrites = config.notifications.webhook ? 2 : 1;
            const networkCost = monitor.type === "http" && monitor.follow_redirects ? 6 : 1;
            if (Date.now() - wallStart + durationMs(monitor.timeout) > 45_000 ||
                !budget.can({ due_jobs: 1, d1_writes: reservedWrites + (changes.monitors.length + 1) * jobWrites,
                  subrequests: reservedWrites + (changes.monitors.length + 1) * jobWrites + networkCost })) {
              result.skipped.push(monitor.id); continue;
            }
            budget.take({ due_jobs: 1 });
            let ok: boolean;
            try { ok = (await options.runMonitor(monitor, { io: options.io, budget, now })).ok; }
            catch (error) { if (error instanceof BudgetExceeded) { result.skipped.push(monitor.id); continue; } throw error; }
            const updated = advanceState(state, monitor, ok, now);
            states[states.findIndex(v => v.monitor_id === monitor.id)] = updated;
            changes.monitors.push(updated);
            result.checked.push(monitor.id);
          }
          next = projection(view, states);
          assertPublic(next.snapshot, config, options.secrets);
          if (!sameContent(view.snapshot, next.snapshot)) {
            changes.snapshot = next.snapshot;
            if (config.notifications.webhook) changes.events = transitionEvents(view.snapshot, next.snapshot);
          }
          await store.commit(owner, changes, Date.now());
        } catch (error) {
          if (budget.can({ d1_writes: 1, subrequests: 1 })) await store.release(owner);
          throw error;
        }
      }
      if (config.notifications.webhook && options.notify && budget.can({ d1_reads: 1, subrequests: 1 })) {
        const events = await store.pending(config.budget.max_notifications);
        for (const event of events) {
          if (!budget.can({ d1_writes: 1, notifications: 1, subrequests: 2 })) break;
          // Claim before delivery gives at most one attempt, including overlapping Cron invocations.
          if (!await store.claimEvent(event.id)) continue;
          try { await options.notify(event, budget); result.notified++; }
          catch { console.warn("StatusFrame webhook delivery failed"); }
        }
      }
      return result;
    }
  };
}
