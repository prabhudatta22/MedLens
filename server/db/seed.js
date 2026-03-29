import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function seed() {
  const sql = await readFile(join(__dirname, "sql", "seed.sql"), "utf8");
  await pool.query(sql);
  console.log("Seed applied: seed.sql");
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
