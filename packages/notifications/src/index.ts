import { assertPublicUrl, type Budget, type NotificationEvent } from "@statusframe/core";
export interface WebhookBindings { STATUSFRAME_WEBHOOK_URL?: string; STATUSFRAME_WEBHOOK_SECRET?: string }
export async function sendWebhook(event: NotificationEvent, bindings: WebhookBindings, budget: Budget, fetcher = fetch): Promise<void> {
  if (!bindings.STATUSFRAME_WEBHOOK_URL) throw new Error("Missing webhook URL binding");
  const url = assertPublicUrl(bindings.STATUSFRAME_WEBHOOK_URL);
  if (url.protocol !== "https:") throw new Error("Webhook must use HTTPS");
  const body = JSON.stringify(event);
  const headers: Record<string, string> = { "content-type": "application/json", "x-statusframe-event-id": event.id };
  if (bindings.STATUSFRAME_WEBHOOK_SECRET) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(bindings.STATUSFRAME_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    headers["x-statusframe-signature"] = [...new Uint8Array(signature)].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  budget.take({ notifications: 1, subrequests: 1 });
  const response = await fetcher(url.href, { method: "POST", body, headers, redirect: "manual", signal: AbortSignal.timeout(5000) });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Webhook delivery rejected");
}
