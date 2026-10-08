import { BudgetExceeded, durationMs, type Monitor, type MonitorContext, type MonitorResult, type MonitorSocket } from "@statusframe/core";
export async function withDeadline<T>(timeout: number, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeout);
  });
  try { return await Promise.race([action(controller.signal), deadline]); }
  finally { clearTimeout(timer!); controller.abort(); }
}
export async function check(monitor: Monitor, context: MonitorContext, action: (signal: AbortSignal) => Promise<boolean>): Promise<MonitorResult> {
  try { return { ok: await withDeadline(durationMs(monitor.timeout), action) }; }
  catch (error) {
    if (error instanceof BudgetExceeded) throw error;
    return { ok: false, error_code: error instanceof Error && error.message === "timeout" ? "timeout" : "check_failed" };
  }
}
export async function boundedText(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new Error("Response too large");
      chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(bytes);
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function withSocket<T>(socket: MonitorSocket, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  // An unopened/failed socket can reject both promises; consume both paths.
  void socket.closed.catch(() => {});
  void socket.opened.catch(() => {});
  const close = () => { void socket.close().catch(() => {}); };
  signal.addEventListener("abort", close, { once: true });
  try { signal.throwIfAborted(); await socket.opened; return await action(); }
  finally { signal.removeEventListener("abort", close); await socket.close().catch(() => {}); }
}
