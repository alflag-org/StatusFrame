import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare, createFetchMock } from "miniflare";

// Real workerd fetch validates RequestInit before the mocked external response is used.
// This catches Workers-only differences that a plain function mock cannot detect.
describe("Workers fetch compatibility", () => {
  it("checks DNS and sends signed webhooks without following redirects", async () => {
    const mock = createFetchMock(); mock.disableNetConnect();
    mock.get("https://cloudflare-dns.com").intercept({ method: "GET", path: "/dns-query?name=example.com&type=A" }).reply(200, JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "192.0.2.10" }] }));
    mock.get("https://hooks.example.com").intercept({ method: "POST", path: "/events" }).reply(204);
    mock.get("https://hooks.example.com").intercept({ method: "POST", path: "/redirect" }).reply(302, "", { headers: { location: "https://should-not-be-called.example.com/" } });
    const source = `
      import { parseConfig, Budget } from '@statusframe/core';
      import { runMonitor } from '@statusframe/monitors';
      import { sendWebhook } from '@statusframe/notifications';
      const config = parseConfig({site:{name:'Status'},components:[{id:'web',name:'Web'}],monitors:[{id:'dns-check',component:'web',type:'dns',name:'example.com',record_type:'A',expect:{values:['192.0.2.10']}}]});
      export default {async fetch() {
        const budget = new Budget(config.budget);
        const io = {fetch:(...args)=>fetch(...args),connect:()=>{throw new Error('Unexpected connection')}};
        const dns = await runMonitor(config.monitors[0],{io,budget,now:Date.now()});
        const event = {id:'event-1',type:'component_status_changed',subject_id:'web',previous_status:'major_outage',status:'operational',created_at:new Date().toISOString()};
        await sendWebhook(event,{STATUSFRAME_WEBHOOK_URL:'https://hooks.example.com/events',STATUSFRAME_WEBHOOK_SECRET:'test-signing-key'},budget);
        let redirectRejected=false;
        try {await sendWebhook(event,{STATUSFRAME_WEBHOOK_URL:'https://hooks.example.com/redirect'},budget);}catch {redirectRejected=true;}
        return Response.json({dns,redirectRejected,usage:budget.usage});
      }};`;
    const built = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "neutral", external: ["node:*", "cloudflare:*"], conditions: ["workerd", "import"], logLevel: "silent" });
    const mf = new Miniflare({ modules: true, script: built.outputFiles[0]!.text, compatibilityDate: "2026-06-11", compatibilityFlags: ["nodejs_compat"], fetchMock: mock });
    try {
      const response = await mf.dispatchFetch("https://test.example.net/");
      expect(response.status).toBe(200);
      const result = await response.json() as { dns: { ok: boolean }; redirectRejected: boolean; usage: { subrequests: number; notifications: number } };
      expect(result.dns.ok).toBe(true); expect(result.redirectRejected).toBe(true);
      expect(result.usage).toMatchObject({ subrequests: 3, notifications: 2 }); mock.assertNoPendingInterceptors();
    } finally { await mf.dispose(); await mock.close(); }
  });
});
