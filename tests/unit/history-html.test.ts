import { describe, expect, it } from "vitest";
import { advanceHistory, historyNeedsUpdate, parseHistory, presentHistory, type PublicComponent } from "@statusframe/core";
const hour = 3_600_000;
const now = Date.parse("2026-01-01T23:00:00Z");
const components: PublicComponent[] = [{ id: "web", name: "Web", status: "operational" }];

describe("90-day published status history", () => {
  it("starts without fabricated uptime and preserves unknown time", () => {
    let history = advanceHistory(null, [{ ...components[0]!, status: "unknown" }], now);
    expect(presentHistory(history, components, now)[0]?.history?.uptime_percent).toBeNull();
    history = advanceHistory(history, components, now + hour);
    const result = presentHistory(history, components, now + 2 * hour)[0]!.history!;
    expect(result.days).toHaveLength(90);
    expect(result.days.filter(day => day.uptime_percent !== null)).toHaveLength(1);
    expect(result.days.at(-2)).toMatchObject({ date: "2026-01-01", known_ms: 0, status: "unknown", uptime_percent: null });
    expect(result.days.at(-1)).toMatchObject({ date: "2026-01-02", known_ms: hour, uptime_percent: 100 });
    expect(result.uptime_percent).toBe(100);
  });
  it("splits spans at UTC midnight and weights uptime by duration", () => {
    let history = advanceHistory(null, components, now);
    const down: PublicComponent[] = [{ ...components[0]!, status: "major_outage" }];
    history = advanceHistory(history, down, now + 2 * hour);
    const result = presentHistory(history, down, now + 3 * hour)[0]!.history!;
    expect(result.days.at(-2)).toMatchObject({ date: "2026-01-01", known_ms: hour, status: "operational", uptime_percent: 100 });
    expect(result.days.at(-1)).toMatchObject({ date: "2026-01-02", known_ms: 2 * hour, status: "major_outage", uptime_percent: 50 });
    expect(result.uptime_percent).toBeCloseTo(200 / 3);
    expect(historyNeedsUpdate(history, down, now + 2 * hour + 60_000)).toBe(false);
    expect(historyNeedsUpdate(history, components, now + 2 * hour + 60_000)).toBe(true);
  });
  it("retains only 90 calendar days and removes deleted components", () => {
    const initial = advanceHistory(null, components, now);
    const later = now + 120 * 24 * hour;
    const history = advanceHistory(initial, components, later);
    expect(history.components[0]?.days).toHaveLength(90);
    expect(history.components[0]?.days[0]?.date).toBe("2026-02-01");
    expect(presentHistory(history, components, later)[0]?.history?.uptime_percent).toBe(100);
    expect(advanceHistory(history, [], later).components).toEqual([]);
    expect(historyNeedsUpdate(initial, components, now + hour)).toBe(true);
  });
  it("does not mutate stored history while extending the current span", () => {
    const history = advanceHistory(null, components, now);
    const saved = JSON.stringify(history);
    presentHistory(history, components, now + hour);
    expect(JSON.stringify(history)).toBe(saved);
    expect(parseHistory(saved)).toEqual(history);
    expect(() => parseHistory(JSON.stringify({ ...history, private_target: "hidden" }))).toThrow();
  });
});
