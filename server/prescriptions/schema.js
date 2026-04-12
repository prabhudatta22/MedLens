import { pool } from "../db/pool.js";

let ready = null;

/** Idempotent DDL for user prescriptions + FK columns on carts and orders. */
export function ensureUserPrescriptionsSchema() {
  if (ready) return ready;
  ready = pool
    .query(
      `CREATE TABLE IF NOT EXISTS user_prescriptions (
         id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
         storage_key TEXT NOT NULL UNIQUE,
         original_filename TEXT,
         mime_type TEXT NOT NULL,
         byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
         source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','whatsapp')),
         ocr_preview TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );

       CREATE INDEX IF NOT EXISTS idx_user_prescriptions_user_created
         ON user_prescriptions (user_id, created_at DESC);

       ALTER TABLE carts ADD COLUMN IF NOT EXISTS prescription_id INTEGER REFERENCES user_prescriptions (id) ON DELETE SET NULL;
       ALTER TABLE orders ADD COLUMN IF NOT EXISTS prescription_id INTEGER REFERENCES user_prescriptions (id) ON DELETE RESTRICT;`
    )
    .then(() => {})
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
