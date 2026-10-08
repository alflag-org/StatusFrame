import { afterEach, describe, expect, it, vi } from "vitest";
import { runMonitor } from "@statusframe/monitors";
import { normalizeDns } from "../../packages/monitors/src/dns";
import type { Monitor, MonitorSocket } from "@statusframe/core";
import { makeBudget, makeConfig, makeIO } from "../helpers";
const monitor = (extra: Record<string, unknown>): Monitor => makeConfig({ monitors: [{ id: "availability-check", component: "web", ...extra }] }).monitors[0]!;
afterEach(() => vi.useRealTimers());

describe("HTTP", () => {
  it.each([["ok", 200, "ok", true], ["ok", 503, "ok", false], ["different", 200, "ok", false]])("checks response body and status", async (body, status, expected, ok) => {
    const result = await runMonitor(monitor({ type: "http", url: "https://example.com/", expect: { status: 200, body_contains: expected } }), { io: makeIO(vi.fn(async () => new Response(body as string, { status: status as number })) as typeof fetch), budget: makeBudget(), now: 0 });
    expect(result.ok).toBe(ok);
  });
  it("cancels the body without downloading when only checking status", async () => {
    const cancel = vi.fn(); const pull = vi.fn();
    const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }));
    const io = makeIO(vi.fn(async () => response) as typeof fetch);
    const result = await runMonitor(monitor({ type: "http", url: "https://example.com/" }), { io, budget: makeBudget(), now: 0 });
    expect(result.ok).toBe(true); expect(cancel).toHaveBeenCalledOnce(); expect(pull).not.toHaveBeenCalled();
  });
  it("handles explicit redirect policy and accounts for every hop", async () => {
    const fetcher = vi.fn().mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: "/health" } })).mockImplementationOnce(async () => new Response("ok"));
    const budget = makeBudget();
    expect((await runMonitor(monitor({ type: "http", url: "https://example.com/", follow_redirects: true }), { io: makeIO(fetcher), budget, now: 0 })).ok).toBe(true);
    expect(budget.usage.subrequests).toBe(2); expect(fetcher.mock.calls[0]?.[1].redirect).toBe("manual");
    const denied = makeIO(vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })) as typeof fetch);
    expect((await runMonitor(monitor({ type: "http", url: "https://example.com/", follow_redirects: true }), { io: denied, budget: makeBudget(), now: 0 })).ok).toBe(false);
    expect(denied.fetch).toHaveBeenCalledOnce();
    expect((await runMonitor(monitor({ type: "http", url: "https://example.com/" }), { io: makeIO(vi.fn(async () => new Response(null, { status: 302 })) as typeof fetch), budget: makeBudget(), now: 0 })).ok).toBe(false);
  });
  it("limits body size and redirect loops", async () => {
    const io = makeIO(vi.fn(async () => new Response("x".repeat(1_048_577))) as typeof fetch);
    expect((await runMonitor(monitor({ type: "http", url: "https://example.com/", expect: { body_contains: "x" } }), { io, budget: makeBudget(), now: 0 })).ok).toBe(false);
    const loop = makeIO(vi.fn(async () => new Response(null, { status: 302, headers: { location: "/" } })) as typeof fetch);
    const budget = makeBudget(); expect((await runMonitor(monitor({ type: "http", url: "https://example.com/", follow_redirects: true }), { io: loop, budget, now: 0 })).ok).toBe(false);
    expect(budget.usage.subrequests).toBe(6);
  });
  it.each(["http://example.com/", "https://127.1/", "https://[::ffff:127.0.0.1]/", "https://host.internal/", "https://user:pass@example.com/"])
    ("rejects unsafe redirect %s before requesting it", async location => {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location } }));
      const result = await runMonitor(monitor({ type: "http", url: "https://example.com/", follow_redirects: true }),
        { io: makeIO(fetcher), budget: makeBudget(), now: 0 });
      expect(result.ok).toBe(false);
      expect(fetcher).toHaveBeenCalledOnce();
    });
  it("does not turn budget starvation into monitor failure", async () => {
    const io = makeIO();
    await expect(runMonitor(monitor({ type: "http", url: "https://example.com/" }), { io, budget: makeBudget({ max_subrequests: 0 }), now: 0 })).rejects.toThrow("Budget exhausted");
    expect(io.fetch).not.toHaveBeenCalled();
  });
});

