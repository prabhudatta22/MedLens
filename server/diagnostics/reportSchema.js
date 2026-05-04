import { pool } from "../db/pool.js";

let ready;

export async function ensureDiagnosticReportsSchema() {
  if (ready) return ready;
  ready = pool
    .query(
      `CREATE TABLE IF NOT EXISTS user_diagnostic_reports (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
         order_id INTEGER REFERENCES orders (id) ON DELETE SET NULL,
         diagnostic_type TEXT NOT NULL,
         storage_backend TEXT NOT NULL DEFAULT 'local' CHECK (storage_backend IN ('local','s3')),
         storage_key TEXT NOT NULL UNIQUE,
         s3_bucket TEXT,
         mime_type TEXT NOT NULL,
         byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
         original_filename TEXT,
         amount_inr NUMERIC(12, 2),
         booked_at TIMESTAMPTZ NOT NULL,
         payment_made_by TEXT NOT NULL,
         uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         lab_source TEXT NOT NULL DEFAULT 'lab_ingest'
       );

       ALTER TABLE user_diagnostic_reports ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
       ALTER TABLE user_diagnostic_reports ADD COLUMN IF NOT EXISTS ingest_event_key TEXT;

       CREATE UNIQUE INDEX IF NOT EXISTS idx_user_diag_reports_ingest_key
         ON user_diagnostic_reports (ingest_event_key)
         WHERE ingest_event_key IS NOT NULL;

       CREATE UNIQUE INDEX IF NOT EXISTS idx_user_diag_reports_order_sha
         ON user_diagnostic_reports (order_id, content_sha256)
         WHERE order_id IS NOT NULL AND content_sha256 IS NOT NULL;

       CREATE INDEX IF NOT EXISTS idx_user_diag_reports_user_booked
         ON user_diagnostic_reports (user_id, booked_at DESC);`
    )
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
