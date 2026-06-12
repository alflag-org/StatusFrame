import type { StatusFrameConfig } from "@statusframe/schema";
import { parseDurationMs } from "@statusframe/schema";
import type { ExtensionRegistry } from "./extension";
import type { ValidationIssue, ValidationResult } from "./types";

const INLINE_SECRET_PATTERN =
  /\b(?:https:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)\/|xox[baprs]-|gh[pousr]_|sk-[A-Za-z0-9_-]{20,}|Bearer\s+|password=|token=|secret=)/i;
const ENV_PLACEHOLDER_PATTERN = /^\$\{[A-Z_][A-Z0-9_]*\}$/;

export function validateConfig(config: StatusFrameConfig, registry: ExtensionRegistry): ValidationResult {
  const issues: ValidationIssue[] = [...registry.validate()];

  collectDuplicateIds(config.status_states, "status_states", issues);
  collectDuplicateIds(config.components, "components", issues);
  collectDuplicateIds(config.monitors, "monitors", issues);
  collectDuplicateIds(config.incidents, "incidents", issues);
  collectDuplicateIds(config.maintenance, "maintenance", issues);
  collectDuplicateIds(config.notifications, "notifications", issues);

  const statusIds = new Set(config.status_states.map((state) => state.id));
  const componentIds = new Set(config.components.map((component) => component.id));
  const incidentStateIds = new Set(config.incident_states.map((state) => state.id));
  const incidentImpactIds = new Set(config.incident_impacts.map((impact) => impact.id));
  const maintenanceStateIds = new Set(config.maintenance_states.map((state) => state.id));

  config.components.forEach((component, index) => {
    if (component.status && !statusIds.has(component.status)) {
      issues.push({
        path: `components[${index}].status`,
        message: `Unknown status state: ${component.status}`
      });
    }
    if (!component.status && !component.status_policy) {
      issues.push({
        path: `components[${index}]`,
        message: "Component must define status or status_policy"
      });
    }
  });

  if (!config.features.monitoring.enabled && config.monitors.length > 0) {
    issues.push({
      path: "monitors",
      message: "Monitoring is disabled but monitors are configured"
    });
  }

  config.monitors.forEach((monitor, index) => {
    if (!componentIds.has(monitor.component)) {
      issues.push({
        path: `monitors[${index}].component`,
        message: `Unknown component reference: ${monitor.component}`
      });
    }
    if (!registry.monitorTypes.has(monitor.type)) {
      issues.push({
        path: `monitors[${index}].type`,
        message: `Unknown monitor type: ${monitor.type}`
      });
    }
    validateDuration(monitor.interval, `monitors[${index}].interval`, issues);
    validateDuration(monitor.timeout, `monitors[${index}].timeout`, issues);
  });

  if (!config.features.incidents.enabled && config.incidents.length > 0) {
    issues.push({
      path: "incidents",
      message: "Incidents are disabled but incidents are configured"
    });
  }
  config.incidents.forEach((incident, index) => {
    if (!incidentStateIds.has(incident.status)) {
      issues.push({
        path: `incidents[${index}].status`,
        message: `Unknown incident state: ${incident.status}`
      });
    }
    if (!incidentImpactIds.has(incident.impact)) {
      issues.push({
        path: `incidents[${index}].impact`,
        message: `Unknown incident impact: ${incident.impact}`
      });
    }
    incident.components.forEach((componentId) => {
      if (!componentIds.has(componentId)) {
        issues.push({
          path: `incidents[${index}].components`,
          message: `Unknown component reference: ${componentId}`
        });
      }
    });
  });

  if (!config.features.maintenance.enabled && config.maintenance.length > 0) {
    issues.push({
      path: "maintenance",
      message: "Maintenance is disabled but maintenance windows are configured"
    });
  }
  config.maintenance.forEach((maintenance, index) => {
    if (!maintenanceStateIds.has(maintenance.status)) {
      issues.push({
        path: `maintenance[${index}].status`,
        message: `Unknown maintenance state: ${maintenance.status}`
      });
    }
    maintenance.components.forEach((componentId) => {
      if (!componentIds.has(componentId)) {
        issues.push({
          path: `maintenance[${index}].components`,
          message: `Unknown component reference: ${componentId}`
        });
      }
    });
  });

  if (!config.features.notifications.enabled && config.notifications.length > 0) {
    issues.push({
      path: "notifications",
      message: "Notifications are disabled but notification providers are configured"
    });
  }
  config.notifications.forEach((notification, index) => {
    if (INLINE_SECRET_PATTERN.test(notification.url) && !ENV_PLACEHOLDER_PATTERN.test(notification.url)) {
      issues.push({
        path: `notifications[${index}].url`,
        message: "Notification URLs must come from environment variables or secret bindings"
      });
    }
  });

  return { ok: issues.length === 0, issues };
}

function collectDuplicateIds(items: Array<{ id: string }>, path: string, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      issues.push({ path, message: `Duplicate id: ${item.id}` });
    }
    seen.add(item.id);
  }
}

function validateDuration(value: string, path: string, issues: ValidationIssue[]): void {
  try {
    parseDurationMs(value);
  } catch (error) {
    issues.push({
      path,
      message: error instanceof Error ? error.message : "Invalid duration"
    });
  }
}
