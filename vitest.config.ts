import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { environment: "node", testTimeout: 20_000, hookTimeout: 30_000 },
  resolve: { alias: Object.fromEntries(["core", "monitors", "notifications"].map(name => [
    `@statusframe/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))
  ])) }
});
