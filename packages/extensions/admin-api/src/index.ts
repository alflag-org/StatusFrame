import { defineExtension, type AdminRequestContext, type StatusFrameExtension } from "@statusframe/core";

export function adminApiExtension(): StatusFrameExtension {
  return defineExtension({
    manifest: {
      name: "@statusframe/admin-api",
      kind: "admin",
      capabilities: ["admin-api"],
      cost: {
        expectedCpuMs: 1
      }
    },
    async handleAdminRequest(ctx) {
      if (!ctx.config.features.admin_api.enabled) return undefined;
      const url = new URL(ctx.request.url);
      if (!url.pathname.startsWith("/api/admin")) return undefined;

      if (!(await isAuthorized(ctx))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (ctx.request.method === "GET" && url.pathname === "/api/admin/config/validate") {
        return Response.json(ctx.validateConfiguration());
      }

      if (ctx.request.method === "POST" && url.pathname === "/api/admin/snapshot/regenerate") {
        const snapshot = await ctx.regenerateSnapshot();
        return Response.json(snapshot);
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    }
  });
}

async function isAuthorized(ctx: AdminRequestContext): Promise<boolean> {
  const token = ctx.env.STATUSFRAME_ADMIN_TOKEN;
  if (!token) return false;
  const header = ctx.request.headers.get("authorization") ?? "";
  const value = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!value) return false;
  return timingSafeEqual(value, token);
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  const digestLeft = await crypto.subtle.digest("SHA-256", left);
  const digestRight = await crypto.subtle.digest("SHA-256", right);
  const leftBytes = new Uint8Array(digestLeft);
  const rightBytes = new Uint8Array(digestRight);
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}
