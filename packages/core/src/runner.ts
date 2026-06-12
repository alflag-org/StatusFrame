import type { MonitorConfig, StatusFrameConfig } from "@statusframe/schema";
import { parseDurationMs } from "@statusframe/schema";
import { createBudgetTracker, type BudgetUsage } from "./budget";
import { createExtensionRegistry, extensionCost, type ExtensionRegistry } from "./extension";
import { assertPublicOutput } from "./redaction";
import { aggregateComponentStates, generatePublicSnapshot } from "./projection";
import type {
  ComponentState,
  NormalizedMonitorState,
  NotificationEvent,
  PublicProjectionContext,
  PublicProjectionPatch,
  PublicSnapshot,
  StatusFrameExtension,
  StorageAdapter,
  TcpConnector
} from "./types";
import { validateConfig } from "./validation";

export interface RunnerOptions {
  config: StatusFrameConfig;
  extensions?: StatusFrameExtension[];
  registry?: ExtensionRegistry;
  storage: StorageAdapter;
  fetch?: typeof fetch;
  tcpConnect?: TcpConnector;
  env?: Record<string, string | undefined>;
}

export interface RunnerResult {
  snapshot: PublicSnapshot;
  monitorStates: NormalizedMonitorState[];
  componentStates: ComponentState[];
  skippedJobs: Array<{ id: string; reason: string }>;
  budgetUsage: BudgetUsage;
}

export interface StatusFrameRunner {
  registry: ExtensionRegistry;
  getPublicSnapshot(now?: Date): Promise<PublicSnapshot>;
  regeneratePublicSnapshot(now?: Date): Promise<PublicSnapshot>;
  runScheduled(now?: Date): Promise<RunnerResult>;
  handleAdminRequest(request: Request): Promise<Response | undefined>;
}

export function createStatusFrameRunner(options: RunnerOptions): StatusFrameRunner {
  const registry = options.registry ?? createExtensionRegistry(options.extensions ?? []);
  const runtimeFetch = options.fetch ?? fetch;
  const env = options.env ?? {};

  async function collectProjectionPatches(input: {
    componentStates: ComponentState[];
    monitorStates: NormalizedMonitorState[];
    now: Date;
  }): Promise<PublicProjectionPatch[]> {
    const components = generatePublicSnapshot({
      config: options.config,
      componentStates: input.componentStates,
      monitorStates: input.monitorStates,
      now: input.now,
      patches: []
    }).components;
    const ctx: PublicProjectionContext = {
      config: options.config,
      components,
      componentStates: input.componentStates,
      monitorStates: input.monitorStates,
      now: input.now
    };
    const patches = await Promise.all(
      registry.extensions.map(async (extension) => extension.projectPublic?.(ctx) ?? {})
    );
    return patches;
  }

  async function regeneratePublicSnapshot(now = new Date()): Promise<PublicSnapshot> {
    const storedStates = await options.storage.loadComponentStates?.();
    const componentStates =
      storedStates && storedStates.length > 0
        ? storedStates
        : aggregateComponentStates({ config: options.config, now });
    const patches = await collectProjectionPatches({ componentStates, monitorStates: [], now });
    const snapshot = generatePublicSnapshot({
      config: options.config,
      componentStates,
      monitorStates: [],
      patches,
      now
    });
    assertPublicOutput(snapshot);
    await options.storage.savePublicSnapshot(snapshot);
    return snapshot;
  }

  return {
    registry,
    async getPublicSnapshot(now = new Date()) {
      const stored = await options.storage.loadPublicSnapshot();
      if (stored) {
        assertPublicOutput(stored);
        return stored;
      }
      return regeneratePublicSnapshot(now);
    },
    regeneratePublicSnapshot,
    async runScheduled(now = new Date()) {
      const validation = validateConfig(options.config, registry);
      if (!validation.ok) {
        throw new Error(`Invalid StatusFrame config: ${validation.issues.map((issue) => issue.message).join("; ")}`);
      }

      const previousSnapshot = await options.storage.loadPublicSnapshot();
      const skippedJobs: Array<{ id: string; reason: string }> = [];
      const budget = createBudgetTracker({
        maxSubrequests: options.config.runtime.budget.max_subrequests_per_tick,
        maxD1Reads: options.config.runtime.budget.max_d1_queries_per_tick,
        maxD1Writes: options.config.runtime.budget.max_d1_writes_per_tick,
        maxNotifications: options.config.runtime.budget.max_notifications_per_tick,
        maxDueJobs: options.config.runtime.budget.max_due_jobs_per_tick
      });

      const monitorStates = options.config.features.monitoring.enabled
        ? await executeDueMonitors({
            config: options.config,
            registry,
            now,
            runtimeFetch,
            budget,
            skippedJobs,
            ...(options.tcpConnect ? { tcpConnect: options.tcpConnect } : {})
          })
        : [];

      await options.storage.saveMonitorStates?.(monitorStates);
      const componentStates = aggregateComponentStates({ config: options.config, monitorStates, now });
      await options.storage.saveComponentStates?.(componentStates);

      const patches = await collectProjectionPatches({ componentStates, monitorStates, now });
      const snapshot = generatePublicSnapshot({
        config: options.config,
        componentStates,
        monitorStates,
        patches,
        now
      });
      assertPublicOutput(snapshot);
      await options.storage.savePublicSnapshot(snapshot);

      const notificationEvents = buildNotificationEvents(previousSnapshot, snapshot, now);
      for (const event of notificationEvents) {
        const decision = budget.canNotify();
        if (!decision.allowed) {
          skippedJobs.push({ id: event.type, reason: decision.reason ?? "notification_budget" });
          continue;
        }
        await Promise.all(
          registry.extensions.map(async (extension) => {
            if (extension.notify) {
              await extension.notify({ config: options.config, event, env, fetch: runtimeFetch });
            }
          })
        );
        budget.recordNotification();
      }

      return {
        snapshot,
        monitorStates,
        componentStates,
        skippedJobs,
        budgetUsage: { ...budget.usage }
      };
    },
    async handleAdminRequest(request: Request) {
      for (const extension of registry.extensions) {
        const response = await extension.handleAdminRequest?.({
          request,
          config: options.config,
          env,
          regenerateSnapshot: regeneratePublicSnapshot,
          validateConfiguration: () => validateConfig(options.config, registry)
        });
        if (response) return response;
      }
      return undefined;
    }
  };
}

