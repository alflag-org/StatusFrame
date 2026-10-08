import { durationMs, type Monitor } from "./config";
import type { MonitorRuntime } from "./types";
export function initialState(monitor: Monitor, configHash: string): MonitorRuntime {
  return { monitor_id: monitor.id, config_hash: configHash, last_checked_at: null, next_due_at: 0,
    current_state: "unknown", consecutive_failures: 0, consecutive_successes: 0 };
}
export function advanceState(state: MonitorRuntime, monitor: Monitor, ok: boolean, now: number): MonitorRuntime {
  const failures = ok ? 0 : Math.min(state.consecutive_failures + 1, monitor.failure_threshold);
  const successes = ok ? Math.min(state.consecutive_successes + 1, monitor.recovery_threshold) : 0;
  let current = state.current_state;
  if (failures >= monitor.failure_threshold) current = "down";
  if (successes >= monitor.recovery_threshold) current = "up";
  return { ...state, last_checked_at: now, next_due_at: now + durationMs(monitor.interval),
    current_state: current, consecutive_failures: failures, consecutive_successes: successes };
}
