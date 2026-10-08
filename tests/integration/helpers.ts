import { Miniflare } from "miniflare";
import { readFile, readdir } from "node:fs/promises";

export async function database(persistence?: string, initialize = true) {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('test'); } }", compatibilityDate: "2026-06-11", d1Databases: { DB: "test" }, ...(persistence ? { d1Persist: persistence } : {}) });
  const db = await mf.getD1Database("DB") as unknown as D1Database;
  const migration = (await Promise.all((await readdir("apps/worker/migrations")).filter(name => name.endsWith(".sql")).sort()
    .map(name => readFile(`apps/worker/migrations/${name}`, "utf8")))).join("\n");
  try { if (initialize) await db.batch(migration.split(";").map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql))); }
  catch (error) { await mf.dispose(); throw error; }
  return { db, dispose: () => mf.dispose() };
}