async function executeDueMonitors(options: {
  config: StatusFrameConfig;
  registry: ExtensionRegistry;
  now: Date;
  runtimeFetch: typeof fetch;
  tcpConnect?: TcpConnector;
  budget: ReturnType<typeof createBudgetTracker>;
  skippedJobs: Array<{ id: string; reason: string }>;
}): Promise<NormalizedMonitorState[]> {
  const runnable: MonitorConfig[] = [];
  for (const monitor of options.config.monitors.filter((item) => item.enabled !== false)) {
    const extension = options.registry.monitorTypes.get(monitor.type);
    const decision = options.budget.canRun(extensionCost(extension));
    if (!decision.allowed) {
      options.skippedJobs.push({ id: monitor.id, reason: decision.reason ?? "budget" });
      continue;
    }
    options.budget.record(extensionCost(extension));
    runnable.push(monitor);
  }

  const concurrency = options.config.runtime.scheduler.concurrency;
  return runWithConcurrency(runnable, concurrency, async (monitor) => {
    const runMonitor = options.registry.getMonitor(monitor.type);
    if (!runMonitor) {
      return {
        monitorId: monitor.id,
        componentId: monitor.component,
        type: monitor.type,
        required: monitor.required !== false,
        ok: false,
        checkedAt: options.now.toISOString(),
        private: {
          errorCode: "monitor_type_not_registered"
        }
      };
    }

    const started = Date.now();
    const signal = timeoutSignal(parseDurationMs(monitor.timeout));
    try {
      const result = await runMonitor({
        config: options.config,
        monitor,
        now: options.now,
        fetch: options.runtimeFetch,
        ...(signal ? { signal } : {}),
        ...(options.tcpConnect ? { tcpConnect: options.tcpConnect } : {})
      });
      const state: NormalizedMonitorState = {
        monitorId: monitor.id,
        componentId: monitor.component,
        type: monitor.type,
        required: monitor.required !== false,
        ok: result.ok,
        checkedAt: result.checkedAt
      };
      if (typeof result.latencyMs === "number") state.latencyMs = result.latencyMs;
      if (result.publicHint) state.publicHint = result.publicHint;
      if (result.private) state.private = result.private;
      return state;
    } catch (error) {
      return {
        monitorId: monitor.id,
        componentId: monitor.component,
        type: monitor.type,
        required: monitor.required !== false,
        ok: false,
        checkedAt: options.now.toISOString(),
        latencyMs: Date.now() - started,
        private: {
          errorCode: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "monitor_failed",
          errorMessage: error instanceof Error ? error.message : "Monitor failed"
        }
      };
    }
  });
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    const current = index;
    index += 1;
    if (current >= items.length) return;
    const item = items[current];
    if (item === undefined) return;
    results[current] = await worker(item);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()));
  return results;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function buildNotificationEvents(
  previous: PublicSnapshot | undefined,
  current: PublicSnapshot,
  now: Date
): NotificationEvent[] {
  if (!previous) return [];

  const events: NotificationEvent[] = [];
  const previousComponents = new Map(previous.components.map((component) => [component.id, component]));
  for (const component of current.components) {
    const before = previousComponents.get(component.id);
    if (before && before.status !== component.status) {
      events.push({
        type: "component_status_changed",
        createdAt: now.toISOString(),
        payload: {
          component_id: component.id,
          old_status: before.status,
          new_status: component.status
        }
      });
    }
  }
  return events;
}
