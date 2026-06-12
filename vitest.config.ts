import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pathFromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true
  },
  resolve: {
    alias: {
      "@statusframe/core": pathFromRoot("./packages/core/src/index.ts"),
      "@statusframe/schema": pathFromRoot("./packages/schema/src/index.ts"),
      "@statusframe/storage-static": pathFromRoot("./packages/storage/static/src/index.ts"),
      "@statusframe/storage-memory": pathFromRoot("./packages/storage/memory/src/index.ts"),
      "@statusframe/storage-d1": pathFromRoot("./packages/storage/d1/src/index.ts"),
      "@statusframe/monitor-http": pathFromRoot("./packages/extensions/monitor-http/src/index.ts"),
      "@statusframe/monitor-tcp": pathFromRoot("./packages/extensions/monitor-tcp/src/index.ts"),
      "@statusframe/monitor-dns": pathFromRoot("./packages/extensions/monitor-dns/src/index.ts"),
      "@statusframe/monitor-tls": pathFromRoot("./packages/extensions/monitor-tls/src/index.ts"),
      "@statusframe/incidents": pathFromRoot("./packages/extensions/incidents/src/index.ts"),
      "@statusframe/maintenance": pathFromRoot("./packages/extensions/maintenance/src/index.ts"),
      "@statusframe/metrics": pathFromRoot("./packages/extensions/metrics/src/index.ts"),
      "@statusframe/notifications-webhook": pathFromRoot("./packages/extensions/notifications-webhook/src/index.ts"),
      "@statusframe/admin-api": pathFromRoot("./packages/extensions/admin-api/src/index.ts")
    }
  }
});
