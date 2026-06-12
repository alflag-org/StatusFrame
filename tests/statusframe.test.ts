import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createExtensionRegistry,
  createStatusFrameRunner,
  generatePublicSnapshot,
  parseStatusFrameYaml,
  renderStatusPage,
  validateConfig,
  validatePublicOutput,
  type PublicSnapshot,
  type StatusFrameConfig
} from "@statusframe/core";
import { createD1Storage, type D1PreparedStatement } from "@statusframe/storage-d1";
import { createMemoryStorage } from "@statusframe/storage-memory";
import { createStaticStorage } from "@statusframe/storage-static";
import { httpMonitor } from "@statusframe/monitor-http";
import { tcpMonitor } from "@statusframe/monitor-tcp";
import { createIncidentService, incidentsExtension } from "@statusframe/incidents";
import { createMaintenanceService, maintenanceExtension } from "@statusframe/maintenance";
import { metricsExtension } from "@statusframe/metrics";
import { webhookNotifications } from "@statusframe/notifications-webhook";
import { adminApiExtension } from "@statusframe/admin-api";
import worker from "../apps/worker/src/index";

const NOW = new Date("2026-06-12T03:00:00.000Z");

function loadExample(name: string): StatusFrameConfig {
  return parseStatusFrameYaml(readFileSync(new URL(`../examples/${name}.yml`, import.meta.url), "utf8"));
}

function monitoringConfig(overrides: Partial<StatusFrameConfig> = {}): StatusFrameConfig {
  const config = loadExample("monitoring");
  return {
    ...config,
    ...overrides
  };
}

describe("minimal public framework", () => {
  it("renders a public page from minimal config without storage or monitoring", async () => {
    const config = loadExample("minimal");
    const runner = createStatusFrameRunner({
      config,
      extensions: [],
      storage: createStaticStorage()
    });

    const snapshot = await runner.getPublicSnapshot(NOW);
    const html = renderStatusPage(snapshot);

    expect(snapshot.site.name).toBe("Example Status");
    expect(snapshot.components).toHaveLength(2);
    expect(html).toContain("Example Status");
    expect(html).toContain("Web services");
    expect(html).not.toContain("healthz");
  });

  it("serves /api/status from the Worker in minimal mode", async () => {
    const response = await worker.fetch(
      new Request("https://status.example.test/api/status"),
      { STATUSFRAME_STORAGE: "static" } as Env,
      executionContext()
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as PublicSnapshot;
    expect(json.site.name).toBe("Example Status");
    expect(json.active_incidents).toEqual([]);
    expect(json.scheduled_maintenance).toEqual([]);
  });

  it("validates public output leakage", () => {
    const config = loadExample("minimal");
    const snapshot = generatePublicSnapshot({ config, now: NOW });
    snapshot.components[0] = {
      ...snapshot.components[0]!,
      description: "Backend lives at 10.0.0.1"
    };

    expect(validatePublicOutput(snapshot)).toEqual([
      expect.objectContaining({
        path: "$.components[0].description"
      })
    ]);
  });
});

describe("extension registry and validation", () => {
  it("registers official and user monitor extensions through the same interface", () => {
    const custom = {
      manifest: {
        name: "@example/custom-monitor",
        kind: "monitor" as const,
        monitorTypes: ["custom"],
        cost: { subrequestsPerRun: 0 }
      },
      async runMonitor() {
        return { ok: true, checkedAt: NOW.toISOString() };
      }
    };
    const registry = createExtensionRegistry([httpMonitor(), custom]);

    expect(registry.monitorTypes.has("http")).toBe(true);
    expect(registry.monitorTypes.has("custom")).toBe(true);
    expect(registry.validate()).toEqual([]);
  });

  it("rejects invalid config references and disabled features", () => {
    const config = {
      ...loadExample("minimal"),
      monitors: [
        {
          id: "bad",
          component: "missing",
          enabled: true,
          required: true,
          type: "unknown",
          interval: "wat",
          timeout: "5s"
        }
      ]
    };

    const result = validateConfig(config, createExtensionRegistry([]));

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Monitoring is disabled but monitors are configured",
        "Unknown component reference: missing",
        "Unknown monitor type: unknown",
        "Invalid duration: wat"
      ])
    );
  });
});

