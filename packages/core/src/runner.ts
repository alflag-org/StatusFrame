import { Budget, BudgetExceeded } from "./budget";
import { durationMs, type Config } from "./config";
import { advanceHistory, historyNeedsUpdate, presentHistory } from "./history";
import { assertPublic, project, sameContent, transitionEvents } from "./projection";
import { changedRecords, hashMonitorConfigs, projectScheduledView, restoreMonitorStates } from "./runner-plan";
import { advanceState } from "./state";
import { D1Store, type Commit } from "./storage";
import type { MonitorRuntime, NotificationEvent, RunMonitor, RuntimeIO, TickResult } from "./types";

export interface RunnerOptions {
  config: Config;
  db: D1Database;
  io: RuntimeIO;
  runMonitor: RunMonitor;
  notify?: (event: NotificationEvent, budget: Budget) => Promise<void>;
  secrets?: string[];
}

interface ScheduledContext {
  options: RunnerOptions;
  now: number;
  budget: Budget;
  store: D1Store;
  result: TickResult;
  monitorHashes: Map<string, string>;
}

export function createRunner(options: RunnerOptions) {
  return {
    async getSnapshot(now = Date.now()) {
      const { config } = options;
      const store = new D1Store(options.db, new Budget(config.budget));
      const publication = await store.loadPublication();
      const snapshot = publication.snapshot ?? project(config, [], [], [], now);
      assertPublic(snapshot, config, options.secrets);

      const publicSnapshot = {
        ...snapshot,
        components: presentHistory(publication.history, snapshot.components, now)
      };
      assertPublic(publicSnapshot, config, options.secrets);
      return publicSnapshot;
    },
    runScheduled(now = Date.now()): Promise<TickResult> {
      return runScheduled(options, now);
    }
  };
}

async function runScheduled(options: RunnerOptions, now: number): Promise<TickResult> {
  const { config } = options;
  const budget = new Budget(config.budget);
  const store = new D1Store(options.db, budget);
  const result: TickResult = { checked: [], skipped: [], notified: 0, usage: budget.usage };
  const monitorHashes = await hashMonitorConfigs(config.monitors);
  const context: ScheduledContext = { options, now, budget, store, result, monitorHashes };

  const view = await store.loadView(config.incidents.map(entry => entry.id), config.maintenance.map(entry => entry.id));
  const states = restoreMonitorStates(config.monitors, view.monitors, monitorHashes);
  const projected = projectScheduledView(config, view, states, now);
  assertPublic(projected.snapshot, config, options.secrets);

  const due = states.filter(state => state.next_due_at <= now);
  const hasPublicChange = !sameContent(view.snapshot, projected.snapshot);
  const hasDomainChange = changedRecords(view.incidents, projected.incidents).length > 0 ||
    changedRecords(view.maintenance, projected.maintenance).length > 0;
  const hasRemovedMonitors = view.monitors.some(state => !monitorHashes.has(state.monitor_id));
  const needsHistoryCheckpoint = historyNeedsUpdate(view.history, projected.snapshot.components, now);

  if (due.length || hasPublicChange || hasDomainChange || needsHistoryCheckpoint || hasRemovedMonitors) {
    // Reserve room for the second read, lease release, and at least one snapshot write.
    if (!budget.can({ d1_reads: 4, d1_writes: 3, subrequests: 7 })) {
      result.skipped.push(...due.map(state => state.monitor_id));
      return result;
    }
    const owner = crypto.randomUUID();
    const leaseStartedAt = Date.now();
    if (!await store.acquire(owner, leaseStartedAt)) return result;

    try {
      await commitScheduledChanges(context, owner, leaseStartedAt);
    } catch (error) {
      if (budget.can({ d1_writes: 1, subrequests: 1 })) await store.release(owner);
      throw error;
    }
  }

  result.notified = await deliverPendingNotifications(options, store, budget);
  return result;
}

