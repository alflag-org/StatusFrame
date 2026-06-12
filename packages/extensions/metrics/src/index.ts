import { defineExtension, type PublicComponentMetrics, type StatusFrameExtension } from "@statusframe/core";

export function metricsExtension(): StatusFrameExtension {
  return defineExtension({
    manifest: {
      name: "@statusframe/metrics",
      kind: "feature",
      capabilities: ["metrics"],
      cost: {
        d1ReadsPerRun: 0,
        expectedCpuMs: 1
      }
    },
    projectPublic(ctx) {
      if (!ctx.config.features.metrics.enabled) return {};
      const componentMetrics: Record<string, PublicComponentMetrics> = {};
      for (const component of ctx.config.components) {
        const metrics: PublicComponentMetrics = {};
        if (component.public_metrics?.uptime?.enabled) {
          metrics.uptime = {
            label: `${component.public_metrics.uptime.window_days}d uptime available`,
            window_days: component.public_metrics.uptime.window_days
          };
        }
        if (component.public_metrics?.latency?.enabled) {
          const state = ctx.componentStates.find((item) => item.componentId === component.id)?.latencyState ?? "unknown";
          metrics.latency = { state };
        }
        if (metrics.uptime || metrics.latency) {
          componentMetrics[component.id] = metrics;
        }
      }
      return { componentMetrics };
    }
  });
}
