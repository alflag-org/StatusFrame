import type { StatusFrameConfig } from "@statusframe/core";

export const statusFrameConfig: StatusFrameConfig = {
  site: {
    name: "Example Status",
    description: "Simple public status page",
    timezone: "Asia/Tokyo"
  },
  runtime: {
    scheduler: {
      tick: "60s",
      concurrency: 4,
      jitter: true
    },
    budget: {
      max_subrequests_per_tick: 40,
      max_d1_queries_per_tick: 10,
      max_d1_writes_per_tick: 100,
      max_notifications_per_tick: 5,
      max_due_jobs_per_tick: 40
    }
  },
  features: {
    monitoring: { enabled: false },
    incidents: { enabled: false },
    maintenance: { enabled: false },
    notifications: { enabled: false },
    metrics: { enabled: false },
    admin_api: { enabled: false },
    storage: { enabled: false },
    status_inputs: { enabled: false }
  },
  storage: {
    adapter: "static",
    raw_results: { enabled: false },
    rollups: { enabled: true, bucket: "1h" }
  },
  display: {
    show_overall_status: true,
    show_component_groups: true,
    show_history: false,
    show_uptime_percentage: false,
    show_latency: false,
    show_incidents: true,
    show_maintenance: true
  },
  status_states: [
    { id: "operational", label: "Operational", severity: 0, public: true },
    { id: "degraded", label: "Degraded", severity: 1, public: true },
    { id: "offline", label: "Offline", severity: 2, public: true },
    { id: "unknown", label: "Unknown", severity: 1, public: true }
  ],
  components: [
    { id: "web", name: "Web services", status: "operational" },
    { id: "game", name: "Game services", status: "operational" }
  ],
  monitors: [],
  incidents: [],
  maintenance: [],
  notifications: [],
  incident_states: [
    { id: "investigating", label: "Investigating" },
    { id: "identified", label: "Identified" },
    { id: "monitoring", label: "Monitoring" },
    { id: "resolved", label: "Resolved" }
  ],
  incident_impacts: [
    { id: "minor", label: "Minor" },
    { id: "degraded", label: "Degraded" },
    { id: "major", label: "Major" },
    { id: "critical", label: "Critical" }
  ],
  maintenance_states: [
    { id: "scheduled", label: "Scheduled" },
    { id: "in_progress", label: "In progress" },
    { id: "completed", label: "Completed" },
    { id: "cancelled", label: "Cancelled" }
  ]
};
