import type { Monitor, MonitorContext } from "@statusframe/core";
import { check, withSocket } from "./common";
export function tcpMonitor(monitor: Extract<Monitor, { type: "tcp" }>, context: MonitorContext) {
  return check(monitor, context, async signal => {
    context.budget.take({ subrequests: 1 });
    return withSocket(context.io.connect(monitor.host, monitor.port, false), signal, async () => true);
  });
}
