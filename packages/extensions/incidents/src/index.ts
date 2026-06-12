import {
  defineExtension,
  type IncidentInput,
  type PublicIncident,
  type StatusFrameExtension
} from "@statusframe/core";

export interface IncidentService {
  create(input: IncidentInput): PublicIncident;
  addUpdate(id: string, update: NonNullable<PublicIncident["updates"]>[number]): PublicIncident;
  changeStatus(id: string, status: string): PublicIncident;
  resolve(id: string, resolvedAt: string): PublicIncident;
  listPublic(): PublicIncident[];
}

export function createIncidentService(initial: IncidentInput[] = []): IncidentService {
  const incidents = new Map(initial.map((incident) => [incident.id, toPublicIncident(incident)]));

  return {
    create(input) {
      const incident = toPublicIncident(input);
      incidents.set(incident.id, incident);
      return incident;
    },
    addUpdate(id, update) {
      const incident = requireIncident(incidents, id);
      const next: PublicIncident = {
        ...incident,
        status: update.status,
        updates: [...(incident.updates ?? []), update]
      };
      incidents.set(id, next);
      return next;
    },
    changeStatus(id, status) {
      const incident = requireIncident(incidents, id);
      const next = { ...incident, status };
      incidents.set(id, next);
      return next;
    },
    resolve(id, resolvedAt) {
      const incident = requireIncident(incidents, id);
      const next = { ...incident, status: "resolved", resolved_at: resolvedAt };
      incidents.set(id, next);
      return next;
    },
    listPublic() {
      return [...incidents.values()].filter((incident) => incident.status !== "resolved");
    }
  };
}

export function incidentsExtension(service?: IncidentService): StatusFrameExtension {
  return defineExtension({
    manifest: {
      name: "@statusframe/incidents",
      kind: "feature",
      capabilities: ["incidents"],
      cost: {
        d1ReadsPerRun: 0,
        d1WritesPerRun: 0,
        expectedCpuMs: 1
      }
    },
    projectPublic(ctx) {
      if (!ctx.config.features.incidents.enabled) return {};
      const configured = ctx.config.incidents.map(toPublicIncident).filter((incident) => incident.status !== "resolved");
      return {
        activeIncidents: [...configured, ...(service?.listPublic() ?? [])]
      };
    }
  });
}

function toPublicIncident(input: IncidentInput): PublicIncident {
  const incident: PublicIncident = {
    id: input.id,
    title: input.title,
    status: input.status,
    impact: input.impact,
    components: [...input.components],
    started_at: input.started_at,
    updates: [...input.updates]
  };
  if (input.body) incident.body = input.body;
  if (input.resolved_at) incident.resolved_at = input.resolved_at;
  return incident;
}

function requireIncident(incidents: Map<string, PublicIncident>, id: string): PublicIncident {
  const incident = incidents.get(id);
  if (!incident) {
    throw new Error(`Incident not found: ${id}`);
  }
  return incident;
}
