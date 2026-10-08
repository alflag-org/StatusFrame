import { Budget } from "./budget";
import { incidentSchema, maintenanceSchema } from "./config";
import { parseHistory, type HistoryState } from "./history";
import type { Incident, Maintenance } from "./config";
import type { MonitorRuntime, NotificationEvent, PublicSnapshot, StoredView } from "./types";

export interface Commit {
  monitors: MonitorRuntime[];
  incidents: Incident[];
  maintenance: Maintenance[];
  snapshot: PublicSnapshot | null;
  history?: HistoryState;
  events: NotificationEvent[];
  remove_monitor_ids?: string[];
}
export class D1Store {
  constructor(private readonly db: D1Database, readonly budget: Budget) {}
  private async read<T>(sql: string, values: (string | number)[] = []): Promise<T[]> {
    this.budget.take({ d1_reads: 1, subrequests: 1 });
    const result = await this.db.prepare(sql).bind(...values).all<T>();
    return result.results;
  }
  private async write(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    if (!statements.length) return [];
    this.budget.take({ d1_writes: statements.length, subrequests: statements.length });
    return this.db.batch(statements);
  }
  async loadSnapshot(): Promise<PublicSnapshot | null> {
    return (await this.loadPublication()).snapshot;
  }
  async loadPublication(): Promise<{ snapshot: PublicSnapshot | null; history: HistoryState | null }> {
    const [row] = await this.read<{ snapshot_json: string; history_json: string | null }>("SELECT snapshot_json, history_json FROM public_snapshot WHERE id = 1");
    return { snapshot: row ? JSON.parse(row.snapshot_json) as PublicSnapshot : null,
      history: row?.history_json ? parseHistory(row.history_json) : null };
  }
  async loadView(incidentIds: string[] = [], maintenanceIds: string[] = []): Promise<StoredView> {
    const monitors = await this.read<MonitorRuntime>("SELECT * FROM monitor_runtime");
    // Active entries are never displaced by historical records in the bounded public view.
    const incidentRows = await this.read<{ record_json: string }>(`SELECT record_json FROM (
      SELECT id, record_json FROM (SELECT id, record_json FROM incidents WHERE status != 'resolved' ORDER BY started_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM (SELECT id, record_json FROM incidents WHERE status = 'resolved' ORDER BY started_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM incidents WHERE id IN (SELECT value FROM json_each(?))
    )`, [JSON.stringify(incidentIds)]);
    const maintenanceRows = await this.read<{ record_json: string }>(`SELECT record_json FROM (
      SELECT id, record_json FROM (SELECT id, record_json FROM maintenance WHERE status IN ('scheduled', 'in_progress') ORDER BY starts_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM (SELECT id, record_json FROM maintenance WHERE status IN ('completed', 'cancelled') ORDER BY starts_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM maintenance WHERE id IN (SELECT value FROM json_each(?))
    )`, [JSON.stringify(maintenanceIds)]);
    const { snapshot, history } = await this.loadPublication();
    return { monitors, incidents: incidentRows.map(v => incidentSchema.parse(JSON.parse(v.record_json))),
      maintenance: maintenanceRows.map(v => maintenanceSchema.parse(JSON.parse(v.record_json))), snapshot, history };
  }
  async acquire(owner: string, now: number): Promise<boolean> {
    const [result] = await this.write([this.db.prepare("UPDATE scheduler_lock SET owner = ?, expires_at = ? WHERE id = 1 AND expires_at <= ?").bind(owner, now + 120_000, now)]);
    return result?.meta.changes === 1;
  }
  async release(owner: string): Promise<void> {
    await this.write([this.db.prepare("UPDATE scheduler_lock SET owner = NULL, expires_at = 0 WHERE id = 1 AND owner = ?").bind(owner)]);
  }
  async commit(owner: string, changes: Commit, wallNow: number): Promise<void> {
    const guard = "EXISTS (SELECT 1 FROM scheduler_lock WHERE id = 1 AND owner = ? AND expires_at > ?)";
    const statements: D1PreparedStatement[] = [];
    for (const v of changes.monitors) statements.push(this.db.prepare(`INSERT INTO monitor_runtime
      (monitor_id, config_hash, last_checked_at, next_due_at, current_state, consecutive_failures, consecutive_successes)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
      ON CONFLICT(monitor_id) DO UPDATE SET config_hash = excluded.config_hash, last_checked_at = excluded.last_checked_at,
      next_due_at = excluded.next_due_at, current_state = excluded.current_state,
      consecutive_failures = excluded.consecutive_failures, consecutive_successes = excluded.consecutive_successes`)
      .bind(v.monitor_id, v.config_hash, v.last_checked_at, v.next_due_at, v.current_state, v.consecutive_failures, v.consecutive_successes, owner, wallNow));
    for (const v of changes.incidents) statements.push(this.db.prepare(`INSERT INTO incidents (id, started_at, status, record_json)
      SELECT ?, ?, ?, ? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, status = excluded.status, record_json = excluded.record_json`)
      .bind(v.id, v.started_at, v.status, JSON.stringify(v), owner, wallNow));
    for (const v of changes.maintenance) statements.push(this.db.prepare(`INSERT INTO maintenance (id, starts_at, status, record_json)
      SELECT ?, ?, ?, ? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, status = excluded.status, record_json = excluded.record_json`)
      .bind(v.id, v.starts_at, v.status, JSON.stringify(v), owner, wallNow));
    if (changes.snapshot) statements.push(this.db.prepare(`INSERT INTO public_snapshot (id, snapshot_json, history_json)
      SELECT 1, ?, ? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json,
      history_json = COALESCE(excluded.history_json, public_snapshot.history_json)`)
      .bind(JSON.stringify(changes.snapshot), changes.history ? JSON.stringify(changes.history) : null, owner, wallNow));
    for (const v of changes.events) statements.push(this.db.prepare(`INSERT INTO notification_outbox (id, created_at, event_json)
      SELECT ?, ?, ? WHERE ${guard}`).bind(v.id, v.created_at, JSON.stringify(v), owner, wallNow));
    if (changes.remove_monitor_ids?.length) statements.push(this.db.prepare(`DELETE FROM monitor_runtime
      WHERE monitor_id IN (SELECT value FROM json_each(?)) AND ${guard}`).bind(JSON.stringify(changes.remove_monitor_ids), owner, wallNow));
    statements.push(this.db.prepare("UPDATE scheduler_lock SET owner = NULL, expires_at = 0 WHERE id = 1 AND owner = ? AND expires_at > ?").bind(owner, wallNow));
    const results = await this.write(statements);
    if (results.at(-1)?.meta.changes !== 1) throw new Error("Scheduler lease expired");
  }
  async pending(limit: number): Promise<NotificationEvent[]> {
    if (!limit) return [];
    const rows = await this.read<{ event_json: string }>("SELECT event_json FROM notification_outbox ORDER BY created_at, id LIMIT ?", [limit]);
    return rows.map(v => JSON.parse(v.event_json) as NotificationEvent);
  }
  async claimEvent(id: string): Promise<boolean> {
    const [result] = await this.write([this.db.prepare("DELETE FROM notification_outbox WHERE id = ?").bind(id)]);
    return result?.meta.changes === 1;
  }
}
