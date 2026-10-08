import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Budget, D1Store, createRunner, project, type Config, type RunMonitor, type NotificationEvent, type Incident } from "@statusframe/core";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeConfig, makeIO } from "../helpers";
import { database } from "./helpers";

const now = Date.parse("2026-01-01T00:00:00Z");
describe("D1 scheduler, domains, and notifications", () => {
  let db: D1Database;
  let dispose: () => Promise<void>;
  beforeAll(async () => { ({ db, dispose } = await database()); });
  beforeEach(async () => {
    await db.batch(["monitor_runtime", "public_snapshot", "incidents", "maintenance", "notification_outbox"]
      .map(table => db.prepare(`DELETE FROM ${table}`)));
    await db.prepare("UPDATE scheduler_lock SET owner = NULL, expires_at = 0 WHERE id = 1").run();
  });
  afterAll(async () => { await dispose(); });
  const runner = (config: Config, runMonitor: RunMonitor, notify?: (event: NotificationEvent) => Promise<void>) => createRunner({ config, db, io: makeIO(), runMonitor,
    ...(notify ? { notify: async (event, budget) => { budget.take({ notifications: 1, subrequests: 1 }); await notify(event); } } : {}) });
  async function row() { return db.prepare("SELECT * FROM monitor_runtime WHERE monitor_id = 'website-check'").first<Record<string, unknown>>(); }

  it("executes only due monitors; restarting the runner preserves interval, state, and counters", async () => {
    const config = makeConfig(); const check = vi.fn(async () => ({ ok: true }));
    const first = await runner(config, check).runScheduled(now);
    expect(first.checked).toEqual(["website-check"]); expect((await row())?.next_due_at).toBe(now + 300_000);
    const skipped = await runner(config, check).runScheduled(now + 60_000);
    expect(skipped.checked).toEqual([]); expect(skipped.usage.d1_writes).toBe(0); expect(check).toHaveBeenCalledOnce();
    await runner(config, check).runScheduled(now + 300_000);
    expect(check).toHaveBeenCalledTimes(2); expect((await row())?.current_state).toBe("up");
    expect((await runner(config, check).getSnapshot()).components[0]?.status).toBe("operational");
  });
  it("handles distinct monitor intervals and never catches up missed checks in a burst", async () => {
    const config = makeConfig({ monitors: [
      { ...makeConfig().monitors[0], id: "one-minute", interval: "1m" },
      { ...makeConfig().monitors[0], id: "five-minute", interval: "5m" },
      { ...makeConfig().monitors[0], id: "fifteen-minute", interval: "15m" }
    ] });
    const check = vi.fn(async () => ({ ok: true }));
    await runner(config, check).runScheduled(now);
    expect((await runner(config, check).runScheduled(now + 60_000)).checked).toEqual(["one-minute"]);
    const delayed = await runner(config, check).runScheduled(now + 3_600_000);
    expect(delayed.checked).toHaveLength(3);
    const rows = await db.prepare("SELECT next_due_at FROM monitor_runtime").all<{ next_due_at: number }>();
    expect(rows.results.every(v => v.next_due_at > now + 3_600_000)).toBe(true);
  });
  it("updates only due timestamps when public content is unchanged", async () => {
    const config = makeConfig({ monitors: [{ ...makeConfig().monitors[0], recovery_threshold: 1 }] });
    const check = vi.fn(async () => ({ ok: true }));
    await runner(config, check).runScheduled(now);
    const before = await runner(config, check).getSnapshot(now);
    const savedBefore = await db.prepare("SELECT snapshot_json, history_json FROM public_snapshot").first();
    const second = await runner(config, check).runScheduled(now + 300_000);
    const after = await runner(config, check).getSnapshot(now + 300_000);
    expect(after.site).toEqual(before.site); expect(second.usage.d1_writes).toBe(3);
    expect(after.components[0]?.history?.days.at(-1)?.known_ms).toBe(300_000);
    expect(await db.prepare("SELECT snapshot_json, history_json FROM public_snapshot").first()).toEqual(savedBefore); // acquire, runtime row, release
    expect((await row())?.last_checked_at).toBe(now + 300_000);
  });
  it("suppresses repeated notifications and emits one per actual component transition", async () => {
    const config = makeConfig({ notifications: { webhook: true }, monitors: [{ ...makeConfig().monitors[0], interval: "1m", failure_threshold: 2, recovery_threshold: 2 }] });
    const notify = vi.fn(async (_event: NotificationEvent) => {}); let ok = true;
    const check = vi.fn(async () => ({ ok }));
    await runner(config, check, notify).runScheduled(now);
    await runner(config, check, notify).runScheduled(now + 60_000); // unknown -> up
    ok = false;
    await runner(config, check, notify).runScheduled(now + 120_000); expect(notify).toHaveBeenCalledTimes(1);
    await runner(config, check, notify).runScheduled(now + 180_000); expect(notify).toHaveBeenCalledTimes(2);
    await runner(config, check, notify).runScheduled(now + 240_000); expect(notify).toHaveBeenCalledTimes(2);
    ok = true;
    await runner(config, check, notify).runScheduled(now + 300_000); expect(notify).toHaveBeenCalledTimes(2);
    await runner(config, check, notify).runScheduled(now + 360_000); expect(notify).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls[2]?.[0].status).toBe("operational");
    expect(JSON.stringify(notify.mock.calls)).not.toContain("website-check");
  });
  it("claims notification delivery only once if the webhook fails", async () => {
    const config = makeConfig({ notifications: { webhook: true }, monitors: [{ ...makeConfig().monitors[0], recovery_threshold: 1 }] });
    const check = vi.fn(async () => ({ ok: true })); const notify = vi.fn(async (_event: NotificationEvent) => { throw new Error("secret failure"); });
    await runner(config, check, notify).runScheduled(now);
    const failed = vi.fn(async () => ({ ok: false }));
    for (let i = 1; i <= 4; i++) await runner(config, failed, notify).runScheduled(now + i * 300_000);
    expect(notify).toHaveBeenCalledOnce();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").first<{ n: number }>())?.n).toBe(0);
  });
  it("allows only one overlapping Cron invocation to execute due work", async () => {
    const config = makeConfig(); const check = vi.fn(async () => ({ ok: true }));
    await Promise.all([runner(config, check).runScheduled(now), runner(config, check).runScheduled(now)]);
    expect(check).toHaveBeenCalledOnce(); expect((await row())?.consecutive_successes).toBe(1);
  });
  it("resets monitor runtime when its configuration changes", async () => {
    const config = makeConfig(); const check = vi.fn(async () => ({ ok: true }));
    await runner(config, check).runScheduled(now);
    const modified = makeConfig({ monitors: [{ ...config.monitors[0], interval: "15m" }] });
    await runner(modified, check).runScheduled(now + 60_000);
    expect(check).toHaveBeenCalledTimes(2); expect((await row())?.next_due_at).toBe(now + 960_000);
    expect((await row())?.consecutive_successes).toBe(1);
  });
  it("accounts for actual D1 reads and writes and stops before exceeding budgets", async () => {
    const normal = makeConfig(); const check = vi.fn(async () => ({ ok: true }));
    await runner(normal, check).runScheduled(now);
    const limited = makeConfig({ budget: { max_d1_reads: 4, max_d1_writes: 0, max_subrequests: 4 } });
    const tick = await runner(limited, check).runScheduled(now + 300_000);
    expect(tick.usage.d1_reads).toBe(4); expect(tick.usage.d1_writes).toBe(0); expect(tick.usage.subrequests).toBe(4);
    expect(check).toHaveBeenCalledOnce();
    const rows = await row(); expect(rows?.last_checked_at).toBe(now);
  });
  it("does not execute jobs after max_due_jobs is reached", async () => {
    const config = makeConfig({ budget: { max_due_jobs: 1 }, monitors: [
      { ...makeConfig().monitors[0], id: "first-check" }, { ...makeConfig().monitors[0], id: "second-check" }
    ] });
    const check = vi.fn(async () => ({ ok: true }));
    const first = await runner(config, check).runScheduled(now); expect(first.checked).toHaveLength(1); expect(first.skipped).toHaveLength(1);
    const second = await runner(config, check).runScheduled(now + 60_000); expect(second.checked).toEqual(first.skipped);
  });
  it("preserves exact operation costs for baseline, idle, unchanged, and notification ticks", async () => {
    const config = makeConfig({
      notifications: { webhook: true },
      monitors: [{ ...makeConfig().monitors[0], recovery_threshold: 1, failure_threshold: 1 }]
    });
    let ok = true;
    const check: RunMonitor = async (_monitor, context) => {
      context.budget.take({ subrequests: 1 });
      return { ok };
    };
    const notify = vi.fn(async (_event: NotificationEvent) => {});
    const scheduled = runner(config, check, notify);

    const baseline = await scheduled.runScheduled(now);
    expect(baseline.usage).toEqual({
      d1_reads: 9, d1_writes: 4, subrequests: 14, notifications: 0, due_jobs: 1
    });
    const idle = await scheduled.runScheduled(now + 60_000);
    expect(idle.usage).toEqual({
      d1_reads: 5, d1_writes: 0, subrequests: 5, notifications: 0, due_jobs: 0
    });
    const unchanged = await scheduled.runScheduled(now + 300_000);
    expect(unchanged.usage).toEqual({
      d1_reads: 9, d1_writes: 3, subrequests: 13, notifications: 0, due_jobs: 1
    });
    ok = false;
    const transition = await scheduled.runScheduled(now + 600_000);
    expect(transition.usage).toEqual({
      d1_reads: 9, d1_writes: 6, subrequests: 17, notifications: 1, due_jobs: 1
    });
    expect(transition.notified).toBe(1);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      type: "component_status_changed", previous_status: "operational", status: "major_outage"
    });
  });
  it("admits TLS checks using the cost of one native secure connection", async () => {
    const config = makeConfig({ budget: { max_subrequests: 13 }, monitors: [
      { id: "certificate-check", component: "web", type: "tls", host: "tls.example.com", recovery_threshold: 1 }
    ] });
    const check = vi.fn<RunMonitor>(async (_monitor, context) => {
      context.budget.take({ subrequests: 1 }); return { ok: true };
    });
    const tick = await runner(config, check).runScheduled(now);
    expect(tick.checked).toEqual(["certificate-check"]); expect(tick.skipped).toEqual([]);
    expect(tick.usage.subrequests).toBe(13);
    expect((await runner(config, check).getSnapshot()).components[0]?.status).toBe("operational");
  });
  it("persists incidents and maintenance, keeps history when omitted, and notifies lifecycle changes", async () => {
    const notify = vi.fn(async (_event: NotificationEvent) => {}); const check = vi.fn(async () => ({ ok: true }));
    const base = makeConfig({ monitors: [], notifications: { webhook: true } });
    await runner(base, check, notify).runScheduled(now);
    const incident = { id: "web-disruption", title: "Web disruption", status: "investigating", impact: "degraded", components: ["web"], started_at: new Date(now).toISOString(), updates: [{ status: "investigating", body: "We are investigating service disruption.", created_at: new Date(now).toISOString() }] };
    const maintenance = { id: "web-upgrade", title: "Service upgrade", status: "scheduled", components: ["web"], starts_at: new Date(now + 120_000).toISOString(), ends_at: new Date(now + 180_000).toISOString(), body: "Web may be briefly unavailable." };
    const config = makeConfig({ monitors: [], notifications: { webhook: true }, incidents: [incident], maintenance: [maintenance] });
    await runner(config, check, notify).runScheduled(now + 60_000);
    expect(notify.mock.calls.map(v => v[0].type)).toEqual(expect.arrayContaining(["incident_created", "maintenance_scheduled"]));
    const read = await runner(base, check, notify).getSnapshot(); expect(read.incidents).toHaveLength(1); expect(read.maintenance).toHaveLength(1);
    await runner(base, check, notify).runScheduled(now + 120_000);
    expect((await runner(base, check).getSnapshot()).maintenance[0]?.status).toBe("in_progress");
    await runner(base, check, notify).runScheduled(now + 180_000);
    expect((await runner(base, check).getSnapshot()).maintenance[0]?.status).toBe("completed");
    const resolved = makeConfig({ monitors: [], notifications: { webhook: true }, incidents: [{ ...incident, status: "resolved", resolved_at: new Date(now + 240_000).toISOString(), updates: [...incident.updates, { status: "resolved", body: "Service recovered.", created_at: new Date(now + 240_000).toISOString() }] }] });
    await runner(resolved, check, notify).runScheduled(now + 240_000);
    expect((await runner(base, check).getSnapshot()).incidents[0]?.status).toBe("resolved");
    expect(notify.mock.calls.map(v => v[0].type)).toContain("incident_resolved");
    expect((await runner(base, check).runScheduled(now + 300_000)).usage.d1_writes).toBe(0);
  });
  it("persists older incident edits outside the public window without rewriting the snapshot", async () => {
    const incidents: Incident[] = Array.from({ length: 80 }, (_, i) => ({
      id: `history-${i}`, title: `Service interruption ${i}`, status: "resolved", impact: "degraded", components: ["web"],
      started_at: new Date(now + i * 60_000).toISOString(), resolved_at: new Date(now + (i + 1) * 60_000).toISOString(), updates: []
    }));
    await db.batch(incidents.map(v => db.prepare("INSERT INTO incidents(id, started_at, status, record_json) VALUES(?, ?, ?, ?)").bind(v.id, v.started_at, v.status, JSON.stringify(v))));
    const config = makeConfig({ monitors: [] }); const check = vi.fn(async () => ({ ok: true }));
    await runner(config, check).runScheduled(now);
    const before = await runner(config, check).getSnapshot(); expect(before.incidents).toHaveLength(50);
    const edited = makeConfig({ monitors: [], incidents: [{ ...incidents[0], title: "Corrected historical description" }] });
    await runner(edited, check).runScheduled(now + 60_000);
    const record = await db.prepare("SELECT record_json FROM incidents WHERE id = 'history-0'").first<{ record_json: string }>();
    expect(JSON.parse(record!.record_json).title).toBe("Corrected historical description");
    expect(await runner(config, check).getSnapshot()).toEqual(before);
    expect((await runner(edited, check).runScheduled(now + 120_000)).usage.d1_writes).toBe(0);
  });
  it("deletes removed monitor runtime instead of accumulating obsolete private state", async () => {
    const config = makeConfig(); const check = vi.fn(async () => ({ ok: true }));
    await runner(config, check).runScheduled(now);
    await runner(makeConfig({ monitors: [] }), check).runScheduled(now + 60_000);
    expect(await row()).toBeNull();
    expect((await runner(makeConfig({ monitors: [] }), check).runScheduled(now + 120_000)).usage.d1_writes).toBe(0);
  });
  it("reloads runtime after disposing and recreating the actual workerd/D1 process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "statusframe-d1-"));
    const config = makeConfig(); const check = vi.fn(async () => ({ ok: true }));
    const persistentRunner = (database: D1Database) => createRunner({ config, db: database, io: makeIO(), runMonitor: check });
    try {
      const first = await database(directory);
      try { await persistentRunner(first.db).runScheduled(now); } finally { await first.dispose(); }
      const second = await database(directory, false);
      try {
        const tick = await persistentRunner(second.db).runScheduled(now + 60_000);
        expect(tick.checked).toEqual([]); expect(tick.usage.d1_writes).toBe(0);
        expect(check).toHaveBeenCalledOnce();
      } finally { await second.dispose(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("checkpoints UTC midnight without a due check, extra reads, or a status notification", async () => {
    const config = makeConfig({ notifications: { webhook: true }, monitors: [{ ...makeConfig().monitors[0], interval: "30d", recovery_threshold: 1 }] });
    const notify = vi.fn(async (_event: NotificationEvent) => {});
    const check = vi.fn(async () => ({ ok: true }));
    const start = now + 23 * 3_600_000;
    await runner(config, check, notify).runScheduled(start);
    const stored = await db.prepare("SELECT snapshot_json FROM public_snapshot").first();
    const tick = await runner(config, check, notify).runScheduled(start + 3_600_000);
    expect(check).toHaveBeenCalledOnce(); expect(notify).not.toHaveBeenCalled();
    expect(tick.usage).toMatchObject({ d1_reads: 9, d1_writes: 3 });
    expect(await db.prepare("SELECT snapshot_json FROM public_snapshot").first()).toEqual(stored);
    const snapshot = await runner(config, check).getSnapshot(start + 2 * 3_600_000);
    expect(snapshot.components[0]?.history?.days.at(-2)).toMatchObject({ date: "2026-01-01", known_ms: 3_600_000, uptime_percent: 100 });
    expect(snapshot.components[0]?.history?.days.at(-1)).toMatchObject({ date: "2026-01-02", known_ms: 3_600_000, uptime_percent: 100 });
  });
  it("persists duration history atomically with outages and prunes it after 90 days", async () => {
    const config = makeConfig({ monitors: [{ ...makeConfig().monitors[0], recovery_threshold: 1, failure_threshold: 1 }] });
    await runner(config, async () => ({ ok: true })).runScheduled(now);
    await runner(config, async () => ({ ok: false })).runScheduled(now + 3_600_000);
    const snapshot = await runner(config, async () => ({ ok: false })).getSnapshot(now + 2 * 3_600_000);
    expect(snapshot.components[0]?.status).toBe("major_outage");
    expect(snapshot.components[0]?.history?.uptime_percent).toBe(50);
    expect(snapshot.components[0]?.history?.days.at(-1)).toMatchObject({ known_ms: 2 * 3_600_000, status: "major_outage" });
    const saved = await db.prepare("SELECT history_json FROM public_snapshot").first();
    await runner(config, async () => ({ ok: false })).getSnapshot(now + 4 * 3_600_000);
    expect(await db.prepare("SELECT history_json FROM public_snapshot").first()).toEqual(saved);
    await runner(config, async () => ({ ok: true })).runScheduled(now + 120 * 86_400_000);
    const record = await db.prepare("SELECT history_json FROM public_snapshot").first<{ history_json: string }>();
    const history = JSON.parse(record!.history_json);
    expect(history.components[0].days).toHaveLength(89);
    expect(history.components[0].days[0].date).toBe("2026-02-01");
    expect(record!.history_json).not.toContain("website-check");
  });
  it("does not let a stale scheduler lease publish a snapshot", async () => {
    const config = makeConfig(); const store = new D1Store(db, new Budget(config.budget));
    await store.acquire("old-owner", 0); await store.acquire("new-owner", 120_001);
    await expect(store.commit("old-owner", { monitors: [], incidents: [], maintenance: [], events: [], snapshot: project(config, [], [], [], 0) }, 120_001)).rejects.toThrow("lease expired");
    expect(await store.loadSnapshot()).toBeNull();
  });
});



describe("history migration", () => {
  it("preserves an existing snapshot and starts without backfilled history", async () => {
    const { db, dispose } = await database(undefined, false);
    try {
      const initial = await readFile("apps/worker/migrations/0001_initial.sql", "utf8");
      await db.batch(initial.split(";").map(v => v.trim()).filter(Boolean).map(v => db.prepare(v)));
      const config = makeConfig();
      const snapshot = project(config, [], [], [], now);
      await db.prepare("INSERT INTO public_snapshot(id, snapshot_json) VALUES(1, ?)").bind(JSON.stringify(snapshot)).run();
      await db.prepare(await readFile("apps/worker/migrations/0002_status_history.sql", "utf8")).run();
      const store = new D1Store(db, new Budget(config.budget));
      expect(await store.loadPublication()).toEqual({ snapshot, history: null });
      const publicSnapshot = await createRunner({ config, db, io: makeIO(), runMonitor: async () => ({ ok: true }) }).getSnapshot(now);
      expect(publicSnapshot.components[0]?.history?.uptime_percent).toBeNull();
    } finally { await dispose(); }
  });
});
