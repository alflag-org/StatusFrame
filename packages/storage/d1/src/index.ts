import type { ComponentState, NormalizedMonitorState, PublicSnapshot, StorageAdapter } from "@statusframe/core";

export interface D1Result {
  success?: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all?<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<D1Result>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch?(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export function createD1Storage(db: D1DatabaseLike): StorageAdapter {
  return {
    name: "d1",
    async loadPublicSnapshot() {
      const row = await db
        .prepare("select snapshot_json from public_snapshots where id = ?")
        .bind("current")
        .first<{ snapshot_json: string }>();
      if (!row) return undefined;
      return JSON.parse(row.snapshot_json) as PublicSnapshot;
    },
    async savePublicSnapshot(snapshot) {
      await db
        .prepare(
          `insert into public_snapshots (id, snapshot_json, created_at)
           values (?, ?, ?)
           on conflict(id) do update set snapshot_json = excluded.snapshot_json, created_at = excluded.created_at`
        )
        .bind("current", JSON.stringify(snapshot), snapshot.site.updated_at)
        .run();
    },
    async loadComponentStates() {
      const statement = db.prepare(
        "select component_id, status, latency_state, updated_at from component_state order by component_id"
      );
      if (!statement.all) return [];
      const rows = await statement.all<{
        component_id: string;
        status: string;
        latency_state: string | null;
        updated_at: string;
      }>();
      return rows.results.map((row) => {
        const state: ComponentState = {
          componentId: row.component_id,
          status: row.status,
          updatedAt: row.updated_at
        };
        if (row.latency_state) state.latencyState = row.latency_state;
        return state;
      });
    },
    async saveComponentStates(states) {
      await runAll(
        db,
        states.map((state) =>
          db
            .prepare(
              `insert into component_state (component_id, status, latency_state, updated_at)
               values (?, ?, ?, ?)
               on conflict(component_id) do update set
                 status = excluded.status,
                 latency_state = excluded.latency_state,
                 updated_at = excluded.updated_at`
            )
            .bind(state.componentId, state.status, state.latencyState ?? null, state.updatedAt)
        )
      );
    },
    async saveMonitorStates(states) {
      await runAll(
        db,
        states.map((state) =>
          db
            .prepare(
              `insert into monitor_state
                 (monitor_id, component_id, status, checked_at, latency_ms, failure_count, last_error_code)
               values (?, ?, ?, ?, ?, ?, ?)
               on conflict(monitor_id) do update set
                 component_id = excluded.component_id,
                 status = excluded.status,
                 checked_at = excluded.checked_at,
                 latency_ms = excluded.latency_ms,
                 failure_count = excluded.failure_count,
                 last_error_code = excluded.last_error_code`
            )
            .bind(
              state.monitorId,
              state.componentId,
              state.ok ? "ok" : "fail",
              state.checkedAt,
              state.latencyMs ?? null,
              state.ok ? 0 : 1,
              state.private?.errorCode ?? null
            )
        )
      );
    }
  };
}

async function runAll(db: D1DatabaseLike, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length === 0) return;
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) {
    await statement.run();
  }
}
