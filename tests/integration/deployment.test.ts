import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("deployment command", () => {
  it("resolves a remote database by name without a configured ID using the installed Wrangler", async () => {
    const directory = await mkdtemp(join(tmpdir(), "statusframe-d1-lookup-"));
    const accountId = "00000000000000000000000000000000";
    const databaseId = "11111111-1111-4111-8111-111111111111";
    const requests: Array<{ method: string | undefined; path: string }> = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url!, "http://localhost");
      requests.push({ method: request.method, path: url.pathname });
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && url.pathname === `/client/v4/accounts/${accountId}/d1/database/statusframe`) {
        response.end(JSON.stringify({
          success: true, errors: [], messages: [], result: { uuid: databaseId, name: "statusframe" }
        }));
      } else {
        // Stop at the first SQL request. Real SQL migrations are covered by local D1 tests.
        response.statusCode = 403;
        response.end(JSON.stringify({
          success: false, errors: [{ code: 10000, message: "Test stopped after database resolution" }]
        }));
      }
    });
    try {
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server port");
      const configPath = join(directory, "wrangler.jsonc");
      const source = JSON.stringify({
        name: "statusframe",
        d1_databases: [{
          binding: "STATUSFRAME_DB", database_name: "statusframe",
          migrations_dir: resolve("apps/worker/migrations")
        }]
      });
      await writeFile(configPath, source);
      const require = createRequire(import.meta.url);
      const wrangler = join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
      const child = spawn(process.execPath, [wrangler, "d1", "migrations", "apply", "STATUSFRAME_DB", "--remote", "--config", configPath], {
        cwd: directory,
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_API_TOKEN: "local-test-token",
          CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${address.port}/client/v4`,
          CLOUDFLARE_ENV: "",
          WRANGLER_SEND_METRICS: "false"
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000
      });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk.toString(); });
      child.stderr.on("data", chunk => { output += chunk.toString(); });
      const exit = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(exit, output).toBe(1);
      expect(output).toContain("Test stopped after database resolution");
      // Wrangler may also inspect the test token when reporting the intentional authorization error.
      expect(requests.filter(request => request.path.includes("/d1/"))).toEqual([
        { method: "GET", path: `/client/v4/accounts/${accountId}/d1/database/statusframe` },
        { method: "POST", path: `/client/v4/accounts/${accountId}/d1/database/${databaseId}/query` }
      ]);
      expect(await readFile(configPath, "utf8")).toBe(source);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([0, 7])("publishes only after successful migrations (exit %s)", async migrationExit => {
    const directory = await mkdtemp(join(tmpdir(), "statusframe-deploy-test-"));
    const worker = JSON.parse(await readFile("apps/worker/package.json", "utf8")) as { scripts: Record<string, string> };
    try {
      await writeFile(join(directory, "pnpm"), `#!/bin/sh
test "$*" = "db:remote" || exit 99
printf 'migrate\\n'
exit "$MIGRATION_EXIT"
`, { mode: 0o700 });
      await writeFile(join(directory, "wrangler"), `#!/bin/sh
test "$*" = "deploy --config ../../wrangler.jsonc" || exit 99
test -f ../../wrangler.jsonc || exit 99
printf 'publish\\n'
`, { mode: 0o700 });
      const result = spawnSync("/bin/sh", ["-c", worker.scripts.deploy!], {
        cwd: resolve("apps/worker"), env: { PATH: directory, MIGRATION_EXIT: String(migrationExit) }, encoding: "utf8"
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(migrationExit);
      expect(result.stdout.trim().split("\n")).toEqual(migrationExit === 0 ? ["migrate", "publish"] : ["migrate"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
