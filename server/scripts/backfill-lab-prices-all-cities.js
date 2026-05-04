/**
 * Copies reference lab_test_prices rows so every city gets the same catalog prices
 * where missing. Safe to run multiple times.
 *
 * Requires DATABASE_URL (.env). Run: npm run db:backfill-lab-prices
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const sqlPath = join(__dirname, "..", "db", "sql", "backfill_lab_prices_all_cities.sql");
  const sql = await readFile(sqlPath, "utf8");
  const { rows: before } = await pool.query(`SELECT COUNT(*)::int AS n FROM lab_test_prices`);
  const nBefore = before[0]?.n ?? 0;
  const res = await pool.query(sql);
  const { rows: after } = await pool.query(`SELECT COUNT(*)::int AS n FROM lab_test_prices`);
  const nAfter = after[0]?.n ?? 0;
  console.log(
    `Lab price backfill: ${nBefore} rows before → ${nAfter} rows after (insert attempts: ${res.rowCount ?? "n/a"}).`
  );
  if (nBefore === 0 && nAfter === 0) {
    console.warn("lab_test_prices is empty; load lab tests + at least one city's prices first.");
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
