/**
 * Labels and amounts for diagnostics orders → diagnostic report rows.
 */

export function diagnosticsPaymentLabel(order) {
  if (!order) return "Unknown";
  const notes = String(order.notes || "");
  const rz = order.razorpay_payment_id && String(order.razorpay_payment_id).trim().length > 0;
  const ps = String(order.payment_status || "").toLowerCase();
  if (rz || ps === "paid" || ps === "captured" || /\(PREPAID\)/i.test(notes)) {
    return "Prepaid (Razorpay)";
  }
  if (/\(COD\)/i.test(notes) || /\bCOD\b/i.test(notes)) {
    return "Cash on delivery (COD)";
  }
  return "Cash on delivery (COD)";
}

/**
 * @param {import("pg").Pool} pool
 * @param {number} orderId
 */
export async function loadDiagnosticsOrderSummary(pool, orderId) {
  const oRes = await pool.query(
    `SELECT id, user_id, order_kind, created_at, notes, razorpay_payment_id, payment_status
     FROM orders
     WHERE id = $1
     LIMIT 1`,
    [orderId]
  );
  if (!oRes.rows.length) return null;
  const order = oRes.rows[0];
  if (String(order.order_kind) !== "diagnostics") return null;
  const it = await pool.query(
    `SELECT COALESCE(SUM(unit_price_inr * quantity_units), 0)::numeric(14,2) AS total_inr
     FROM order_items
     WHERE order_id = $1`,
    [orderId]
  );
  const totalInr = it.rows[0]?.total_inr ?? 0;
  return {
    order,
    amount_inr: totalInr,
    payment_made_by: diagnosticsPaymentLabel(order),
    booked_at: order.created_at,
  };
}

/**
 * @param {import("pg").Pool} pool
 * @param {number} orderId
 */
export async function diagnosticLabelsFromOrderItems(pool, orderId) {
  const { rows } = await pool.query(
    `SELECT item_label FROM order_items WHERE order_id = $1 ORDER BY id ASC`,
    [orderId]
  );
  const parts = rows.map((r) => String(r.item_label || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" · ").slice(0, 600) : "Diagnostics";
}
