import { pool } from "../db/pool.js";

let ready = null;

export async function ensureAbhaSchema() {
  if (ready) return ready;
  ready = (async () => {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS abha_link (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        health_id_number TEXT NOT NULL,
        health_id_masked TEXT,
        identifier_kind TEXT NOT NULL DEFAULT 'number',
        aadhaar_verified_at TIMESTAMPTZ NOT NULL,
        last_sync_at TIMESTAMPTZ,
        source_mode TEXT NOT NULL DEFAULT 'stub',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS abha_aadhaar_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        txn_id TEXT NOT NULL UNIQUE,
        health_id_number TEXT NOT NULL,
        identifier_kind TEXT NOT NULL DEFAULT 'number',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_abha_sessions_user ON abha_aadhaar_sessions(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_abha_sessions_expires ON abha_aadhaar_sessions(expires_at)`);
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
