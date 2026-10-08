import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("deployment command", () => {
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
