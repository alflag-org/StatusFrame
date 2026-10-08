import { z } from "zod";
import { idSchema, incidentSchema, maintenanceSchema, publicStates, publicTextSchema, type Config, type Incident, type Maintenance, type PublicState } from "./config";
import type { MonitorRuntime, NotificationEvent, PublicIncident, PublicMaintenance, PublicSnapshot } from "./types";
import { maxHistoryDayMs } from "./history-calendar";

const rank: Record<PublicState, number> = {
  operational: 0, unknown: 1, degraded: 2, partial_outage: 3, major_outage: 4
};

export function worst(states: PublicState[]): PublicState {
  return states.reduce((a, b) => rank[a] >= rank[b] ? a : b, "operational");
}
export function effectiveMaintenance(entry: Maintenance, now: number): Maintenance {
  if (["cancelled", "completed"].includes(entry.status)) return entry;
  if (now >= Date.parse(entry.ends_at)) return { ...entry, status: "completed" };
  if (now >= Date.parse(entry.starts_at)) return { ...entry, status: "in_progress" };
  return { ...entry, status: "scheduled" };
}

function componentStatusFromMonitors(states: MonitorRuntime["current_state"][]): PublicState {
  if (!states.length) return "unknown";
  const downCount = states.filter(state => state === "down").length;
  if (downCount === states.length) return "major_outage";
  if (downCount > 0) return "partial_outage";
  if (states.includes("unknown")) return "unknown";
  return "operational";
}

function projectIncident(incident: Incident): PublicIncident {
  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    impact: incident.impact,
    components: [...incident.components],
    started_at: incident.started_at,
    resolved_at: incident.resolved_at,
    updates: incident.updates.map(update => ({
      status: update.status, body: update.body, created_at: update.created_at
    }))
  };
}

function projectMaintenance(entry: Maintenance, now: number): PublicMaintenance {
  const maintenance = effectiveMaintenance(entry, now);
  return {
    id: maintenance.id,
    title: maintenance.title,
    status: maintenance.status,
    components: [...maintenance.components],
    starts_at: maintenance.starts_at,
    ends_at: maintenance.ends_at,
    body: maintenance.body
  };
}

export function project(
  config: Config,
  states: MonitorRuntime[],
  incidents: Incident[],
  maintenance: Maintenance[],
  now: number
): PublicSnapshot {
  const monitorStates = new Map(states.map(state => [state.monitor_id, state.current_state]));
  const publicIncidents = incidents.map(projectIncident);
  const components = config.components.map(component => {
    const componentMonitorStates = config.monitors
      .filter(monitor => monitor.component === component.id)
      .map(monitor => monitorStates.get(monitor.id) ?? "unknown");
    const activeImpacts = publicIncidents
      .filter(incident => incident.status !== "resolved" && incident.components.includes(component.id))
      .map(incident => incident.impact);
    return {
      id: component.id,
      name: component.name,
      ...(component.description ? { description: component.description } : {}),
      status: worst([componentStatusFromMonitors(componentMonitorStates), ...activeImpacts])
    };
  });
  return {
    site: {
      name: config.site.name,
      ...(config.site.description ? { description: config.site.description } : {}),
      timezone: config.site.timezone,
      language: config.site.language,
      status: worst(components.map(component => component.status)),
      updated_at: new Date(now).toISOString()
    },
    components,
    incidents: publicIncidents,
    maintenance: maintenance.map(entry => projectMaintenance(entry, now))
  };
}

const publicHistorySchema = z.object({
  days: z.array(z.object({
    date: z.iso.date(),
    status: z.enum(publicStates),
    known_ms: z.number().int().min(0).max(maxHistoryDayMs),
    uptime_percent: z.number().min(0).max(100).nullable()
  }).strict()).length(90),
  uptime_percent: z.number().min(0).max(100).nullable()
}).strict();

const publicSchema = z.object({
  site: z.object({
    name: publicTextSchema,
    description: publicTextSchema.optional(),
    timezone: z.string(),
    language: z.enum(["en", "ja"]).optional(),
    status: z.enum(publicStates),
    updated_at: z.iso.datetime()
  }).strict(),
  components: z.array(z.object({
    id: idSchema,
    name: publicTextSchema,
    description: publicTextSchema.optional(),
    status: z.enum(publicStates),
    history: publicHistorySchema.optional()
  }).strict()),
  incidents: z.array(incidentSchema),
  maintenance: z.array(maintenanceSchema)
}).strict();

export function assertPublic(snapshot: unknown, config: Config, secrets: string[] = []): asserts snapshot is PublicSnapshot {
  publicSchema.parse(snapshot);
  const forbidden = [
    ...config.monitors.flatMap(v => v.type === "http" ? [v.id, v.url, new URL(v.url).hostname] : [v.id, v.type === "dns" ? v.name : v.host]),
    ...secrets.filter(Boolean)
  ];
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      for (const privateValue of forbidden) {
        const escaped = privateValue.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(lower)) throw new Error("Private data in public projection");
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(snapshot);
  const ids = new Set(config.components.map(v => v.id));
  if ((snapshot as PublicSnapshot).components.some(v => !ids.has(v.id)) ||
      [...(snapshot as PublicSnapshot).incidents, ...(snapshot as PublicSnapshot).maintenance].some(v => v.components.some(id => !ids.has(id)))) {
    throw new Error("Unknown public component");
  }
}
export function sameContent(a: PublicSnapshot | null, b: PublicSnapshot): boolean {
  return !!a && JSON.stringify({ ...a, site: { ...a.site, updated_at: "" } }) === JSON.stringify({ ...b, site: { ...b.site, updated_at: "" } });
}
export function transitionEvents(previous: PublicSnapshot | null, current: PublicSnapshot): NotificationEvent[] {
  if (!previous) return [];
  const events: NotificationEvent[] = [];
  const add = (type: NotificationEvent["type"], id: string, before: string | null, status: string) => events.push({
    id: crypto.randomUUID(),
    type,
    subject_id: id,
    previous_status: before,
    status,
    created_at: current.site.updated_at
  });
  for (const component of current.components) {
    const before = previous.components.find(v => v.id === component.id);
    if (before && before.status !== component.status) add("component_status_changed", component.id, before.status, component.status);
  }
  for (const incident of current.incidents) {
    const before = previous.incidents.find(v => v.id === incident.id);
    if (!before) add("incident_created", incident.id, null, incident.status);
    else if (JSON.stringify(before) !== JSON.stringify(incident)) {
      const type = incident.status === "resolved" && before.status !== "resolved"
        ? "incident_resolved"
        : "incident_updated";
      add(type, incident.id, before.status, incident.status);
    }
  }
  for (const maintenance of current.maintenance) {
    const before = previous.maintenance.find(v => v.id === maintenance.id);
    if (before && JSON.stringify(before) === JSON.stringify(maintenance)) continue;
    const types = {
      scheduled: "maintenance_scheduled",
      in_progress: "maintenance_started",
      completed: "maintenance_completed",
      cancelled: "maintenance_cancelled"
    } as const;
    const type = before?.status === maintenance.status ? "maintenance_updated" : types[maintenance.status];
    add(type, maintenance.id, before?.status ?? null, maintenance.status);
  }
  return events;
}
