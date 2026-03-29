import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = await readFile(join(__dirname, "sql", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Migration applied: schema.sql");
  await pool.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
