import type { Config, Incident, Maintenance, Monitor } from "./config";
import { effectiveMaintenance, project } from "./projection";
import { initialState } from "./state";
import type { MonitorRuntime, PublicSnapshot, StoredView } from "./types";

export interface ScheduledProjection {
  incidents: Incident[];
  maintenance: Maintenance[];
  snapshot: PublicSnapshot;
}

export async function hashMonitorConfigs(monitors: Monitor[]): Promise<Map<string, string>> {
  const hashes = await Promise.all(monitors.map(async monitor => {
    const encoded = new TextEncoder().encode(JSON.stringify(monitor));
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    return [monitor.id, hash] as const;
  }));
  return new Map(hashes);
}

export function restoreMonitorStates(
  monitors: Monitor[],
  savedStates: MonitorRuntime[],
  hashes: Map<string, string>
): MonitorRuntime[] {
  return monitors.map(monitor => {
    const hash = hashes.get(monitor.id)!;
    const saved = savedStates.find(state => state.monitor_id === monitor.id && state.config_hash === hash);
    return saved ?? initialState(monitor, hash);
  });
}

function mergeConfiguredRecords<T extends { id: string }>(stored: T[], configured: T[]): T[] {
  const entries = new Map(stored.map(entry => [entry.id, entry]));
  for (const entry of configured) entries.set(entry.id, entry);
  return [...entries.values()];
}

export function changedRecords<T extends { id: string }>(stored: T[], current: T[]): T[] {
  return current.filter(entry => {
    const previous = stored.find(record => record.id === entry.id);
    return JSON.stringify(previous) !== JSON.stringify(entry);
  });
}

function selectPublicIncidents(entries: Incident[]): Incident[] {
  return [...entries].sort((a, b) =>
    Number(b.status !== "resolved") - Number(a.status !== "resolved") ||
    Date.parse(b.started_at) - Date.parse(a.started_at) ||
    a.id.localeCompare(b.id)
  ).slice(0, 50);
}

function selectPublicMaintenance(entries: Maintenance[]): Maintenance[] {
  const isActive = (entry: Maintenance) => Number(["scheduled", "in_progress"].includes(entry.status));
  return [...entries].sort((a, b) =>
    isActive(b) - isActive(a) ||
    Date.parse(b.starts_at) - Date.parse(a.starts_at) ||
    a.id.localeCompare(b.id)
  ).slice(0, 50);
}

export function projectScheduledView(
  config: Config,
  view: StoredView,
  states: MonitorRuntime[],
  now: number
): ScheduledProjection {
  const componentIds = new Set(config.components.map(component => component.id));
  const incidents = mergeConfiguredRecords(view.incidents, config.incidents)
    .map(incident => ({
      ...incident,
      components: incident.components.filter(id => componentIds.has(id))
    }))
    .filter(incident => incident.components.length);
  const maintenance = mergeConfiguredRecords(view.maintenance, config.maintenance)
    .map(entry => effectiveMaintenance({
      ...entry,
      components: entry.components.filter(id => componentIds.has(id))
    }, now))
    .filter(entry => entry.components.length);

  return {
    incidents,
    maintenance,
    snapshot: project(config, states, selectPublicIncidents(incidents), selectPublicMaintenance(maintenance), now)
  };
}
