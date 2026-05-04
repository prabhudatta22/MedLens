/**
 * Load server/db/sql/postgres_data.sql using DATABASE_URL from .env.
 * Run after db:migrate on an empty database (do not run db:seed first).
 *
 * After load, runs lab price backfill so every city gets lab_test_prices rows
 * (the dump often only includes Mumbai / Bengaluru / Delhi).
 */
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, "..", "db", "sql", "postgres_data.sql");
const backfillScript = join(__dirname, "backfill-lab-prices-all-cities.js");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const child = spawn("psql", [url, "-v", "ON_ERROR_STOP=1"], {
  stdio: ["pipe", "inherit", "inherit"],
});
child.stdin.write(sql);
child.stdin.end();
child.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const r = spawnSync(process.execPath, [backfillScript], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(typeof r.status === "number" ? r.status : 1);
});
