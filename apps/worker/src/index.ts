import { Hono } from "hono";
import { createStatusFrameRunner, renderStatusPage } from "@statusframe/core";
import { adminApiExtension } from "@statusframe/admin-api";
import { incidentsExtension } from "@statusframe/incidents";
import { maintenanceExtension } from "@statusframe/maintenance";
import { metricsExtension } from "@statusframe/metrics";
import { dnsMonitor } from "@statusframe/monitor-dns";
import { httpMonitor } from "@statusframe/monitor-http";
import { tcpMonitor } from "@statusframe/monitor-tcp";
import { tlsMonitor } from "@statusframe/monitor-tls";
import { webhookNotifications } from "@statusframe/notifications-webhook";
import { createD1Storage, type D1DatabaseLike } from "@statusframe/storage-d1";
import { createMemoryStorage } from "@statusframe/storage-memory";
import { createStaticStorage } from "@statusframe/storage-static";
import { statusFrameConfig } from "./statusframe.config";

const memoryStorage = createMemoryStorage();

const extensions = [
  httpMonitor(),
  tcpMonitor(),
  dnsMonitor(),
  tlsMonitor(),
  incidentsExtension(),
  maintenanceExtension(),
  metricsExtension(),
  webhookNotifications(),
  adminApiExtension()
];

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const runner = createRunner(c.env);
  const snapshot = await runner.getPublicSnapshot();
  return c.html(renderStatusPage(snapshot), 200, {
    "cache-control": "public, max-age=30"
  });
});

app.get("/api/status", async (c) => {
  const runner = createRunner(c.env);
  const snapshot = await runner.getPublicSnapshot();
  return c.json(snapshot, 200, {
    "cache-control": "public, max-age=30"
  });
});

app.get("/api/incidents", async (c) => {
  const runner = createRunner(c.env);
  const snapshot = await runner.getPublicSnapshot();
  if (!statusFrameConfig.features.incidents.enabled) {
    return c.json({ error: "Incidents are disabled" }, 404);
  }
  return c.json({ incidents: snapshot.active_incidents });
});

app.get("/api/maintenance", async (c) => {
  const runner = createRunner(c.env);
  const snapshot = await runner.getPublicSnapshot();
  if (!statusFrameConfig.features.maintenance.enabled) {
    return c.json({ error: "Maintenance is disabled" }, 404);
  }
  return c.json({ maintenance: snapshot.scheduled_maintenance });
});

app.all("/api/admin/*", async (c) => {
  const runner = createRunner(c.env);
  const response = await runner.handleAdminRequest(c.req.raw);
  return response ?? c.json({ error: "Admin API is disabled" }, 404);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await app.fetch(request, env, ctx);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "statusframe request failed",
          error: error instanceof Error ? error.message : "Unknown error",
          path: new URL(request.url).pathname
        })
      );
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const runner = createRunner(env);
    ctx.waitUntil(runner.runScheduled());
  }
};

function createRunner(env: Env) {
  return createStatusFrameRunner({
    config: statusFrameConfig,
    extensions,
    storage: selectStorage(env),
    env: toStringEnv(env as unknown as Record<string, unknown>)
  });
}

function selectStorage(env: Env) {
  const mode = typeof env.STATUSFRAME_STORAGE === "string" ? env.STATUSFRAME_STORAGE : statusFrameConfig.storage.adapter;
  if (mode === "memory") return memoryStorage;
  if (mode === "d1" && isD1Database(env.STATUSFRAME_DB)) {
    return createD1Storage(env.STATUSFRAME_DB);
  }
  return createStaticStorage();
}

function toStringEnv(env: Record<string, unknown>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, typeof value === "string" ? value : undefined])
  );
}

function isD1Database(value: unknown): value is D1DatabaseLike {
  return Boolean(value && typeof value === "object" && "prepare" in value && typeof value.prepare === "function");
}