describe("monitoring and runner", () => {
  it("runs HTTP monitors and stores a public-safe snapshot", async () => {
    const config = monitoringConfig();
    const storage = createMemoryStorage();
    const runner = createStatusFrameRunner({
      config,
      extensions: [httpMonitor()],
      storage,
      fetch: vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch
    });

    const result = await runner.runScheduled(NOW);
    const json = JSON.stringify(result.snapshot);

    expect(result.snapshot.components[0]?.status).toBe("operational");
    expect(result.monitorStates[0]?.private?.target).toBe("https://example.com/healthz");
    expect(json).not.toContain("https://example.com/healthz");
    expect(json).not.toContain("web-health");
    expect(await storage.loadPublicSnapshot()).toEqual(result.snapshot);
  });

  it("runs TCP monitors through an injected connector", async () => {
    const config = monitoringConfig({
      components: [
        {
          id: "game",
          name: "Game services",
          status_policy: { source: "monitors" }
        }
      ],
      monitors: [
        {
          id: "game-tcp",
          component: "game",
          enabled: true,
          required: true,
          type: "tcp",
          target: "mc.example.com:25565",
          interval: "60s",
          timeout: "5s"
        }
      ]
    });
    const runner = createStatusFrameRunner({
      config,
      extensions: [tcpMonitor()],
      storage: createMemoryStorage(),
      tcpConnect: vi.fn(async () => ({ close: vi.fn() }))
    });

    const result = await runner.runScheduled(NOW);

    expect(result.snapshot.components[0]?.status).toBe("operational");
    expect(result.monitorStates[0]?.private?.target).toBe("mc.example.com:25565");
    expect(JSON.stringify(result.snapshot)).not.toContain("mc.example.com");
  });

  it("enforces due job and subrequest budgets", async () => {
    const config = monitoringConfig({
      runtime: {
        scheduler: { tick: "60s", concurrency: 4, jitter: true },
        budget: {
          max_subrequests_per_tick: 1,
          max_d1_queries_per_tick: 10,
          max_d1_writes_per_tick: 100,
          max_notifications_per_tick: 5,
          max_due_jobs_per_tick: 1
        }
      },
      components: [
        { id: "web", name: "Web services", status_policy: { source: "monitors" } },
        { id: "api", name: "API", status_policy: { source: "monitors" } }
      ],
      monitors: [
        {
          id: "web-health",
          component: "web",
          enabled: true,
          required: true,
          type: "http",
          target: "https://example.com/web",
          interval: "60s",
          timeout: "5s"
        },
        {
          id: "api-health",
          component: "api",
          enabled: true,
          required: true,
          type: "http",
          target: "https://example.com/api",
          interval: "60s",
          timeout: "5s"
        }
      ]
    });
    const runner = createStatusFrameRunner({
      config,
      extensions: [httpMonitor()],
      storage: createMemoryStorage(),
      fetch: vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch
    });

    const result = await runner.runScheduled(NOW);

    expect(result.monitorStates).toHaveLength(1);
    expect(result.skippedJobs).toEqual([{ id: "api-health", reason: "max_due_jobs_per_tick" }]);
    expect(result.budgetUsage.subrequests).toBe(1);
  });

  it("aggregates component state from required monitor results", async () => {
    const config = monitoringConfig({
      monitors: [
        {
          id: "web-a",
          component: "web",
          enabled: true,
          required: true,
          type: "http",
          target: "https://example.com/a",
          interval: "60s",
          timeout: "5s"
        },
        {
          id: "web-b",
          component: "web",
          enabled: true,
          required: true,
          type: "http",
          target: "https://example.com/b",
          interval: "60s",
          timeout: "5s"
        }
      ]
    });
    const runner = createStatusFrameRunner({
      config,
      extensions: [httpMonitor()],
      storage: createMemoryStorage(),
      fetch: vi.fn(async (input) => {
        const url = String(input);
        return new Response(url.endsWith("/a") ? null : "fail", { status: url.endsWith("/a") ? 200 : 500 });
      }) as typeof fetch
    });

    const result = await runner.runScheduled(NOW);

    expect(result.snapshot.components[0]?.status).toBe("degraded");
  });
});

