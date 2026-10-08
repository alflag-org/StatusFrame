import { Budget, parseConfig, type Config, type RuntimeIO } from "@statusframe/core";
import { vi } from "vitest";
export const makeConfig = (extra: Record<string, unknown> = {}): Config => parseConfig({
  site: { name: "Service Status", timezone: "Asia/Tokyo" },
  components: [{ id: "web", name: "Web" }],
  monitors: [{ id: "website-check", component: "web", type: "http", url: "https://example.com/", interval: "5m", failure_threshold: 3, recovery_threshold: 2 }], ...extra
});
export const makeBudget = (extra: Partial<Config["budget"]> = {}) => new Budget({ ...makeConfig().budget, ...extra });
export function makeIO(fetcher: typeof fetch = vi.fn(async () => new Response("ok")) as typeof fetch): RuntimeIO {
  return { fetch: fetcher, connect: vi.fn(() => { throw new Error("Unexpected connection"); }) };
}
