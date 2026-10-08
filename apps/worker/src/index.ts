import { connect } from "cloudflare:sockets";
import { createRunner, renderStatusPage, type PublicSnapshot, type RuntimeIO } from "@statusframe/core";
import { runMonitor } from "@statusframe/monitors";
import { sendWebhook, type WebhookBindings } from "@statusframe/notifications";
import { config } from "./config";

export interface Env extends WebhookBindings {
  STATUSFRAME_DB: D1Database;
}

const io: RuntimeIO = {
  fetch: (...args) => fetch(...args),
  connect: (hostname, port, secure) => connect(
    { hostname, port },
    { secureTransport: secure ? "on" : "off", allowHalfOpen: false }
  )
};

function createWorkerRunner(env: Env) {
  if (!env.STATUSFRAME_DB) throw new Error("D1 binding is required");
  if (config.notifications.webhook && !env.STATUSFRAME_WEBHOOK_URL) {
    throw new Error("Webhook binding is required");
  }
  return createRunner({
    config,
    db: env.STATUSFRAME_DB,
    io,
    runMonitor,
    secrets: [env.STATUSFRAME_WEBHOOK_URL ?? "", env.STATUSFRAME_WEBHOOK_SECRET ?? ""],
    ...(config.notifications.webhook ? { notify: (event, budget) => sendWebhook(event, env, budget) } : {})
  });
}

function publicResponse(path: string, snapshot: PublicSnapshot): Response {
  const headers = {
    "cache-control": "public, max-age=30",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer"
  };
  switch (path) {
    case "/":
      return new Response(renderStatusPage(snapshot), {
        headers: { ...headers, "content-type": "text/html; charset=utf-8" }
      });
    case "/api/incidents":
      return Response.json({ incidents: snapshot.incidents }, { headers });
    case "/api/maintenance":
      return Response.json({ maintenance: snapshot.maintenance }, { headers });
    default:
      return Response.json(snapshot, { headers });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!["/", "/api/status", "/api/incidents", "/api/maintenance"].includes(path)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json({ error: "Method not allowed" }, {
        status: 405, headers: { allow: "GET, HEAD" }
      });
    }
    try {
      const snapshot = await createWorkerRunner(env).getSnapshot();
      const response = publicResponse(path, snapshot);
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch {
      console.error("StatusFrame public request failed");
      return Response.json({ error: "Status temporarily unavailable" }, {
        status: 503, headers: { "cache-control": "no-store" }
      });
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const scheduled = createWorkerRunner(env).runScheduled().then(result => {
      console.info(JSON.stringify({
        checked: result.checked.length,
        skipped: result.skipped.length,
        notified: result.notified,
        usage: result.usage
      }));
    }).catch(() => {
      console.error("StatusFrame scheduled run failed");
      throw new Error("StatusFrame scheduled run failed");
    });
    ctx.waitUntil(scheduled);
  }
} satisfies ExportedHandler<Env>;