async function commitScheduledChanges(context: ScheduledContext, owner: string, leaseStartedAt: number): Promise<void> {
  const { options, now, store, budget, monitorHashes } = context;
  const { config } = options;
  // Another invocation may have committed between the initial read and lease acquisition.
  const view = await store.loadView(config.incidents.map(entry => entry.id), config.maintenance.map(entry => entry.id));
  const states = restoreMonitorStates(config.monitors, view.monitors, monitorHashes);
  let projected = projectScheduledView(config, view, states, now);
  const changes: Commit = {
    monitors: [],
    incidents: changedRecords(view.incidents, projected.incidents),
    maintenance: changedRecords(view.maintenance, projected.maintenance),
    snapshot: null,
    events: [],
    remove_monitor_ids: view.monitors.filter(state => !monitorHashes.has(state.monitor_id)).map(state => state.monitor_id)
  };

  const domainEventCount = config.notifications.webhook ? transitionEvents(view.snapshot, projected.snapshot).length : 0;
  const publicationAndLeaseWrites = 2;
  const removedMonitorWrites = changes.remove_monitor_ids?.length ? 1 : 0;
  const reservedWrites = changes.incidents.length + changes.maintenance.length + domainEventCount +
    publicationAndLeaseWrites + removedMonitorWrites;
  if (!budget.can({ d1_writes: reservedWrites, subrequests: reservedWrites })) {
    throw new BudgetExceeded("d1_writes");
  }

  changes.monitors = await executeDueMonitors(context, states, reservedWrites, leaseStartedAt);
  projected = projectScheduledView(config, view, states, now);
  assertPublic(projected.snapshot, config, options.secrets);
  if (!sameContent(view.snapshot, projected.snapshot)) {
    changes.snapshot = projected.snapshot;
    if (config.notifications.webhook) changes.events = transitionEvents(view.snapshot, projected.snapshot);
  }
  if (historyNeedsUpdate(view.history, projected.snapshot.components, now)) {
    changes.history = advanceHistory(view.history, projected.snapshot.components, now);
    // Day rollover updates history without changing the last public status-change time.
    changes.snapshot ??= view.snapshot ?? projected.snapshot;
  }
  await store.commit(owner, changes, Date.now());
}

// Update the in-memory states used for projection and return only rows needing persistence.
async function executeDueMonitors(
  context: ScheduledContext,
  states: MonitorRuntime[],
  reservedWrites: number,
  leaseStartedAt: number
): Promise<MonitorRuntime[]> {
  const { options, now, budget, result } = context;
  const { config } = options;
  const changedStates: MonitorRuntime[] = [];
  const orderedStates = [...states].sort((a, b) =>
    a.next_due_at - b.next_due_at || a.monitor_id.localeCompare(b.monitor_id)
  );

  for (const state of orderedStates) {
    if (state.next_due_at > now) continue;
    const monitor = config.monitors.find(entry => entry.id === state.monitor_id)!;
    // Two writes conservatively reserve the runtime row and a possible transition event.
    const writesPerJob = config.notifications.webhook ? 2 : 1;
    const networkCost = monitor.type === "http" && monitor.follow_redirects ? 6 : 1;
    const requiredWrites = reservedWrites + (changedStates.length + 1) * writesPerJob;
    const exceedsAdmissionWindow = Date.now() - leaseStartedAt + durationMs(monitor.timeout) > 45_000;
    if (exceedsAdmissionWindow || !budget.can({
      due_jobs: 1,
      d1_writes: requiredWrites,
      subrequests: requiredWrites + networkCost
    })) {
      result.skipped.push(monitor.id);
      continue;
    }

    budget.take({ due_jobs: 1 });
    let ok: boolean;
    try {
      ok = (await options.runMonitor(monitor, { io: options.io, budget, now })).ok;
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        result.skipped.push(monitor.id);
        continue;
      }
      throw error;
    }
    const updated = advanceState(state, monitor, ok, now);
    states[states.findIndex(entry => entry.monitor_id === monitor.id)] = updated;
    changedStates.push(updated);
    result.checked.push(monitor.id);
  }
  return changedStates;
}

async function deliverPendingNotifications(options: RunnerOptions, store: D1Store, budget: Budget): Promise<number> {
  if (!options.config.notifications.webhook || !options.notify || !budget.can({ d1_reads: 1, subrequests: 1 })) {
    return 0;
  }
  const events = await store.pending(options.config.budget.max_notifications);
  let notified = 0;
  for (const event of events) {
    if (!budget.can({ d1_writes: 1, notifications: 1, subrequests: 2 })) break;
    // Claim before delivery gives at most one attempt, including overlapping Cron invocations.
    if (!await store.claimEvent(event.id)) continue;
    try {
      await options.notify(event, budget);
      notified++;
    } catch {
      console.warn("StatusFrame webhook delivery failed");
    }
  }
  return notified;
}