describe("TCP", () => {
  const tcp = monitor({ type: "tcp", host: "play.example.com", port: 25565 });
  function socket(opened: Promise<unknown>): MonitorSocket {
    return { opened, closed: Promise.resolve(), close: vi.fn(async () => {}), readable: new ReadableStream(), writable: new WritableStream() };
  }
  it.each([true, false])("handles connection success=%s and closes the socket", async ok => {
    const connection = socket(ok ? Promise.resolve() : Promise.reject(new Error("private failure")));
    const io = { ...makeIO(), connect: vi.fn(() => connection) };
    const result = await runMonitor(tcp, { io, budget: makeBudget(), now: 0 });
    expect(result.ok).toBe(ok); expect(connection.close).toHaveBeenCalled(); expect(io.connect).toHaveBeenCalledWith("play.example.com", 25565, false);
    expect(JSON.stringify(result)).not.toContain("private failure");
  });
  it("times out a connection and closes it", async () => {
    vi.useFakeTimers(); const connection = socket(new Promise(() => {}));
    const pending = runMonitor(tcp, { io: { ...makeIO(), connect: () => connection }, budget: makeBudget(), now: 0 });
    await vi.advanceTimersByTimeAsync(5001); expect((await pending).ok).toBe(false); expect(connection.close).toHaveBeenCalled();
  });
});

describe("DNS", () => {
  it.each(["A", "AAAA", "CNAME", "TXT", "MX"] as const)("checks %s records with canonical expectations", async type => {
    const values = { A: [1, "192.0.2.10", "192.0.2.10"], AAAA: [28, "2001:db8::1", "2001:0db8:0:0:0:0:0:1"], CNAME: [5, "Target.Example.com.", "target.example.com"], TXT: [16, '"hello" "world"', "helloworld"], MX: [15, "10 MAIL.example.com.", "10 mail.example.com"] };
    const [number, data, expected] = values[type]!;
    const io = makeIO(vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: number, data }] })) as typeof fetch);
    expect((await runMonitor(monitor({ type: "dns", name: "example.com", record_type: type, expect: { values: [expected] } }), { io, budget: makeBudget(), now: 0 })).ok).toBe(true);
  });
  it.each([{ Status: 3 }, { Status: 0 }, { Status: 0, Answer: [{ type: 1, data: "192.0.2.11" }] }, { Status: 0, Answer: [{ type: 5, data: "example.com" }] }])("fails mismatched/missing answers and NXDOMAIN %j", async data => {
    expect((await runMonitor(monitor({ type: "dns", name: "example.com", record_type: "A", expect: { values: ["192.0.2.10"] } }), { io: makeIO(vi.fn(async () => Response.json(data)) as typeof fetch), budget: makeBudget(), now: 0 })).ok).toBe(false);
  });
  it("normalizes TXT escaped characters", () => expect(normalizeDns("TXT", '"hello\\"world"')).toBe('hello"world'));
  it.each(["invalid-json", " ".repeat(65_537)])("rejects malformed or oversized resolver responses", async body => {
    const result = await runMonitor(monitor({ type: "dns", name: "example.com", record_type: "A" }),
      { io: makeIO(vi.fn<typeof fetch>(async () => new Response(body))), budget: makeBudget(), now: 0 });
    expect(result).toEqual({ ok: false, error_code: "check_failed" });
  });
});

describe("network deadlines", () => {
  it.each(["http", "dns"])("enforces %s timeout even when a transport ignores abort", async type => {
    vi.useFakeTimers();
    const target = type === "http" ? monitor({ type, url: "https://example.com/" }) : monitor({ type, name: "example.com", record_type: "A" });
    const io = makeIO(vi.fn(() => new Promise(() => {})) as typeof fetch);
    const pending = runMonitor(target, { io, budget: makeBudget(), now: 0 });
    await vi.advanceTimersByTimeAsync(5001); expect(await pending).toEqual({ ok: false, error_code: "timeout" });
    expect((io.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1].signal.aborted).toBe(true);
  });
});
