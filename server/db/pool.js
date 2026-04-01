import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "MedLens: DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL."
  );
}

function shouldUseSsl(databaseUrl) {
  if (!databaseUrl) return false;
  const s = String(databaseUrl);
  // Local dev typically runs without TLS.
  if (s.includes("localhost") || s.includes("127.0.0.1")) return false;
  // Supabase/hosted Postgres generally requires TLS.
  return true;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});
