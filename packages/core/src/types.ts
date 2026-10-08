import type { Config, Incident, Maintenance, Monitor, PublicState } from "./config";

export interface MonitorRuntime {
  monitor_id: string;
  config_hash: string;
  last_checked_at: number | null;
  next_due_at: number;
  current_state: "unknown" | "up" | "down";
  consecutive_failures: number;
  consecutive_successes: number;
}

export interface MonitorResult {
  ok: boolean;
  error_code?: string;
}

export interface PublicHistory {
  days: Array<{
    date: string;
    status: PublicState;
    known_ms: number;
    uptime_percent: number | null;
  }>;
  uptime_percent: number | null;
}

export interface PublicComponent {
  id: string;
  name: string;
  description?: string;
  status: PublicState;
  history?: PublicHistory;
}

export interface PublicIncident {
  id: string;
  title: string;
  status: Incident["status"];
  impact: Incident["impact"];
  components: string[];
  started_at: string;
  resolved_at: string | null;
  updates: Array<{
    status: Incident["status"];
    body: string;
    created_at: string;
  }>;
}

export interface PublicMaintenance {
  id: string;
  title: string;
  status: Maintenance["status"];
  components: string[];
  starts_at: string;
  ends_at: string;
  body: string;
}

export interface PublicSnapshot {
  site: {
    name: string;
    description?: string;
    timezone: string;
    language?: "en" | "ja";
    status: PublicState;
    updated_at: string;
  };
  components: PublicComponent[];
  incidents: PublicIncident[];
  maintenance: PublicMaintenance[];
}

export interface NotificationEvent {
  id: string;
  type:
    | "component_status_changed"
    | "incident_created"
    | "incident_updated"
    | "incident_resolved"
    | "maintenance_scheduled"
    | "maintenance_started"
    | "maintenance_completed"
    | "maintenance_cancelled"
    | "maintenance_updated";
  created_at: string;
  subject_id: string;
  previous_status: string | null;
  status: string;
}

export interface RuntimeIO {
  fetch: typeof globalThis.fetch;
  connect: (hostname: string, port: number, secure: boolean) => MonitorSocket;
}

export interface MonitorSocket {
  opened: Promise<unknown>;
  closed: Promise<unknown>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface MonitorContext {
  io: RuntimeIO;
  budget: import("./budget").Budget;
  now: number;
}

export type RunMonitor = (monitor: Monitor, context: MonitorContext) => Promise<MonitorResult>;

export interface StoredView {
  monitors: MonitorRuntime[];
  incidents: Incident[];
  maintenance: Maintenance[];
  snapshot: PublicSnapshot | null;
  history: import("./history").HistoryState | null;
}

export interface TickResult {
  checked: string[];
  skipped: string[];
  notified: number;
  usage: import("./budget").Usage;
}

export type BudgetConfig = Config["budget"];
