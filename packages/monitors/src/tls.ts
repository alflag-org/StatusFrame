import type { Monitor, MonitorContext } from "@statusframe/core";
import { check, withSocket } from "./common";

export function tlsMonitor(monitor: Extract<Monitor, { type: "tls" }>, context: MonitorContext) {
  return check(monitor, context, async signal => {
    context.budget.take({ subrequests: 1 });
    const socket = context.io.connect(monitor.host, monitor.port, true);
    return withSocket(socket, signal, async () => {
      // Force I/O so a lazily established native TLS stream completes its handshake.
      const writer = socket.writable.getWriter();
      try { await writer.write(new Uint8Array([0])); } finally { writer.releaseLock(); }
      return true;
    });
  });
}
