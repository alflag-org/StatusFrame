import { defineExtension, type NotificationContext, type StatusFrameExtension } from "@statusframe/core";

export function webhookNotifications(): StatusFrameExtension {
  return defineExtension({
    manifest: {
      name: "@statusframe/notifications-webhook",
      kind: "notification",
      providers: ["webhook"],
      capabilities: ["network:http", "notifications"],
      cost: {
        subrequestsPerRun: 1,
        notificationsPerRun: 1,
        expectedCpuMs: 1
      },
      defaultRedaction: {
        exposeTarget: false,
        exposeError: false,
        exposeLatency: false
      }
    },
    async notify(ctx) {
      if (!ctx.config.features.notifications.enabled) return;
      const notifications = ctx.config.notifications.filter(
        (notification) => notification.type === "webhook" && notification.events.includes(ctx.event.type)
      );
      await Promise.all(notifications.map((notification) => sendWebhook(ctx, notification.url)));
    }
  });
}

async function sendWebhook(ctx: NotificationContext, urlRef: string): Promise<void> {
  const url = resolveSecretReference(urlRef, ctx.env);
  if (!url) return;
  await ctx.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      type: ctx.event.type,
      created_at: ctx.event.createdAt,
      payload: ctx.event.payload
    })
  });
}

export function resolveSecretReference(ref: string, env: Record<string, string | undefined>): string | undefined {
  const match = ref.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
  if (!match) return undefined;
  const key = match[1];
  return key ? env[key] : undefined;
}
