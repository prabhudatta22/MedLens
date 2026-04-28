/** In-memory counters for payments / webhooks (single process). For multi-instance, use Prometheus or aggregate logs. */

const metrics = {
  webhook_received: 0,
  webhook_duplicate: 0,
  webhook_insert_err: 0,
  webhook_payment_captured: 0,
  webhook_payment_failed: 0,
  webhook_refund_processed: 0,
  webhook_orders_matched: 0,
  webhook_order_missing: 0,
  webhook_unhandled_event: 0,
  refund_api_ok: 0,
  refund_api_err: 0,
};

export function incMetric(key) {
  if (Object.prototype.hasOwnProperty.call(metrics, key)) {
    metrics[key] += 1;
  }
}

export function getMetrics() {
  return { ...metrics, at: new Date().toISOString() };
}

export function logPayment(tag, data = {}) {
  if (String(process.env.PAYMENTS_LOG_JSON || "").trim() === "1") {
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), component: "payments", tag, ...data })
    );
  }
}
