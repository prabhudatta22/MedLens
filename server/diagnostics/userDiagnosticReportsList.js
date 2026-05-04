import { ensureDiagnosticReportsSchema } from "./reportSchema.js";

/**
 * Reports owned by this user, plus rows tied to their diagnostics orders
 * (covers mis-set `user_id` when `order_id` is correct).
 * Google vs phone OTP remain different `users.id` until account linking is added.
 */
const SELECT_LIST_SQL = `
  SELECT * FROM (
    SELECT r.id,
           r.order_id,
           r.diagnostic_type,
           r.amount_inr,
           r.booked_at,
           r.payment_made_by,
           r.uploaded_at,
           r.original_filename,
           r.storage_backend
    FROM user_diagnostic_reports r
    WHERE r.user_id = $1::integer

    UNION

    SELECT r.id,
           r.order_id,
           r.diagnostic_type,
           r.amount_inr,
           r.booked_at,
           r.payment_made_by,
           r.uploaded_at,
           r.original_filename,
           r.storage_backend
    FROM user_diagnostic_reports r
    INNER JOIN orders o ON o.id = r.order_id
    WHERE o.user_id = $1::integer
      AND o.order_kind = 'diagnostics'
  ) sub
  ORDER BY sub.booked_at DESC NULLS LAST, sub.id DESC
  LIMIT 120`;

/**
 * @param {import("pg").Pool} pool
 * @param {unknown} rawUserId
 */
export async function listDiagnosticReportsForUser(pool, rawUserId) {
  await ensureDiagnosticReportsSchema();
  const uid = Number(rawUserId);
  if (!Number.isFinite(uid) || uid < 1) return [];
  const { rows } = await pool.query(SELECT_LIST_SQL, [uid]);
  return rows;
}
