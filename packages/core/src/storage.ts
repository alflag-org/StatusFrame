import { Budget } from "./budget";
import { incidentSchema, maintenanceSchema, type Incident, type Maintenance } from "./config";
import { parseHistory, type HistoryState } from "./history";
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

const leaseGuard = "EXISTS (SELECT 1 FROM scheduler_lock WHERE id = 1 AND owner = ? AND expires_at > ?)";

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
    const [row] = await this.read<{ snapshot_json: string; history_json: string | null }>(
      "SELECT snapshot_json, history_json FROM public_snapshot WHERE id = 1"
    );
    return {
      snapshot: row ? JSON.parse(row.snapshot_json) as PublicSnapshot : null,
      history: row?.history_json ? parseHistory(row.history_json) : null
    };
  }

  async loadView(incidentIds: string[] = [], maintenanceIds: string[] = []): Promise<StoredView> {
    const monitors = await this.read<MonitorRuntime>("SELECT * FROM monitor_runtime");
    const incidentRows = await this.loadIncidentRows(incidentIds);
    const maintenanceRows = await this.loadMaintenanceRows(maintenanceIds);
    const { snapshot, history } = await this.loadPublication();
    return {
      monitors,
      incidents: incidentRows.map(row => incidentSchema.parse(JSON.parse(row.record_json))),
      maintenance: maintenanceRows.map(row => maintenanceSchema.parse(JSON.parse(row.record_json))),
      snapshot,
      history
    };
  }

  private async loadIncidentRows(configuredIds: string[]): Promise<{ record_json: string }[]> {
    // Active entries are never displaced by historical records in the bounded public view.
    return this.read<{ record_json: string }>(`SELECT record_json FROM (
      SELECT id, record_json FROM (SELECT id, record_json FROM incidents WHERE status != 'resolved' ORDER BY started_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM (SELECT id, record_json FROM incidents WHERE status = 'resolved' ORDER BY started_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM incidents WHERE id IN (SELECT value FROM json_each(?))
    )`, [JSON.stringify(configuredIds)]);
  }

  private async loadMaintenanceRows(configuredIds: string[]): Promise<{ record_json: string }[]> {
    return this.read<{ record_json: string }>(`SELECT record_json FROM (
      SELECT id, record_json FROM (SELECT id, record_json FROM maintenance WHERE status IN ('scheduled', 'in_progress') ORDER BY starts_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM (SELECT id, record_json FROM maintenance WHERE status IN ('completed', 'cancelled') ORDER BY starts_at DESC LIMIT 50)
      UNION SELECT id, record_json FROM maintenance WHERE id IN (SELECT value FROM json_each(?))
    )`, [JSON.stringify(configuredIds)]);
  }

  async acquire(owner: string, now: number): Promise<boolean> {
    const statement = this.db.prepare(
      "UPDATE scheduler_lock SET owner = ?, expires_at = ? WHERE id = 1 AND expires_at <= ?"
    ).bind(owner, now + 120_000, now);
    const [result] = await this.write([statement]);
    return result?.meta.changes === 1;
  }

  async release(owner: string): Promise<void> {
    const statement = this.db.prepare(
      "UPDATE scheduler_lock SET owner = NULL, expires_at = 0 WHERE id = 1 AND owner = ?"
    ).bind(owner);
    await this.write([statement]);
  }

  async commit(owner: string, changes: Commit, wallNow: number): Promise<void> {
    const statements: D1PreparedStatement[] = [
      ...changes.monitors.map(monitor => this.prepareMonitorWrite(monitor, owner, wallNow)),
      ...changes.incidents.map(incident => this.prepareIncidentWrite(incident, owner, wallNow)),
      ...changes.maintenance.map(entry => this.prepareMaintenanceWrite(entry, owner, wallNow))
    ];
    if (changes.snapshot) {
      statements.push(this.preparePublicationWrite(changes.snapshot, changes.history, owner, wallNow));
    }
    for (const event of changes.events) {
      statements.push(this.db.prepare(`INSERT INTO notification_outbox (id, created_at, event_json)
        SELECT ?, ?, ? WHERE ${leaseGuard}`)
        .bind(event.id, event.created_at, JSON.stringify(event), owner, wallNow));
    }
    if (changes.remove_monitor_ids?.length) {
      statements.push(this.db.prepare(`DELETE FROM monitor_runtime
        WHERE monitor_id IN (SELECT value FROM json_each(?)) AND ${leaseGuard}`)
        .bind(JSON.stringify(changes.remove_monitor_ids), owner, wallNow));
    }
    // Keep all guarded mutations and lease release in the same D1 batch transaction.
    statements.push(this.db.prepare(
      "UPDATE scheduler_lock SET owner = NULL, expires_at = 0 WHERE id = 1 AND owner = ? AND expires_at > ?"
    ).bind(owner, wallNow));
    const results = await this.write(statements);
    if (results.at(-1)?.meta.changes !== 1) throw new Error("Scheduler lease expired");
  }

  private prepareMonitorWrite(monitor: MonitorRuntime, owner: string, wallNow: number): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO monitor_runtime
      (monitor_id, config_hash, last_checked_at, next_due_at, current_state, consecutive_failures, consecutive_successes)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${leaseGuard}
      ON CONFLICT(monitor_id) DO UPDATE SET config_hash = excluded.config_hash, last_checked_at = excluded.last_checked_at,
      next_due_at = excluded.next_due_at, current_state = excluded.current_state,
      consecutive_failures = excluded.consecutive_failures, consecutive_successes = excluded.consecutive_successes`)
      .bind(
        monitor.monitor_id, monitor.config_hash, monitor.last_checked_at, monitor.next_due_at,
        monitor.current_state, monitor.consecutive_failures, monitor.consecutive_successes,
        owner, wallNow
      );
  }

  private prepareIncidentWrite(incident: Incident, owner: string, wallNow: number): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO incidents (id, started_at, status, record_json)
      SELECT ?, ?, ?, ? WHERE ${leaseGuard}
      ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, status = excluded.status, record_json = excluded.record_json`)
      .bind(incident.id, incident.started_at, incident.status, JSON.stringify(incident), owner, wallNow);
  }

  private prepareMaintenanceWrite(maintenance: Maintenance, owner: string, wallNow: number): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO maintenance (id, starts_at, status, record_json)
      SELECT ?, ?, ?, ? WHERE ${leaseGuard}
      ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, status = excluded.status, record_json = excluded.record_json`)
      .bind(maintenance.id, maintenance.starts_at, maintenance.status, JSON.stringify(maintenance), owner, wallNow);
  }

  private preparePublicationWrite(
    snapshot: PublicSnapshot,
    history: HistoryState | undefined,
    owner: string,
    wallNow: number
  ): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO public_snapshot (id, snapshot_json, history_json)
      SELECT 1, ?, ? WHERE ${leaseGuard}
      ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json,
      history_json = COALESCE(excluded.history_json, public_snapshot.history_json)`)
      .bind(JSON.stringify(snapshot), history ? JSON.stringify(history) : null, owner, wallNow);
  }

  async pending(limit: number): Promise<NotificationEvent[]> {
    if (!limit) return [];
    const rows = await this.read<{ event_json: string }>(
      "SELECT event_json FROM notification_outbox ORDER BY created_at, id LIMIT ?", [limit]
    );
    return rows.map(row => JSON.parse(row.event_json) as NotificationEvent);
  }

  async claimEvent(id: string): Promise<boolean> {
    const [result] = await this.write([
      this.db.prepare("DELETE FROM notification_outbox WHERE id = ?").bind(id)
    ]);
    return result?.meta.changes === 1;
  }
}
