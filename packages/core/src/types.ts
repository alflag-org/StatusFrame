import type {
  ComponentConfig,
  IncidentConfig,
  MaintenanceConfig,
  MonitorConfig,
  StatusFrameConfig
} from "@statusframe/schema";

export type ExtensionKind =
  | "monitor"
  | "provider"
  | "feature"
  | "storage"
  | "renderer"
  | "notification"
  | "admin";

export interface ExtensionCost {
  subrequestsPerRun?: number;
  d1ReadsPerRun?: number;
  d1WritesPerRun?: number;
  notificationsPerRun?: number;
  maxConcurrency?: number;
  expectedCpuMs?: number;
}

export interface ExtensionManifest {
  name: string;
  kind: ExtensionKind;
  monitorTypes?: string[];
  providers?: string[];
  capabilities?: string[];
  cost?: ExtensionCost;
  defaultRedaction?: {
    exposeTarget?: boolean;
    exposeError?: boolean;
    exposeLatency?: boolean;
  };
  scaffold?: boolean;
}

export interface MonitorResult {
  ok: boolean;
  checkedAt: string;
  latencyMs?: number;
  private?: {
    errorCode?: string;
    errorMessage?: string;
    target?: string;
    metadata?: Record<string, unknown>;
  };
  publicHint?: {
    status?: string;
    latencyState?: string;
    summary?: string;
  };
}

export interface NormalizedMonitorState {
  monitorId: string;
  componentId: string;
  type: string;
  required: boolean;
  ok: boolean;
  checkedAt: string;
  latencyMs?: number;
  publicHint?: MonitorResult["publicHint"];
  private?: MonitorResult["private"];
}

export interface TcpConnection {
  close?: () => void | Promise<void>;
  opened?: Promise<void>;
}

export type TcpConnector = (options: {
  hostname: string;
  port: number;
  secureTransport?: "off" | "on" | "starttls";
  signal?: AbortSignal;
}) => Promise<TcpConnection> | TcpConnection;

export interface MonitorExecutionContext {
  config: StatusFrameConfig;
  monitor: MonitorConfig;
  now: Date;
  signal?: AbortSignal;
  fetch: typeof fetch;
  tcpConnect?: TcpConnector;
}

export type MonitorRunner = (ctx: MonitorExecutionContext) => Promise<MonitorResult>;

export interface PublicComponent {
  id: string;
  name: string;
  status: string;
  group?: string;
  description?: string;
  metrics?: PublicComponentMetrics;
}

export interface PublicComponentMetrics {
  uptime?: {
    label: string;
    window_days: number;
  };
  latency?: {
    state: string;
    summary?: string;
  };
}

export interface PublicIncident {
  id: string;
  title: string;
  status: string;
  impact: string;
  components: string[];
  body?: string;
  started_at: string;
  resolved_at?: string;
  updates?: Array<{
    status: string;
    body: string;
    created_at: string;
  }>;
}

export interface PublicMaintenance {
  id: string;
  title: string;
  status: string;
  components: string[];
  body?: string;
  starts_at: string;
  ends_at: string;
}

export interface PublicSnapshot {
  site: {
    name: string;
    status: string;
    updated_at: string;
    description?: string;
    timezone?: string;
  };
  components: PublicComponent[];
  active_incidents: PublicIncident[];
  scheduled_maintenance: PublicMaintenance[];
}

export interface ComponentState {
  componentId: string;
  status: string;
  updatedAt: string;
  latencyState?: string;
}

export interface PublicProjectionContext {
  config: StatusFrameConfig;
  components: PublicComponent[];
  componentStates: ComponentState[];
  monitorStates: NormalizedMonitorState[];
  now: Date;
}

export interface PublicProjectionPatch {
  activeIncidents?: PublicIncident[];
  scheduledMaintenance?: PublicMaintenance[];
  componentMetrics?: Record<string, PublicComponentMetrics>;
}

export interface NotificationEvent {
  type:
    | "component_status_changed"
    | "incident_created"
    | "incident_updated"
    | "incident_resolved"
    | "maintenance_started"
    | "maintenance_completed";
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface NotificationContext {
  config: StatusFrameConfig;
  event: NotificationEvent;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
}

export interface AdminRequestContext {
  request: Request;
  config: StatusFrameConfig;
  env: Record<string, string | undefined>;
  regenerateSnapshot: () => Promise<PublicSnapshot>;
  validateConfiguration: () => ValidationResult;
}

export interface StatusFrameExtension {
  manifest: ExtensionManifest;
  runMonitor?: MonitorRunner;
  projectPublic?: (ctx: PublicProjectionContext) => PublicProjectionPatch | Promise<PublicProjectionPatch>;
  notify?: (ctx: NotificationContext) => Promise<void>;
  handleAdminRequest?: (ctx: AdminRequestContext) => Promise<Response | undefined>;
}

export interface StorageAdapter {
  name: string;
  loadPublicSnapshot(): Promise<PublicSnapshot | undefined>;
  savePublicSnapshot(snapshot: PublicSnapshot): Promise<void>;
  loadComponentStates?(): Promise<ComponentState[]>;
  saveComponentStates?(states: ComponentState[]): Promise<void>;
  saveMonitorStates?(states: NormalizedMonitorState[]): Promise<void>;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type IncidentInput = IncidentConfig;
export type MaintenanceInput = MaintenanceConfig;
export type ComponentInput = ComponentConfig;
