import { describe, expect, it } from "vitest";
import { advanceHistory, historyNeedsUpdate, parseHistory, presentHistory, project, renderStatusPage, assertPublic, type PublicComponent } from "@statusframe/core";
import { makeConfig } from "../helpers";
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

describe("status page", () => {
  it("renders localized status, accessible daily data and escaped operator text", () => {
    const config = makeConfig({ site: { name: "Status <script>", language: "ja", timezone: "Asia/Tokyo" } });
    const snapshot = project(config, [], [], [], now);
    snapshot.components = presentHistory(null, snapshot.components, now);
    assertPublic(snapshot, config);
    const html = renderStatusPage(snapshot);
    expect(html).toContain('lang="ja"');
    expect(html).toContain("Status &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("サービス");
    expect(html).toContain("データなし");
    expect(html).not.toContain("100.00%");
    expect(html).toContain('<th scope="col">日付（UTC）</th>');
    expect(html).toContain('href="#maintenance"');
    expect((html.match(/class="history-day /g) ?? [])).toHaveLength(90);
    expect(html).not.toContain("website-check");
  });
  it("renders English and separates active incidents from resolved history", () => {
    const config = makeConfig({ incidents: [
      { id: "active", title: "Current disruption", status: "investigating", impact: "degraded", components: ["web"], started_at: new Date(now).toISOString() },
      { id: "past", title: "Previous disruption", status: "resolved", impact: "degraded", components: ["web"], started_at: new Date(now - hour).toISOString(), resolved_at: new Date(now).toISOString() }
    ] });
    const html = renderStatusPage(project(config, [], config.incidents, [], now));
    expect(html).toContain('lang="en"');
    expect(html.indexOf("Current disruption")).toBeLessThan(html.indexOf('id="services"'));
    expect(html.indexOf("Previous disruption")).toBeGreaterThan(html.indexOf('id="incidents"'));
  });
  it.each(["en", "ja"] as const)("keeps maintenance groups and missing-history bars in %s", language => {
    const config = makeConfig({ site: { name: "Status", language, timezone: "UTC" } });
    const snapshot = project(config, [], [], [], now);
    snapshot.maintenance = (["scheduled", "in_progress", "completed", "cancelled"] as const).map(status => ({
      id: status.replace("_", "-"),
      title: `${status} <&>`,
      status,
      components: ["web"],
      starts_at: new Date(now).toISOString(),
      ends_at: new Date(now + hour).toISOString(),
      body: "First line\nSecond line <script>"
    }));
    const html = renderStatusPage(snapshot);
    const pastSection = html.indexOf('class="past-maintenance"');
    expect(html.indexOf("scheduled &lt;&amp;&gt;")).toBeLessThan(pastSection);
    expect(html.indexOf("in_progress &lt;&amp;&gt;")).toBeLessThan(pastSection);
    expect(html.indexOf("completed &lt;&amp;&gt;")).toBeGreaterThan(pastSection);
    expect(html.indexOf("cancelled &lt;&amp;&gt;")).toBeGreaterThan(pastSection);
    expect(html).toContain("First line\nSecond line &lt;script&gt;");
    expect(html).toContain(language === "ja" ? "対象: Web" : "Affected services: Web");
    expect((html.match(/class="history-day unknown"/g) ?? [])).toHaveLength(90);
    expect(html).not.toContain("<table>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('<link');
  });
  it("displays daily rows newest first without reordering the supplied history", () => {
    const config = makeConfig();
    const snapshot = project(config, [], [], [], now);
    snapshot.components = presentHistory(null, snapshot.components, now);
    const before = JSON.stringify(snapshot);
    const days = snapshot.components[0]!.history!.days;
    const html = renderStatusPage(snapshot);
    const rows = [...html.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map(match => match[1]);
    expect(rows).toEqual([...days].reverse().map(day => day.date));
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
