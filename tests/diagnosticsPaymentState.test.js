import assert from "node:assert/strict";
import test, { after } from "node:test";

import { pool } from "../server/db/pool.js";
import { resolveDiagnosticsPaymentState } from "../server/routes/orders.js";

after(async () => {
  await pool.end();
});

test("diagnostics COD stores cod payment state without Razorpay checks", async () => {
  let checked = false;
  const out = await resolveDiagnosticsPaymentState({
    paymentType: "cod",
    razorpayConfigured: () => {
      checked = true;
      return false;
    },
    assertPayment: async () => {
      throw new Error("should not verify COD payments");
    },
  });

  assert.deepEqual(out, { paymentMeta: null, dbPaymentStatus: "cod" });
  assert.equal(checked, false);
});

test("diagnostics prepaid rejects when Razorpay is not configured", async () => {
  await assert.rejects(
    resolveDiagnosticsPaymentState({
      body: { payment_meta: { method: "upi", upi_id: "fake@upi" } },
      paymentType: "prepaid",
      totalPaise: 49900,
      razorpayConfigured: () => false,
      assertPayment: async () => {
        throw new Error("should not verify without configuration");
      },
    }),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.match(err.message, /Razorpay/i);
      return true;
    },
  );
});

test("diagnostics prepaid requires Razorpay checkout fields", async () => {
  await assert.rejects(
    resolveDiagnosticsPaymentState({
      body: { razorpay_order_id: "order_1", razorpay_payment_id: "pay_1" },
      paymentType: "prepaid",
      totalPaise: 49900,
      razorpayConfigured: () => true,
      assertPayment: async () => {
        throw new Error("should not verify incomplete Razorpay payload");
      },
    }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /razorpay_signature/i);
      return true;
    },
  );
});

test("diagnostics prepaid stores verified Razorpay metadata", async () => {
  const calls = [];
  const out = await resolveDiagnosticsPaymentState({
    body: {
      razorpay_order_id: " order_1 ",
      razorpay_payment_id: " pay_1 ",
      razorpay_signature: " sig_1 ",
    },
    paymentType: "prepaid",
    totalPaise: 49900,
    razorpayConfigured: () => true,
    assertPayment: async (args) => {
      calls.push(args);
    },
  });

  assert.deepEqual(calls, [
    {
      razorpayOrderId: "order_1",
      razorpayPaymentId: "pay_1",
      razorpaySignature: "sig_1",
      expectedAmountPaise: 49900,
    },
  ]);
  assert.deepEqual(out, {
    paymentMeta: {
      provider: "razorpay",
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      verified: true,
    },
    dbPaymentStatus: "prepaid_verified",
  });
});
