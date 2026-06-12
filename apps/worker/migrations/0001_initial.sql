create table if not exists monitor_state (
  monitor_id text primary key,
  component_id text not null,
  status text not null,
  checked_at text not null,
  latency_ms integer,
  failure_count integer not null default 0,
  last_error_code text
);

create table if not exists component_state (
  component_id text primary key,
  status text not null,
  latency_state text,
  updated_at text not null
);

create table if not exists state_events (
  id text primary key,
  kind text not null,
  target_id text not null,
  old_status text,
  new_status text not null,
  created_at text not null
);

create table if not exists uptime_buckets (
  component_id text not null,
  bucket_start text not null,
  bucket_size text not null,
  ok_count integer not null default 0,
  fail_count integer not null default 0,
  unknown_count integer not null default 0,
  primary key (component_id, bucket_start, bucket_size)
);

create table if not exists public_snapshots (
  id text primary key,
  snapshot_json text not null,
  created_at text not null
);

create table if not exists incidents (
  id text primary key,
  title text not null,
  status text not null,
  impact text not null,
  body text,
  started_at text not null,
  resolved_at text
);

create table if not exists incident_components (
  incident_id text not null,
  component_id text not null,
  primary key (incident_id, component_id)
);

create table if not exists incident_updates (
  id text primary key,
  incident_id text not null,
  status text not null,
  body text not null,
  created_at text not null
);

create table if not exists maintenance_windows (
  id text primary key,
  title text not null,
  status text not null,
  body text,
  starts_at text not null,
  ends_at text not null
);

create table if not exists maintenance_components (
  maintenance_id text not null,
  component_id text not null,
  primary key (maintenance_id, component_id)
);
