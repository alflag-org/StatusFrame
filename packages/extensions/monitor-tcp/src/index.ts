import { defineExtension, type MonitorExecutionContext, type MonitorResult, type TcpConnector } from "@statusframe/core";

export interface TcpMonitorOptions {
  connect?: TcpConnector;
}

export function tcpMonitor(options: TcpMonitorOptions = {}) {
  return defineExtension({
    manifest: {
      name: "@statusframe/monitor-tcp",
      kind: "monitor",
      monitorTypes: ["tcp"],
      capabilities: ["network:tcp", "latency"],
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
    runMonitor: (ctx) => runTcpMonitor(ctx, options.connect)
  });
}

export async function runTcpMonitor(ctx: MonitorExecutionContext, fallbackConnect?: TcpConnector): Promise<MonitorResult> {
  const parsed = parseTcpTarget(ctx.monitor);
  if (!parsed) {
    return {
      ok: false,
      checkedAt: ctx.now.toISOString(),
      private: {
        errorCode: "invalid_tcp_target"
      }
    };
  }

  const connect = ctx.tcpConnect ?? fallbackConnect;
  if (!connect) {
    return {
      ok: false,
      checkedAt: ctx.now.toISOString(),
      private: {
        target: `${parsed.hostname}:${parsed.port}`,
        errorCode: "tcp_connector_unavailable"
      }
    };
  }

  const started = Date.now();
  try {
    const connectOptions: Parameters<TcpConnector>[0] = {
      hostname: parsed.hostname,
      port: parsed.port
    };
    if (ctx.signal) connectOptions.signal = ctx.signal;
    const connection = await connect(connectOptions);
    await connection.opened;
    await connection.close?.();
    const latencyMs = Date.now() - started;
    return {
      ok: true,
      checkedAt: ctx.now.toISOString(),
      latencyMs,
      private: {
        target: `${parsed.hostname}:${parsed.port}`
      },
      publicHint: {
        latencyState: latencyMs < 500 ? "normal" : "elevated"
      }
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt: ctx.now.toISOString(),
      latencyMs: Date.now() - started,
      private: {
        target: `${parsed.hostname}:${parsed.port}`,
        errorCode: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "connection_failed",
        errorMessage: error instanceof Error ? error.message : "TCP monitor failed"
      }
    };
  }
}

function parseTcpTarget(monitor: MonitorExecutionContext["monitor"]): { hostname: string; port: number } | undefined {
  if (monitor.host && monitor.port) {
    return { hostname: monitor.host, port: monitor.port };
  }
  if (!monitor.target) return undefined;
  const [hostname, portText] = monitor.target.split(":");
  const port = Number(portText);
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { hostname, port };
}
