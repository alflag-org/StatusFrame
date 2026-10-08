import { describe, expect, it } from "vitest";
import { advanceState, initialState, parseConfig, parseYaml, project, assertPublic, durationMs } from "@statusframe/core";
import { makeConfig } from "../helpers";

describe("configuration", () => {
  it("loads YAML and explicit defaults", () => {
    const config = parseYaml("site:\n  name: Status\ncomponents:\n  - id: web\n    name: Web\n");
    expect(config.monitors).toEqual([]); expect(config.budget.max_due_jobs).toBe(10);
    expect(durationMs("14d")).toBe(1_209_600_000);
  });
  it.each([{ features: {} }, { status_inputs: [] }, { storage: { adapter: "static" } }, { notifications: { url: "https://example.com/" } }])("rejects obsolete/generic configuration %j", extra => expect(() => makeConfig(extra)).toThrow());
  it.each(["http://127.0.0.1/", "http://0x7f000001/", "http://10.1.1.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://host.internal/", "https://user:pass@example.com/"])("rejects private or credentialed target %s", url => expect(() => makeConfig({ monitors: [{ id: "check", component: "web", type: "http", url }] })).toThrow());
  it("rejects unknown types, references, duplicate IDs, and invalid timings", () => {
    const m = makeConfig().monitors[0]!;
    for (const extra of [{ type: "snmp" }, { interval: "30s" }, { timeout: "31s" }, { failure_threshold: 0 }, { component: "absent" }, { id: "web" }]) expect(() => makeConfig({ monitors: [{ ...m, ...extra }] })).toThrow();
    expect(() => makeConfig({ monitors: [m, m] })).toThrow();
    expect(() => parseYaml("site: {}\nsite: {}\n")).toThrow();
  });
});

describe("thresholds and public aggregation", () => {
  it("holds unknown initially, requires failures/recovery, and saturates counters", () => {
    const monitor = makeConfig().monitors[0]!;
    let state = initialState(monitor, "hash");
    state = advanceState(state, monitor, false, 0); expect(state.current_state).toBe("unknown");
    state = advanceState(state, monitor, false, 60_000); expect(state.current_state).toBe("unknown");
    state = advanceState(state, monitor, false, 120_000); expect(state.current_state).toBe("down");
    state = advanceState(state, monitor, true, 180_000); expect(state.current_state).toBe("down");
    state = advanceState(state, monitor, false, 240_000); expect(state.consecutive_successes).toBe(0);
    state = advanceState(state, monitor, true, 300_000); state = advanceState(state, monitor, true, 360_000);
    expect(state.current_state).toBe("up");
    state = advanceState(state, monitor, false, 420_000); expect(state.current_state).toBe("up");
    state = advanceState(state, monitor, true, 480_000); expect(state.consecutive_failures).toBe(0);
    for (let i = 0; i < 100; i++) state = advanceState(state, monitor, true, 500_000 + i);
    expect(state.consecutive_successes).toBe(2);
  });
  it.each([
    [[], "unknown"], [["up"], "operational"], [["down"], "major_outage"],
    [["up", "down"], "partial_outage"], [["up", "unknown"], "unknown"], [["down", "unknown"], "partial_outage"]
  ] as const)("aggregates %j into %s", (input, status) => {
    const config = makeConfig({ monitors: input.map((_, i) => ({ ...makeConfig().monitors[0], id: `check-${i}` })) });
    const states = config.monitors.map((m, i) => ({ ...initialState(m, "hash"), current_state: input[i]! }));
    expect(project(config, states, [], [], 0).components[0]?.status).toBe(status);
  });
  it("applies active incident impact without exposing private fields", () => {
    const config = makeConfig({ incidents: [{ id: "web-incident", title: "Web disruption", status: "investigating", impact: "degraded", components: ["web"], started_at: "2026-01-01T00:00:00Z" }] });
    const state = { ...initialState(config.monitors[0]!, "hash"), current_state: "up" as const, raw_error: "secret stack", url: "https://example.com/private" };
    const snapshot = project(config, [state], config.incidents, [], 0);
    assertPublic(snapshot, config); expect(snapshot.site.status).toBe("degraded");
    expect(JSON.stringify(snapshot)).not.toContain("secret stack"); expect(JSON.stringify(snapshot)).not.toContain("website-check");
  });
  it("rejects extra public keys and leaked operator prose", () => {
    const config = makeConfig(); const snapshot = project(config, [], [], [], 0);
    expect(() => assertPublic({ ...snapshot, monitor: {} }, config)).toThrow();
    for (const name of ["website-check", "example.com", "10.0.0.1", "fe80::1", "https://example.com/", "secret=abcd"]) {
      expect(() => assertPublic({ ...snapshot, site: { ...snapshot.site, name } }, config)).toThrow();
    }
    expect(() => assertPublic({ ...snapshot, site: { ...snapshot.site, name: "secret-string" } }, config, ["secret-string"])).toThrow();
  });
});
