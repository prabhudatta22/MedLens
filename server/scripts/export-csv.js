/**
 * Export each table to a CSV file under server/db/csv/.
 *
 * Usage:
 *   node server/scripts/export-csv.js
 *
 * Requires:
 *   DATABASE_URL in environment (.env is loaded by dotenv/config)
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "db", "csv");

function csvCell(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) v = v.toISOString();
  const s = String(v);
  // Escape if needed
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv({ columns, rows }) {
  const lines = [];
  lines.push(columns.map(csvCell).join(","));
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(r[c])).join(","));
  }
  return lines.join("\n") + "\n";
}

async function exportTable(client, table, orderBy) {
  const colsRes = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  const columns = colsRes.rows.map((r) => r.column_name);
  if (!columns.length) throw new Error(`No columns found for table: ${table}`);

  const orderSql = orderBy ? ` ORDER BY ${orderBy}` : "";
  const { rows } = await client.query(`SELECT * FROM ${table}${orderSql}`);
  return { columns, rows };
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Keep an explicit list so exports are deterministic and complete.
  const tables = [
    { name: "cities", orderBy: "id" },
    { name: "pharmacies", orderBy: "id" },
    { name: "medicines", orderBy: "id" },
    { name: "pharmacy_prices", orderBy: "id" },
    { name: "carts", orderBy: "id" },
    { name: "cart_items", orderBy: "id" },
    { name: "partner_pharmacies", orderBy: "id" },
    { name: "sales", orderBy: "id" },
    { name: "sale_items", orderBy: "id" },
    { name: "users", orderBy: "id" },
    { name: "otp_codes", orderBy: "id" },
    { name: "sessions", orderBy: "id" },
    { name: "service_provider_users", orderBy: "id" },
    { name: "service_providers", orderBy: "name, id" },
    { name: "skus", orderBy: "name, id" },
    { name: "catalog_users", orderBy: "username, id" },
    { name: "provider_skus", orderBy: "service_provider_id, sku_id" },
    { name: "purchase_reminders", orderBy: "id" },
    { name: "lab_tests", orderBy: "id" },
    { name: "lab_test_prices", orderBy: "id" },
  ];

  const client = await pool.connect();
  try {
    for (const t of tables) {
      const data = await exportTable(client, t.name, t.orderBy);
      const csv = toCsv(data);
      const outPath = join(outDir, `${t.name}.csv`);
      await writeFile(outPath, csv, "utf8");
      // eslint-disable-next-line no-console
      console.log(`Wrote ${t.name}.csv (${data.rows.length} rows)`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

