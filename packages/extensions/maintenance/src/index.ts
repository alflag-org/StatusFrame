import {
  defineExtension,
  type MaintenanceInput,
  type PublicMaintenance,
  type StatusFrameExtension
} from "@statusframe/core";

export interface MaintenanceService {
  create(input: MaintenanceInput): PublicMaintenance;
  update(id: string, update: Partial<Omit<PublicMaintenance, "id">>): PublicMaintenance;
  markInProgress(id: string): PublicMaintenance;
  complete(id: string): PublicMaintenance;
  cancel(id: string): PublicMaintenance;
  listPublic(now?: Date): PublicMaintenance[];
}

export function createMaintenanceService(initial: MaintenanceInput[] = []): MaintenanceService {
  const windows = new Map(initial.map((maintenance) => [maintenance.id, toPublicMaintenance(maintenance)]));

  return {
    create(input) {
      const maintenance = toPublicMaintenance(input);
      windows.set(maintenance.id, maintenance);
      return maintenance;
    },
    update(id, update) {
      const maintenance = requireMaintenance(windows, id);
      const next = { ...maintenance, ...update };
      windows.set(id, next);
      return next;
    },
    markInProgress(id) {
      return this.update(id, { status: "in_progress" });
    },
    complete(id) {
      return this.update(id, { status: "completed" });
    },
    cancel(id) {
      return this.update(id, { status: "cancelled" });
    },
    listPublic(now = new Date()) {
      return [...windows.values()].filter((maintenance) => {
        if (maintenance.status === "completed" || maintenance.status === "cancelled") return false;
        return new Date(maintenance.ends_at).getTime() >= now.getTime();
      });
    }
  };
}

export function maintenanceExtension(service?: MaintenanceService): StatusFrameExtension {
  return defineExtension({
    manifest: {
      name: "@statusframe/maintenance",
      kind: "feature",
      capabilities: ["maintenance"],
      cost: {
        d1ReadsPerRun: 0,
        d1WritesPerRun: 0,
        expectedCpuMs: 1
      }
    },
    projectPublic(ctx) {
      if (!ctx.config.features.maintenance.enabled) return {};
      const configured = ctx.config.maintenance
        .map(toPublicMaintenance)
        .filter((maintenance) => maintenance.status !== "completed" && maintenance.status !== "cancelled");
      return {
        scheduledMaintenance: [...configured, ...(service?.listPublic(ctx.now) ?? [])]
      };
    }
  });
}

function toPublicMaintenance(input: MaintenanceInput): PublicMaintenance {
  const maintenance: PublicMaintenance = {
    id: input.id,
    title: input.title,
    status: input.status,
    components: [...input.components],
    starts_at: input.starts_at,
    ends_at: input.ends_at
  };
  if (input.body) maintenance.body = input.body;
  return maintenance;
}

function requireMaintenance(windows: Map<string, PublicMaintenance>, id: string): PublicMaintenance {
  const maintenance = windows.get(id);
  if (!maintenance) {
    throw new Error(`Maintenance window not found: ${id}`);
  }
  return maintenance;
}
