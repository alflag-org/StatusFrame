import { z } from "zod";
import { idSchema, incidentSchema, maintenanceSchema, publicStates, publicTextSchema, type Config, type Incident, type Maintenance, type PublicState } from "./config";
import type { MonitorRuntime, NotificationEvent, PublicSnapshot } from "./types";

const rank: Record<PublicState, number> = { operational: 0, unknown: 1, degraded: 2, partial_outage: 3, major_outage: 4 };
export function worst(states: PublicState[]): PublicState {
  return states.reduce((a, b) => rank[a] >= rank[b] ? a : b, "operational");
}
export function effectiveMaintenance(entry: Maintenance, now: number): Maintenance {
  if (["cancelled", "completed"].includes(entry.status)) return entry;
  if (now >= Date.parse(entry.ends_at)) return { ...entry, status: "completed" };
  if (now >= Date.parse(entry.starts_at)) return { ...entry, status: "in_progress" };
  return { ...entry, status: "scheduled" };
}
export function project(config: Config, states: MonitorRuntime[], incidents: Incident[], maintenance: Maintenance[], now: number): PublicSnapshot {
  const byId = new Map(states.map(v => [v.monitor_id, v.current_state]));
  const publicIncidents = incidents.map(v => ({
    id: v.id, title: v.title, status: v.status, impact: v.impact, components: [...v.components],
    started_at: v.started_at, resolved_at: v.resolved_at,
    updates: v.updates.map(u => ({ status: u.status, body: u.body, created_at: u.created_at }))
  }));
  const components = config.components.map(component => {
    const monitors = config.monitors.filter(v => v.component === component.id).map(v => byId.get(v.id) ?? "unknown");
    const down = monitors.filter(v => v === "down").length;
    let status: PublicState = !monitors.length ? "unknown" : down === monitors.length ? "major_outage" :
      down > 0 ? "partial_outage" : monitors.includes("unknown") ? "unknown" : "operational";
    status = worst([status, ...publicIncidents.filter(v => v.status !== "resolved" && v.components.includes(component.id)).map(v => v.impact)]);
    return { id: component.id, name: component.name, ...(component.description ? { description: component.description } : {}), status };
  });
  return {
    site: { name: config.site.name, ...(config.site.description ? { description: config.site.description } : {}),
      timezone: config.site.timezone, status: worst(components.map(v => v.status)), updated_at: new Date(now).toISOString() },
    components, incidents: publicIncidents,
    maintenance: maintenance.map(entry => {
      const v = effectiveMaintenance(entry, now);
      return { id: v.id, title: v.title, status: v.status, components: [...v.components], starts_at: v.starts_at, ends_at: v.ends_at, body: v.body };
    })
  };
}
const publicSchema = z.object({
  site: z.object({ name: publicTextSchema, description: publicTextSchema.optional(), timezone: z.string(), status: z.enum(publicStates), updated_at: z.iso.datetime() }).strict(),
  components: z.array(z.object({ id: idSchema, name: publicTextSchema, description: publicTextSchema.optional(), status: z.enum(publicStates) }).strict()),
  incidents: z.array(incidentSchema), maintenance: z.array(maintenanceSchema)
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
    id: crypto.randomUUID(), type, subject_id: id, previous_status: before, status, created_at: current.site.updated_at
  });
  for (const component of current.components) {
    const before = previous.components.find(v => v.id === component.id);
    if (before && before.status !== component.status) add("component_status_changed", component.id, before.status, component.status);
  }
  for (const incident of current.incidents) {
    const before = previous.incidents.find(v => v.id === incident.id);
    if (!before) add("incident_created", incident.id, null, incident.status);
    else if (JSON.stringify(before) !== JSON.stringify(incident)) add(incident.status === "resolved" && before.status !== "resolved" ? "incident_resolved" : "incident_updated", incident.id, before.status, incident.status);
  }
  for (const maintenance of current.maintenance) {
    const before = previous.maintenance.find(v => v.id === maintenance.id);
    if (before && JSON.stringify(before) === JSON.stringify(maintenance)) continue;
    const types = { scheduled: "maintenance_scheduled", in_progress: "maintenance_started", completed: "maintenance_completed", cancelled: "maintenance_cancelled" } as const;
    add(before?.status === maintenance.status ? "maintenance_updated" : types[maintenance.status], maintenance.id, before?.status ?? null, maintenance.status);
  }
  return events;
}
