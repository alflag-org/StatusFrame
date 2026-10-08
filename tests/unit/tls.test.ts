import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExceeded, type MonitorSocket } from "@statusframe/core";
import { runMonitor } from "@statusframe/monitors";
import { makeBudget, makeConfig, makeIO } from "../helpers";

const monitor = makeConfig({ monitors: [
  { id: "tls-check", component: "web", type: "tls", host: "tls.example.com" }
] }).monitors[0]!;

function socket(extra: Partial<MonitorSocket> = {}): MonitorSocket {
  return { opened: Promise.resolve(), closed: Promise.resolve(), close: vi.fn(async () => {}),
    readable: new ReadableStream({}, { highWaterMark: 0 }), writable: new WritableStream(), ...extra };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("native TLS boundary", () => {
  it("uses one secure connection, forces handshake I/O, and never reads a separate certificate sample", async () => {
    const read = vi.fn(() => { throw new Error("Unauthenticated sample must not be read"); });
    const write = vi.fn();
    const connection = socket({ readable: new ReadableStream({ pull: read }, { highWaterMark: 0 }),
      writable: new WritableStream({ write }) });
    const connect = vi.fn(() => connection);
    const budget = makeBudget({ max_subrequests: 1 });

    const result = await runMonitor(monitor, { io: { ...makeIO(), connect }, budget, now: 0 });

    expect(result).toEqual({ ok: true });
    expect(connect).toHaveBeenCalledExactlyOnceWith("tls.example.com", 443, true);
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect((write.mock.calls[0]?.[0] as Uint8Array).length).toBeGreaterThan(0);
    expect(read).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(budget.usage.subrequests).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for native handshake I/O before reporting success", async () => {
    let completeHandshake!: () => void;
    const write = vi.fn(() => new Promise<void>(resolve => { completeHandshake = resolve; }));
    const connection = socket({ writable: new WritableStream({ write }) });
    let completed = false;
    const pending = runMonitor(monitor, { io: { ...makeIO(), connect: () => connection }, budget: makeBudget(), now: 0 })
      .then(result => { completed = true; return result; });

    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    expect(connection.close).not.toHaveBeenCalled();

    completeHandshake();
    expect(await pending).toEqual({ ok: true });
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it.each(["open", "write"] as const)("normalizes native verification failure during %s and closes the socket", async phase => {
    const failure = new Error("Private TLS verification details");
    const write = vi.fn(() => { if (phase === "write") throw failure; });
    const connection = socket({ opened: phase === "open" ? Promise.reject(failure) : Promise.resolve(),
      closed: Promise.reject(failure), writable: new WritableStream({ write }) });
    const connect = vi.fn(() => connection);

    expect(await runMonitor(monitor, { io: { ...makeIO(), connect }, budget: makeBudget(), now: 0 }))
      .toEqual({ ok: false, error_code: "check_failed" });
    expect(connection.close).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledExactlyOnceWith("tls.example.com", 443, true);
    if (phase === "open") expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["open", "write"] as const)("times out a stalled %s and closes the socket", async phase => {
    const stalled = new Promise<never>(() => {});
    const connection = socket({ opened: phase === "open" ? stalled : Promise.resolve(),
      writable: new WritableStream({ write: () => stalled }) });
    const pending = runMonitor(monitor, { io: { ...makeIO(), connect: () => connection }, budget: makeBudget(), now: 0 });

    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual({ ok: false, error_code: "timeout" });
    expect(connection.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not open a socket when its network budget is exhausted", async () => {
    const io = makeIO();
    await expect(runMonitor(monitor, { io, budget: makeBudget({ max_subrequests: 0 }), now: 0 }))
      .rejects.toBeInstanceOf(BudgetExceeded);
    expect(io.connect).not.toHaveBeenCalled();
  });

  it("rejects unsupported expiry configuration instead of silently accepting it", () => {
    expect(() => makeConfig({ monitors: [{ ...monitor, expire_before: "14d" }] })).toThrow();
  });
});