describe("feature extensions", () => {
  it("supports incident lifecycle and public projection", async () => {
    const service = createIncidentService();
    const incident = service.create({
      id: "inc_1",
      title: "Game issue",
      status: "investigating",
      impact: "degraded",
      components: ["game"],
      started_at: NOW.toISOString(),
      updates: []
    });
    service.addUpdate(incident.id, {
      status: "identified",
      body: "Cause identified.",
      created_at: NOW.toISOString()
    });

    const config = {
      ...loadExample("minimal"),
      features: {
        ...loadExample("minimal").features,
        incidents: { enabled: true }
      }
    };
    const runner = createStatusFrameRunner({
      config,
      extensions: [incidentsExtension(service)],
      storage: createMemoryStorage()
    });

    const snapshot = await runner.regeneratePublicSnapshot(NOW);
    expect(snapshot.active_incidents[0]?.status).toBe("identified");

    service.resolve(incident.id, NOW.toISOString());
    const afterResolve = await runner.regeneratePublicSnapshot(NOW);
    expect(afterResolve.active_incidents).toEqual([]);
  });

  it("supports maintenance lifecycle and public projection", async () => {
    const service = createMaintenanceService();
    service.create({
      id: "maint_1",
      title: "Network maintenance",
      status: "scheduled",
      components: ["web"],
      starts_at: "2026-06-20T01:00:00+09:00",
      ends_at: "2026-06-20T03:00:00+09:00"
    });
    service.markInProgress("maint_1");

    const config = {
      ...loadExample("minimal"),
      features: {
        ...loadExample("minimal").features,
        maintenance: { enabled: true }
      }
    };
    const runner = createStatusFrameRunner({
      config,
      extensions: [maintenanceExtension(service)],
      storage: createMemoryStorage()
    });

    const snapshot = await runner.regeneratePublicSnapshot(NOW);
    expect(snapshot.scheduled_maintenance[0]?.status).toBe("in_progress");

    service.complete("maint_1");
    const completed = await runner.regeneratePublicSnapshot(NOW);
    expect(completed.scheduled_maintenance).toEqual([]);
  });

  it("adds optional public metrics only when enabled", async () => {
    const config = {
      ...loadExample("minimal"),
      features: {
        ...loadExample("minimal").features,
        metrics: { enabled: true }
      },
      components: [
        {
          id: "web",
          name: "Web services",
          status: "operational",
          public_metrics: {
            uptime: { enabled: true, window_days: 90 },
            latency: { enabled: true, mode: "state" as const }
          }
        }
      ]
    };
    const runner = createStatusFrameRunner({
      config,
      extensions: [metricsExtension()],
      storage: createMemoryStorage()
    });

    const snapshot = await runner.regeneratePublicSnapshot(NOW);
    expect(snapshot.components[0]?.metrics?.uptime?.window_days).toBe(90);
    expect(snapshot.components[0]?.metrics?.latency?.state).toBe("unknown");
  });

  it("sends webhook notifications without exposing webhook URLs publicly", async () => {
    const previous = generatePublicSnapshot({ config: loadExample("minimal"), now: NOW });
    const config = {
      ...monitoringConfig(),
      features: {
        ...monitoringConfig().features,
        notifications: { enabled: true }
      },
      notifications: [
        {
          id: "generic",
          type: "webhook",
          url: "${STATUSFRAME_WEBHOOK_URL}",
          events: ["component_status_changed"]
        }
      ]
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("hooks.example.test")) {
        return new Response(null, { status: 204 });
      }
      return new Response("fail", { status: 500 });
    }) as unknown as typeof fetch;
    const runner = createStatusFrameRunner({
      config,
      extensions: [httpMonitor(), webhookNotifications()],
      storage: createMemoryStorage({ snapshot: previous }),
      fetch: fetchMock,
      env: {
        STATUSFRAME_WEBHOOK_URL: "https://hooks.example.test/statusframe"
      }
    });

    const result = await runner.runScheduled(NOW);

    expect(result.snapshot.components[0]?.status).toBe("major_outage");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.test/statusframe",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.stringify(result.snapshot)).not.toContain("hooks.example.test");
  });

  it("validates admin config through the registered extension registry", async () => {
    const config = {
      ...monitoringConfig(),
      features: {
        ...monitoringConfig().features,
        admin_api: { enabled: true }
      }
    };
    const runner = createStatusFrameRunner({
      config,
      extensions: [httpMonitor(), adminApiExtension()],
      storage: createMemoryStorage(),
      env: {
        STATUSFRAME_ADMIN_TOKEN: "local-admin-token"
      }
    });

    const response = await runner.handleAdminRequest(
      new Request("https://status.example.test/api/admin/config/validate", {
        headers: {
          authorization: "Bearer local-admin-token"
        }
      })
    );
    const body = (await response?.json()) as { ok: boolean };

    expect(response?.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

describe("storage adapters", () => {
  it("supports static and memory snapshot storage", async () => {
    const config = loadExample("minimal");
    const snapshot = generatePublicSnapshot({ config, now: NOW });
    const staticStorage = createStaticStorage();
    const memoryStorage = createMemoryStorage();

    await staticStorage.savePublicSnapshot(snapshot);
    await memoryStorage.savePublicSnapshot(snapshot);

    expect(await staticStorage.loadPublicSnapshot()).toEqual(snapshot);
    expect(await memoryStorage.loadPublicSnapshot()).toEqual(snapshot);
  });

  it("stores and loads public snapshots through the D1 adapter", async () => {
    let storedSnapshot: string | undefined;
    const componentRows: Array<{
      component_id: string;
      status: string;
      latency_state: string | null;
      updated_at: string;
    }> = [];
    const statements: Array<{ query: string; values: unknown[] }> = [];
    const db = {
      prepare(query: string): D1PreparedStatement {
        const statement = {
          values: [] as unknown[],
          bind(...values: unknown[]) {
            this.values = values;
            return this;
          },
          async first<T>() {
            if (!storedSnapshot) return null;
            return { snapshot_json: storedSnapshot } as T;
          },
          async all<T>() {
            return { results: componentRows as T[] };
          },
          async run() {
            statements.push({ query, values: this.values });
            if (query.includes("public_snapshots")) {
              storedSnapshot = String(this.values[1]);
            }
            if (query.includes("component_state")) {
              componentRows.push({
                component_id: String(this.values[0]),
                status: String(this.values[1]),
                latency_state: this.values[2] === null ? null : String(this.values[2]),
                updated_at: String(this.values[3])
              });
            }
            return { success: true };
          }
        };
        return statement;
      }
    };
    const config = loadExample("minimal");
    const snapshot = generatePublicSnapshot({ config, now: NOW });
    const storage = createD1Storage(db);

    await storage.savePublicSnapshot(snapshot);
    await storage.saveComponentStates?.([{ componentId: "web", status: "operational", updatedAt: NOW.toISOString() }]);
    const loaded = await storage.loadPublicSnapshot();
    const componentStates = await storage.loadComponentStates?.();

    expect(loaded).toEqual(snapshot);
    expect(componentStates).toEqual([{ componentId: "web", status: "operational", updatedAt: NOW.toISOString() }]);
    expect(statements[0]?.query).toContain("public_snapshots");
  });
});

function executionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {}
  } as unknown as ExecutionContext;
}
