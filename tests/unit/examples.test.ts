import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { assertPublic, parseYaml, project } from "@statusframe/core";
describe("shipped YAML examples", () => {
  it("parses and projects every example and the deployed Worker configuration", async () => {
    const files = (await readdir("examples")).filter(name => name.endsWith(".yml")).map(name => `examples/${name}`);
    files.push("apps/worker/statusframe.yml");
    for (const file of files) {
      const config = parseYaml(await readFile(file, "utf8"));
      const snapshot = project(config, [], config.incidents, config.maintenance, Date.parse("2026-01-01T00:00:00Z"));
      assertPublic(snapshot, config); expect(snapshot.components.length).toBeGreaterThan(0);
    }
  });
});
