CREATE TABLE monitor_runtime (
  monitor_id TEXT PRIMARY KEY,
  config_hash TEXT NOT NULL,
  last_checked_at INTEGER,
  next_due_at INTEGER NOT NULL,
  current_state TEXT NOT NULL CHECK(current_state IN ('unknown', 'up', 'down')),
  consecutive_failures INTEGER NOT NULL CHECK(consecutive_failures >= 0),
  consecutive_successes INTEGER NOT NULL CHECK(consecutive_successes >= 0)
);
CREATE TABLE public_snapshot (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
);
CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  record_json TEXT NOT NULL CHECK(json_valid(record_json))
);
CREATE INDEX incidents_active ON incidents(started_at DESC) WHERE status != 'resolved';
CREATE INDEX incidents_history ON incidents(started_at DESC) WHERE status = 'resolved';
CREATE TABLE maintenance (
  id TEXT PRIMARY KEY,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  record_json TEXT NOT NULL CHECK(json_valid(record_json))
);
CREATE INDEX maintenance_active ON maintenance(starts_at DESC) WHERE status IN ('scheduled', 'in_progress');
CREATE INDEX maintenance_history ON maintenance(starts_at DESC) WHERE status IN ('completed', 'cancelled');
CREATE TABLE scheduler_lock (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  owner TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO scheduler_lock(id) VALUES (1);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK(json_valid(event_json))
);
