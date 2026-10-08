import type { RunMonitor } from "@statusframe/core";
import { httpMonitor } from "./http";
import { tcpMonitor } from "./tcp";
import { dnsMonitor } from "./dns";
import { tlsMonitor } from "./tls";
export const runMonitor: RunMonitor = (monitor, context) => {
  switch (monitor.type) {
    case "http": return httpMonitor(monitor, context);
    case "tcp": return tcpMonitor(monitor, context);
    case "dns": return dnsMonitor(monitor, context);
    case "tls": return tlsMonitor(monitor, context);
  }
};
export { httpMonitor, tcpMonitor, dnsMonitor, tlsMonitor };
