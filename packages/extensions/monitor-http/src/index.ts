import { defineExtension, type MonitorExecutionContext, type MonitorResult } from "@statusframe/core";

export function httpMonitor() {
  return defineExtension({
    manifest: {
      name: "@statusframe/monitor-http",
      kind: "monitor",
      monitorTypes: ["http"],
      capabilities: ["network:http", "latency"],
      cost: {
        subrequestsPerRun: 1,
        d1ReadsPerRun: 0,
        d1WritesPerRun: 0,
        maxConcurrency: 4,
        expectedCpuMs: 1
      },
      defaultRedaction: {
        exposeTarget: false,
        exposeError: false,
        exposeLatency: false
      }
    },
    runMonitor: runHttpMonitor
  });
}

export async function runHttpMonitor(ctx: MonitorExecutionContext): Promise<MonitorResult> {
  const target = ctx.monitor.target;
  if (!target) {
    return failure(ctx, "missing_target");
  }

  const expectStatus = ctx.monitor.expect?.status ?? 200;
  const bodyKeyword = ctx.monitor.expect?.body_contains;
  const method = ctx.monitor.method ?? (bodyKeyword ? "GET" : "HEAD");
  const started = Date.now();

  try {
    const init: RequestInit = {
      method,
      redirect: ctx.monitor.follow_redirects ? "follow" : "manual"
    };
    if (ctx.signal) init.signal = ctx.signal;
    const response = await ctx.fetch(target, init);
    const latencyMs = Date.now() - started;
    let ok = response.status === expectStatus;

    if (bodyKeyword) {
      const body = await response.text();
      ok = ok && body.includes(bodyKeyword);
    }

    const result: MonitorResult = {
      ok,
      checkedAt: ctx.now.toISOString(),
      latencyMs,
      private: {
        target
      },
      publicHint: {
        latencyState: latencyState(latencyMs)
      }
    };
    if (!ok && result.private) result.private.errorCode = "unexpected_response";
    return result;
  } catch (error) {
    return {
      ok: false,
      checkedAt: ctx.now.toISOString(),
      latencyMs: Date.now() - started,
      private: {
        target,
        errorCode: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "request_failed",
        errorMessage: error instanceof Error ? error.message : "HTTP monitor failed"
      }
    };
  }
}

function failure(ctx: MonitorExecutionContext, errorCode: string): MonitorResult {
  return {
    ok: false,
    checkedAt: ctx.now.toISOString(),
    private: {
      errorCode
    }
  };
}

function latencyState(latencyMs: number): string {
  if (latencyMs < 500) return "normal";
  if (latencyMs < 1500) return "elevated";
  return "high";
}
