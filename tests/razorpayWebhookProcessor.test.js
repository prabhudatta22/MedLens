import assert from "node:assert/strict";
import test from "node:test";

import { pool } from "../server/db/pool.js";
import { processVerifiedRazorpayWebhook } from "../server/payments/razorpayWebhookProcessor.js";

test("payment.failed webhook does not match orders by Razorpay order id alone", async () => {
  const originalQuery = pool.query.bind(pool);
  const queries = [];

  pool.query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes("INSERT INTO razorpay_webhook_events")) {
      return { rows: [{ id: 1 }] };
    }
    if (sql.includes("UPDATE orders")) {
      assert.match(sql, /razorpay_payment_id\s+IS\s+NULL/i);
      assert.match(sql, /btrim\(razorpay_payment_id\)\s+=\s+''/i);
      assert.match(sql, /razorpay_payment_id\s+=\s+\$1/i);
      assert.deepEqual(params, ["pay_failed_attempt", "order_shared"]);
      return { rows: [] };
    }
    if (sql.includes("UPDATE razorpay_webhook_events")) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  try {
    const out = await processVerifiedRazorpayWebhook({
      id: "evt_failed_attempt",
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_failed_attempt",
            order_id: "order_shared",
          },
        },
      },
    });

    assert.equal(out.ok, true);
    assert.equal(out.matched_order_id, null);
    assert.equal(queries.filter((q) => q.sql.includes("UPDATE orders")).length, 1);
  } finally {
    pool.query = originalQuery;
    await pool.end();
  }
});
