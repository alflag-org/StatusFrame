import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationEvent } from "@statusframe/core";
import { sendWebhook } from "@statusframe/notifications";
import { makeBudget } from "../helpers";

const event: NotificationEvent = { id: "event-1", type: "component_status_changed", subject_id: "web",
  previous_status: "major_outage", status: "operational", created_at: "2026-01-01T00:00:00Z" };
const bindings = { STATUSFRAME_WEBHOOK_URL: "https://hooks.example.com/events", STATUSFRAME_WEBHOOK_SECRET: "private-signing-key" };
afterEach(() => vi.restoreAllMocks());

describe("webhook delivery", () => {
  it("signs the exact public payload and includes its event ID without disclosing the key", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const budget = makeBudget();
    await sendWebhook(event, bindings, budget, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(url).toBe(bindings.STATUSFRAME_WEBHOOK_URL);
    expect(init!.method).toBe("POST");
    expect(init!.body).toBe(JSON.stringify(event));
    expect(init!.redirect).toBe("manual");
    expect(headers["x-statusframe-event-id"]).toBe(event.id);
    expect(headers["x-statusframe-signature"]).toBe(createHmac("sha256", bindings.STATUSFRAME_WEBHOOK_SECRET).update(JSON.stringify(event)).digest("hex"));
    expect(String(init!.body)).not.toContain(bindings.STATUSFRAME_WEBHOOK_SECRET);
    expect(budget.usage.notifications).toBe(1);
    expect(budget.usage.subrequests).toBe(1);
  });

  it("allows unsigned delivery when no signing secret is configured", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await sendWebhook(event, { STATUSFRAME_WEBHOOK_URL: bindings.STATUSFRAME_WEBHOOK_URL }, makeBudget(), fetcher);
    expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty("x-statusframe-signature");
  });

  it.each([undefined, "http://hooks.example.com/", "https://127.0.0.1/", "https://user:pass@hooks.example.com/"])
    ("rejects unsafe destination %s before network I/O", async url => {
      const fetcher = vi.fn<typeof fetch>();
      const budget = makeBudget();
      await expect(sendWebhook(event, { ...(url ? { STATUSFRAME_WEBHOOK_URL: url } : {}) }, budget, fetcher)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
      expect(budget.usage.notifications).toBe(0);
    });

  it.each([302, 500])("rejects HTTP %s without retrying or following redirects", async status => {
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }),
      { status, headers: { location: "https://elsewhere.example.com/" } }));
    const budget = makeBudget();
    await expect(sendWebhook(event, bindings, budget, fetcher)).rejects.toThrow("Webhook delivery rejected");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(budget.usage.notifications).toBe(1);
  });

  it("does not send when the notification budget is exhausted", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(sendWebhook(event, bindings, makeBudget({ max_notifications: 0 }), fetcher)).rejects.toThrow("Budget exhausted");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("provides a five-second abort signal to the transport", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await sendWebhook(event, bindings, makeBudget(), fetcher);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5000);
    expect(fetcher.mock.calls[0]![1]!.signal).toBe(controller.signal);
  });
});
