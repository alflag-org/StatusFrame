import { parseDocument } from "yaml";
import { z } from "zod";
import { isIP } from "node:net";

export const publicStates = ["operational", "degraded", "partial_outage", "major_outage", "unknown"] as const;
export const incidentStates = ["investigating", "identified", "monitoring", "resolved"] as const;
export const maintenanceStates = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const publicTextSchema = z.string().min(1).max(4000).refine(value =>
  !/(?:https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:localhost|[\w-]+\.(?:internal|local|lan|corp))\b|(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.]*|bearer\s+|(?:token|secret|password|authorization)\s*[:=]|\bat\s+\S+\s*\([^\n]+:\d+)/i.test(value),
  "Public text must not contain monitoring or diagnostic data"
);
export function durationMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const result = match ? Number(match[1]) * units[match[2]!]! : NaN;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Invalid duration");
  return result;
}
const duration = z.string().refine(value => { try { durationMs(value); return true; } catch { return false; } });
const interval = duration.refine(value => durationMs(value) >= 60_000 && durationMs(value) <= 30 * 86_400_000, "Interval must be 1m–30d");
const timeout = duration.refine(value => durationMs(value) <= 30_000, "Timeout must be at most 30s");

export function isPublicHost(input: string): boolean {
  const host = input.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const version = isIP(host);
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = host.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99))) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (version === 6) return /^[23][0-9a-f]{3}:/.test(host) && !/^2001:0?db8:/i.test(host);
  return host.length <= 253 && host.includes(".") &&
    host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/(?:^|\.)(?:localhost|local|internal|invalid|test|lan|corp|home|onion)$/.test(host);
}
export function assertPublicUrl(input: string): URL {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !isPublicHost(url.hostname)) {
    throw new Error("Only public HTTP(S) targets without credentials are supported");
  }
  return url;
}
const host = z.string().refine(isPublicHost, "A public hostname or IP is required").transform(v => v.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""));
const shared = {
  id: idSchema, component: idSchema,
  interval: interval.default("1m"), timeout: timeout.default("5s"),
  failure_threshold: z.number().int().min(1).max(100).default(3),
  recovery_threshold: z.number().int().min(1).max(100).default(2)
};
export const monitorSchema = z.discriminatedUnion("type", [
  z.object({ ...shared, type: z.literal("http"), url: z.string().refine(v => { try { assertPublicUrl(v); return true; } catch { return false; } }),
    method: z.enum(["GET", "HEAD"]).default("GET"), follow_redirects: z.boolean().default(false),
    expect: z.object({ status: z.number().int().min(100).max(599).default(200), body_contains: z.string().min(1).max(65_536).optional() }).strict().default({ status: 200 }) }).strict(),
  z.object({ ...shared, type: z.literal("tcp"), host, port: z.number().int().min(1).max(65535) }).strict(),
  z.object({ ...shared, type: z.literal("dns"), name: host,
    record_type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]),
    expect: z.object({ values: z.array(z.string().min(1)).min(1).max(50) }).strict().optional() }).strict(),
  z.object({ ...shared, type: z.literal("tls"), host, port: z.number().int().min(1).max(65535).default(443) }).strict()
]);
const date = z.iso.datetime({ offset: true });
const refs = z.array(idSchema).min(1).max(100).refine(ids => new Set(ids).size === ids.length);
export const incidentSchema = z.object({
  id: idSchema, title: publicTextSchema, status: z.enum(incidentStates),
  impact: z.enum(["degraded", "partial_outage", "major_outage"]), components: refs,
  started_at: date, resolved_at: date.nullable().default(null),
  updates: z.array(z.object({ status: z.enum(incidentStates), body: publicTextSchema, created_at: date }).strict()).max(100).default([])
}).strict().superRefine((incident, ctx) => {
  if ((incident.status === "resolved") !== (incident.resolved_at !== null)) ctx.addIssue({ code: "custom", message: "Resolved incidents require resolved_at; active incidents must not set it" });
  if (incident.resolved_at && Date.parse(incident.resolved_at) < Date.parse(incident.started_at)) ctx.addIssue({ code: "custom", message: "resolved_at must follow started_at" });
  let previous = Date.parse(incident.started_at);
  for (const update of incident.updates) {
    const time = Date.parse(update.created_at);
    if (time < previous || (incident.resolved_at && time > Date.parse(incident.resolved_at))) ctx.addIssue({ code: "custom", message: "Incident updates must be chronological and within the incident" });
    previous = time;
  }
  const last = incident.updates.at(-1);
  if (last && last.status !== incident.status) ctx.addIssue({ code: "custom", message: "The final update must match incident status" });
});
export const maintenanceSchema = z.object({
  id: idSchema, title: publicTextSchema, status: z.enum(maintenanceStates), components: refs,
  starts_at: date, ends_at: date, body: publicTextSchema
}).strict().refine(v => Date.parse(v.ends_at) > Date.parse(v.starts_at), "ends_at must follow starts_at");
const limits = {
  max_d1_reads: z.number().int().min(0).max(40).default(10),
  max_d1_writes: z.number().int().min(0).max(100).default(20),
  max_subrequests: z.number().int().min(0).max(50).default(40),
  max_notifications: z.number().int().min(0).max(20).default(5),
  max_due_jobs: z.number().int().min(0).max(40).default(10)
};
export const configSchema = z.object({
  site: z.object({ name: publicTextSchema, description: publicTextSchema.optional(), language: z.enum(["en", "ja"]).default("en"), timezone: z.string().default("UTC").refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }) }).strict(),
  components: z.array(z.object({ id: idSchema, name: publicTextSchema, description: publicTextSchema.optional() }).strict()).min(1).max(100),
  monitors: z.array(monitorSchema).max(100).default([]),
  incidents: z.array(incidentSchema).max(50).default([]),
  maintenance: z.array(maintenanceSchema).max(50).default([]),
  notifications: z.object({ webhook: z.boolean().default(false) }).strict().default({ webhook: false }),
  budget: z.object(limits).strict().prefault({})
}).strict().superRefine((config, ctx) => {
  for (const key of ["components", "monitors", "incidents", "maintenance"] as const) {
    const ids = config[key].map(v => v.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: [key], message: "IDs must be unique" });
  }
  const components = new Set(config.components.map(v => v.id));
  for (const monitor of config.monitors) {
    if (!components.has(monitor.component)) ctx.addIssue({ code: "custom", path: ["monitors"], message: "Unknown component" });
    if (components.has(monitor.id)) ctx.addIssue({ code: "custom", path: ["monitors"], message: "Monitor IDs must differ from public component IDs" });
    if (monitor.type === "http" && monitor.method === "HEAD" && monitor.expect.body_contains) ctx.addIssue({ code: "custom", path: ["monitors"], message: "HEAD cannot check response bodies" });
  }
  for (const entry of [...config.incidents, ...config.maintenance]) {
    if (entry.components.some(id => !components.has(id))) ctx.addIssue({ code: "custom", message: "Unknown incident or maintenance component" });
  }
});
export type Config = z.infer<typeof configSchema>;
export type Monitor = z.infer<typeof monitorSchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type Maintenance = z.infer<typeof maintenanceSchema>;
export type PublicState = typeof publicStates[number];
export function parseConfig(input: unknown): Config { return configSchema.parse(input); }
export function parseYaml(source: string): Config {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error("Invalid YAML");
  return parseConfig(document.toJS({ maxAliasCount: 20 }));
}
