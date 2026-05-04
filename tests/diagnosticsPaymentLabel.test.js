import assert from "node:assert/strict";
import test from "node:test";

import { diagnosticsPaymentLabel } from "../server/diagnostics/orderMeta.js";

test("COD from notes parentheses", () => {
  assert.equal(
    diagnosticsPaymentLabel({ notes: "Diagnostics booking in Mumbai (COD)" }),
    "Cash on delivery (COD)"
  );
});

test("PREPAID from notes", () => {
  assert.equal(
    diagnosticsPaymentLabel({ notes: "Diagnostics package (PREPAID)" }),
    "Prepaid (Razorpay)"
  );
});

test("Razorpay payment id implies prepaid regardless of COD in notes typo", () => {
  assert.equal(
    diagnosticsPaymentLabel({ notes: "Something (COD)", razorpay_payment_id: "pay_123", payment_status: null }),
    "Prepaid (Razorpay)"
  );
});

test("Captured payment_status", () => {
  assert.equal(
    diagnosticsPaymentLabel({ notes: "(COD)", payment_status: "captured" }),
    "Prepaid (Razorpay)"
  );
});
