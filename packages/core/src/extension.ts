import type {
  ExtensionManifest,
  MonitorRunner,
  StatusFrameExtension,
  ValidationIssue
} from "./types";

const DEFAULT_COST = {
  subrequestsPerRun: 0,
  d1ReadsPerRun: 0,
  d1WritesPerRun: 0,
  notificationsPerRun: 0,
  maxConcurrency: 1,
  expectedCpuMs: 1
};

export function defineExtension(extension: StatusFrameExtension): StatusFrameExtension {
  return {
    ...extension,
    manifest: {
      ...extension.manifest,
      cost: {
        ...DEFAULT_COST,
        ...extension.manifest.cost
      }
    }
  };
}

export interface ExtensionRegistry {
  extensions: StatusFrameExtension[];
  monitorTypes: Map<string, StatusFrameExtension>;
  getMonitor(type: string): MonitorRunner | undefined;
  validate(): ValidationIssue[];
}

export function createExtensionRegistry(extensions: StatusFrameExtension[] = []): ExtensionRegistry {
  const monitorTypes = new Map<string, StatusFrameExtension>();

  for (const extension of extensions) {
    for (const type of extension.manifest.monitorTypes ?? []) {
      monitorTypes.set(type, extension);
    }
  }

  return {
    extensions,
    monitorTypes,
    getMonitor(type) {
      return monitorTypes.get(type)?.runMonitor;
    },
    validate() {
      return validateExtensionManifests(extensions);
    }
  };
}

export function validateExtensionManifests(extensions: StatusFrameExtension[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const names = new Set<string>();
  const monitorTypes = new Set<string>();

  extensions.forEach((extension, index) => {
    const path = `extensions[${index}]`;
    const manifest = extension.manifest;
    if (!manifest.name) {
      issues.push({ path: `${path}.manifest.name`, message: "Extension name is required" });
    }
    if (!manifest.kind) {
      issues.push({ path: `${path}.manifest.kind`, message: "Extension kind is required" });
    }
    if (names.has(manifest.name)) {
      issues.push({ path: `${path}.manifest.name`, message: `Duplicate extension name: ${manifest.name}` });
    }
    names.add(manifest.name);

    for (const monitorType of manifest.monitorTypes ?? []) {
      if (monitorTypes.has(monitorType)) {
        issues.push({
          path: `${path}.manifest.monitorTypes`,
          message: `Duplicate monitor type registration: ${monitorType}`
        });
      }
      monitorTypes.add(monitorType);
      if (!extension.runMonitor && !manifest.scaffold) {
        issues.push({
          path: `${path}.runMonitor`,
          message: `Monitor extension ${manifest.name} must provide runMonitor`
        });
      }
    }

    const cost = manifest.cost;
    if (cost) {
      for (const [key, value] of Object.entries(cost)) {
        if (typeof value === "number" && value < 0) {
          issues.push({ path: `${path}.manifest.cost.${key}`, message: "Cost values must be non-negative" });
        }
      }
    }
  });

  return issues;
}

export function extensionCost(extension: StatusFrameExtension | undefined) {
  return {
    ...DEFAULT_COST,
    ...(extension?.manifest.cost ?? {})
  };
}
