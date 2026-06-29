import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { pool as defaultPool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(p: pg.Pool = defaultPool): Promise<void> {
  const dir = join(here, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    await p.query(sql);
  }
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      return defaultPool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
