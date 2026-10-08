import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { parseYaml, project } from "@statusframe/core";

async function bundle(entryPoint: string) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    external: ["node:*", "cloudflare:*"], loader: { ".yml": "text" }, conditions: ["workerd", "worker", "import"], logLevel: "silent" });
  return result.outputFiles[0]!.text;
}
describe("real Worker routes and public safety", () => {
  let mf: Miniflare;
  let db: D1Database;
  beforeAll(async () => {
    mf = new Miniflare({ modules: true, script: await bundle("apps/worker/src/index.ts"), compatibilityDate: "2026-06-11", compatibilityFlags: ["nodejs_compat"], d1Databases: { STATUSFRAME_DB: "worker-test" } });
    db = await mf.getD1Database("STATUSFRAME_DB") as unknown as D1Database;
    const sql = (await Promise.all((await readdir("apps/worker/migrations")).filter(name => name.endsWith(".sql")).sort()
      .map(name => readFile(`apps/worker/migrations/${name}`, "utf8")))).join("\n");
    await db.batch(sql.split(";").map(v => v.trim()).filter(Boolean).map(v => db.prepare(v)));
  });
  afterAll(async () => { await mf.dispose(); });
  beforeEach(async () => { await db.prepare("DELETE FROM public_snapshot").run(); });
  it.each(["/", "/api/status", "/api/incidents", "/api/maintenance"])("serves %s from D1 without private monitoring data", async path => {
    const response = await mf.dispatchFetch(`https://status.example.net${path}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const forbidden of ["website-check", "https://example.com/", "config_hash", "stack", "STATUSFRAME_DB"]) expect(body).not.toContain(forbidden);
    if (path === "/api/status") expect(JSON.parse(body).components[0].status).toBe("unknown");
  });
  it("starts with unknown and does not save snapshots or scheduler state on public requests", async () => {
    const response = await mf.dispatchFetch("https://status.example.net/api/status");
    const snapshot = await response.json() as { site: { status: string } };
    expect(snapshot.site.status).toBe("unknown");
    expect((await db.prepare("SELECT COUNT(*) AS n FROM public_snapshot").first<{ n: number }>())?.n).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM monitor_runtime").first<{ n: number }>())?.n).toBe(0);
  });
  it("removes administration and push routes; refuses public mutations", async () => {
    for (const path of ["/api/admin/config", "/api/push"]) expect((await mf.dispatchFetch(`https://status.example.net${path}`, { method: "POST" })).status).toBe(404);
    expect((await mf.dispatchFetch("https://status.example.net/api/status", { method: "POST" })).status).toBe(405);
    const head = await mf.dispatchFetch("https://status.example.net/", { method: "HEAD" }); expect(head.status).toBe(200); expect(await head.text()).toBe("");
  });
  it("renders incident updates and maintenance, escaping HTML", async () => {
    const config = parseYaml(await readFile("apps/worker/statusframe.yml", "utf8"));
    const snapshot = project(config, [], [{ id: "web-disruption", title: "Web <script> disruption", status: "resolved", impact: "degraded", components: ["web"], started_at: "2026-01-01T00:00:00Z", resolved_at: "2026-01-01T01:00:00Z", updates: [{ status: "resolved", body: "Recovered <img onerror=evil>", created_at: "2026-01-01T01:00:00Z" }] }], [{ id: "web-upgrade", title: "Web upgrade", status: "completed", components: ["web"], starts_at: "2026-01-02T00:00:00Z", ends_at: "2026-01-02T01:00:00Z", body: "Upgrade completed." }], Date.parse("2026-01-03T00:00:00Z"));
    await db.prepare("INSERT INTO public_snapshot(id, snapshot_json) VALUES(1, ?)").bind(JSON.stringify(snapshot)).run();
    const html = await (await mf.dispatchFetch("https://status.example.net/")).text();
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain("Recovered &lt;img"); expect(html).toContain("Upgrade completed.");
    const incidents = await (await mf.dispatchFetch("https://status.example.net/api/incidents")).json() as { incidents: Array<{ status: string }> };
    expect(incidents.incidents[0]?.status).toBe("resolved");
  });
  it("fails closed on corrupted/leaking stored snapshots without exposing diagnostics", async () => {
    const config = parseYaml(await readFile("apps/worker/statusframe.yml", "utf8"));
    const snapshot = { ...project(config, [], [], [], 0), monitor_error: "private-stack-and-token" };
    await db.prepare("INSERT INTO public_snapshot(id, snapshot_json) VALUES(1, ?)").bind(JSON.stringify(snapshot)).run();
    const response = await mf.dispatchFetch("https://status.example.net/api/status"); expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"Status temporarily unavailable"}');
  });
});
