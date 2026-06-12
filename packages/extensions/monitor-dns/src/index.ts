import { defineExtension, type MonitorResult } from "@statusframe/core";

export function dnsMonitor() {
  return defineExtension({
    manifest: {
      name: "@statusframe/monitor-dns",
      kind: "monitor",
      monitorTypes: ["dns"],
      capabilities: ["network:dns"],
      scaffold: true,
      cost: {
        subrequestsPerRun: 1,
        expectedCpuMs: 1
      },
      defaultRedaction: {
        exposeTarget: false,
        exposeError: false,
        exposeLatency: false
      }
    },
    async runMonitor(ctx) {
      const result: MonitorResult = {
        ok: false,
        checkedAt: ctx.now.toISOString(),
        private: {
          errorCode: "dns_monitor_scaffold"
        }
      };
      if (ctx.monitor.target && result.private) result.private.target = ctx.monitor.target;
      return result;
    }
  });
}
