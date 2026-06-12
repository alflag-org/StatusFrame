import { parse as parseYaml } from "yaml";
import { z } from "zod";

const featureToggleSchema = z.object({
  enabled: z.boolean().default(false)
});

export const statusStateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  severity: z.number().int().min(0),
  public: z.boolean().default(true)
});

export const componentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  group: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  status_policy: z
    .object({
      source: z.enum(["static", "manual", "monitors", "external", "push", "custom"]),
      degraded_if: z.string().optional(),
      down_if: z.string().optional(),
      provider: z.string().optional(),
      query: z.string().optional(),
      mapping: z.record(z.string(), z.string()).optional()
    })
    .optional(),
  public_metrics: z
    .object({
      uptime: z
        .object({
          enabled: z.boolean().default(false),
          window_days: z.number().int().positive().default(90)
        })
        .optional(),
      latency: z
        .object({
          enabled: z.boolean().default(false),
          mode: z.enum(["state", "summary"]).default("state")
        })
        .optional()
    })
    .optional()
});

export const monitorSchema = z.object({
  id: z.string().min(1),
  component: z.string().min(1),
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  type: z.string().min(1),
  target: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().max(65535).optional(),
  interval: z.string().default("60s"),
  timeout: z.string().default("5s"),
  method: z.string().optional(),
  expect: z
    .object({
      status: z.number().int().min(100).max(599).optional(),
      body_contains: z.string().optional()
    })
    .optional(),
  follow_redirects: z.boolean().optional(),
  reveal: z
    .object({
      target: z.boolean().default(false),
      error: z.boolean().default(false),
      latency: z.boolean().default(false)
    })
    .optional(),
  options: z.record(z.string(), z.unknown()).optional()
});

const incidentUpdateSchema = z.object({
  status: z.string().min(1),
  body: z.string().min(1),
  created_at: z.string().min(1)
});

export const incidentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  impact: z.string().min(1),
  components: z.array(z.string().min(1)).default([]),
  body: z.string().optional(),
  started_at: z.string().min(1),
  resolved_at: z.string().optional(),
  updates: z.array(incidentUpdateSchema).default([])
});

export const maintenanceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  components: z.array(z.string().min(1)).default([]),
  body: z.string().optional(),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1)
});

export const notificationSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  url: z.string().min(1),
  events: z.array(z.string().min(1)).default([])
});

export const statusFrameConfigSchema = z.object({
  site: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    timezone: z.string().optional()
  }),
  runtime: z
    .object({
      scheduler: z
        .object({
          tick: z.string().default("60s"),
          concurrency: z.number().int().positive().default(4),
          jitter: z.boolean().default(true)
        })
        .default({ tick: "60s", concurrency: 4, jitter: true }),
      budget: z
        .object({
          max_subrequests_per_tick: z.number().int().nonnegative().default(40),
          max_d1_queries_per_tick: z.number().int().nonnegative().default(10),
          max_d1_writes_per_tick: z.number().int().nonnegative().default(100),
          max_notifications_per_tick: z.number().int().nonnegative().default(5),
          max_due_jobs_per_tick: z.number().int().nonnegative().default(40)
        })
        .default({
          max_subrequests_per_tick: 40,
          max_d1_queries_per_tick: 10,
          max_d1_writes_per_tick: 100,
          max_notifications_per_tick: 5,
          max_due_jobs_per_tick: 40
        })
    })
    .default({
      scheduler: { tick: "60s", concurrency: 4, jitter: true },
      budget: {
        max_subrequests_per_tick: 40,
        max_d1_queries_per_tick: 10,
        max_d1_writes_per_tick: 100,
        max_notifications_per_tick: 5,
        max_due_jobs_per_tick: 40
      }
    }),
  features: z
    .object({
      monitoring: featureToggleSchema.default({ enabled: false }),
      incidents: featureToggleSchema.default({ enabled: false }),
      maintenance: featureToggleSchema.default({ enabled: false }),
      notifications: featureToggleSchema.default({ enabled: false }),
      metrics: featureToggleSchema.default({ enabled: false }),
      admin_api: featureToggleSchema.default({ enabled: false }),
      storage: featureToggleSchema.default({ enabled: false }),
      status_inputs: featureToggleSchema.default({ enabled: false })
    })
    .default({
      monitoring: { enabled: false },
      incidents: { enabled: false },
      maintenance: { enabled: false },
      notifications: { enabled: false },
      metrics: { enabled: false },
      admin_api: { enabled: false },
      storage: { enabled: false },
      status_inputs: { enabled: false }
    }),
  storage: z
    .object({
      adapter: z.enum(["static", "memory", "d1", "custom"]).default("static"),
      raw_results: z
        .object({
          enabled: z.boolean().default(false)
        })
        .default({ enabled: false }),
      rollups: z
        .object({
          enabled: z.boolean().default(true),
          bucket: z.string().default("1h")
        })
        .default({ enabled: true, bucket: "1h" })
    })
    .default({
      adapter: "static",
      raw_results: { enabled: false },
      rollups: { enabled: true, bucket: "1h" }
    }),
  display: z
    .object({
      show_overall_status: z.boolean().default(true),
      show_component_groups: z.boolean().default(true),
      show_history: z.boolean().default(false),
      show_uptime_percentage: z.boolean().default(false),
      show_latency: z.boolean().default(false),
      show_incidents: z.boolean().default(true),
      show_maintenance: z.boolean().default(true)
    })
    .default({
      show_overall_status: true,
      show_component_groups: true,
      show_history: false,
      show_uptime_percentage: false,
      show_latency: false,
      show_incidents: true,
      show_maintenance: true
    }),
  status_states: z.array(statusStateSchema).min(1),
  components: z.array(componentSchema).min(1),
  monitors: z.array(monitorSchema).default([]),
  incidents: z.array(incidentSchema).default([]),
  maintenance: z.array(maintenanceSchema).default([]),
  notifications: z.array(notificationSchema).default([]),
  incident_states: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1)
      })
    )
    .default([
      { id: "investigating", label: "Investigating" },
      { id: "identified", label: "Identified" },
      { id: "monitoring", label: "Monitoring" },
      { id: "resolved", label: "Resolved" }
    ]),
  incident_impacts: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1)
      })
    )
    .default([
      { id: "minor", label: "Minor" },
      { id: "degraded", label: "Degraded" },
      { id: "major", label: "Major" },
      { id: "critical", label: "Critical" }
    ]),
  maintenance_states: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1)
      })
    )
    .default([
      { id: "scheduled", label: "Scheduled" },
      { id: "in_progress", label: "In progress" },
      { id: "completed", label: "Completed" },
      { id: "cancelled", label: "Cancelled" }
    ])
});

export type StatusFrameConfig = z.infer<typeof statusFrameConfigSchema>;
export type StatusStateConfig = z.infer<typeof statusStateSchema>;
export type ComponentConfig = z.infer<typeof componentSchema>;
export type MonitorConfig = z.infer<typeof monitorSchema>;
export type IncidentConfig = z.infer<typeof incidentSchema>;
export type MaintenanceConfig = z.infer<typeof maintenanceSchema>;
export type NotificationConfig = z.infer<typeof notificationSchema>;

export function parseStatusFrameConfig(input: unknown): StatusFrameConfig {
  return statusFrameConfigSchema.parse(input);
}

export function parseStatusFrameYaml(yaml: string): StatusFrameConfig {
  return parseStatusFrameConfig(parseYaml(yaml));
}

export function parseDurationMs(value: string): number {
  const match = value.trim().match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }
}
