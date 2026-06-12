import type { StatusFrameConfig, StatusStateConfig } from "@statusframe/schema";
import type {
  ComponentState,
  NormalizedMonitorState,
  PublicComponent,
  PublicProjectionPatch,
  PublicSnapshot
} from "./types";

export function aggregateComponentStates(options: {
  config: StatusFrameConfig;
  monitorStates?: NormalizedMonitorState[];
  now: Date;
}): ComponentState[] {
  const { config, monitorStates = [], now } = options;
  const updatedAt = now.toISOString();

  return config.components.map((component) => {
    const source = component.status_policy?.source ?? "static";
    if (source !== "monitors") {
      return {
        componentId: component.id,
        status: component.status ?? fallbackState(config.status_states).id,
        updatedAt
      };
    }

    const requiredStates = monitorStates.filter((state) => state.componentId === component.id && state.required);
    if (requiredStates.length === 0) {
      return {
        componentId: component.id,
        status: stateByPreferredId(config.status_states, "unknown")?.id ?? fallbackState(config.status_states).id,
        updatedAt
      };
    }

    const failed = requiredStates.filter((state) => !state.ok);
    if (failed.length === 0) {
      const state: ComponentState = {
        componentId: component.id,
        status: bestState(config.status_states).id,
        updatedAt
      };
      const latencyState = aggregateLatency(requiredStates);
      if (latencyState) state.latencyState = latencyState;
      return state;
    }

    const status =
      failed.length === requiredStates.length
        ? stateByPreferredId(config.status_states, "major_outage")?.id ??
          stateByPreferredId(config.status_states, "offline")?.id ??
          worstState(config.status_states).id
        : stateByPreferredId(config.status_states, "degraded")?.id ?? middleState(config.status_states).id;

    const state: ComponentState = {
      componentId: component.id,
      status,
      updatedAt
    };
    const latencyState = aggregateLatency(requiredStates);
    if (latencyState) state.latencyState = latencyState;
    return state;
  });
}

export function generatePublicSnapshot(options: {
  config: StatusFrameConfig;
  componentStates?: ComponentState[];
  monitorStates?: NormalizedMonitorState[];
  patches?: PublicProjectionPatch[];
  now: Date;
}): PublicSnapshot {
  const { config, now, monitorStates = [], patches = [] } = options;
  const componentStates =
    options.componentStates ?? aggregateComponentStates({ config, monitorStates, now });
  const statesByComponent = new Map(componentStates.map((state) => [state.componentId, state]));
  const componentMetrics = mergeComponentMetrics(patches);

  const components: PublicComponent[] = config.components.map((component) => {
    const state = statesByComponent.get(component.id);
    const publicComponent: PublicComponent = {
      id: component.id,
      name: component.name,
      status: state?.status ?? component.status ?? fallbackState(config.status_states).id
    };
    if (component.group) publicComponent.group = component.group;
    if (component.description) publicComponent.description = component.description;
    const metrics = componentMetrics.get(component.id);
    if (metrics) publicComponent.metrics = metrics;
    return publicComponent;
  });

  const siteStatus = overallStatus(components, config.status_states);
  const snapshot: PublicSnapshot = {
    site: {
      name: config.site.name,
      status: siteStatus,
      updated_at: now.toISOString()
    },
    components,
    active_incidents: patches.flatMap((patch) => patch.activeIncidents ?? []),
    scheduled_maintenance: patches.flatMap((patch) => patch.scheduledMaintenance ?? [])
  };

  if (config.site.description) snapshot.site.description = config.site.description;
  if (config.site.timezone) snapshot.site.timezone = config.site.timezone;

  return snapshot;
}

export function overallStatus(components: PublicComponent[], states: StatusStateConfig[]): string {
  const statesById = new Map(states.map((state) => [state.id, state]));
  let selected = bestState(states);

  for (const component of components) {
    const state = statesById.get(component.status);
    if (state && state.severity > selected.severity) {
      selected = state;
    }
  }

  return selected.id;
}

function bestState(states: StatusStateConfig[]): StatusStateConfig {
  return [...states].sort((a, b) => a.severity - b.severity || a.id.localeCompare(b.id))[0] ?? {
    id: "operational",
    label: "Operational",
    severity: 0,
    public: true
  };
}

function worstState(states: StatusStateConfig[]): StatusStateConfig {
  return [...states].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id))[0] ?? bestState(states);
}

function middleState(states: StatusStateConfig[]): StatusStateConfig {
  const sorted = [...states].sort((a, b) => a.severity - b.severity || a.id.localeCompare(b.id));
  return sorted[Math.min(1, sorted.length - 1)] ?? bestState(states);
}

function fallbackState(states: StatusStateConfig[]): StatusStateConfig {
  return stateByPreferredId(states, "unknown") ?? bestState(states);
}

function stateByPreferredId(states: StatusStateConfig[], id: string): StatusStateConfig | undefined {
  return states.find((state) => state.id === id && state.public !== false);
}

function aggregateLatency(states: NormalizedMonitorState[]): string | undefined {
  const hinted = states.map((state) => state.publicHint?.latencyState).find(Boolean);
  if (hinted) return hinted;

  const samples = states.map((state) => state.latencyMs).filter((value): value is number => typeof value === "number");
  if (samples.length === 0) return undefined;
  const max = Math.max(...samples);
  if (max < 500) return "normal";
  if (max < 1500) return "elevated";
  return "high";
}

function mergeComponentMetrics(patches: PublicProjectionPatch[]) {
  const merged = new Map<string, NonNullable<PublicProjectionPatch["componentMetrics"]>[string]>();
  for (const patch of patches) {
    for (const [componentId, metrics] of Object.entries(patch.componentMetrics ?? {})) {
      merged.set(componentId, {
        ...merged.get(componentId),
        ...metrics
      });
    }
  }
  return merged;
}
