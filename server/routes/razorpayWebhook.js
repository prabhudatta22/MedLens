import { Router } from "express";
import { verifyRazorpayWebhookSignature } from "../payments/razorpayClient.js";

const router = Router();

/**
 * Razorpay webhooks require the raw JSON body for HMAC verification.
 * Mount with express.raw({ type: "application/json" }) before express.json().
 */
router.post("/", (req, res) => {
  const whSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  if (!whSecret) {
    return res.status(503).json({ error: "RAZORPAY_WEBHOOK_SECRET is not configured" });
  }
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || !raw.length) {
    return res.status(400).json({ error: "Expected raw body" });
  }
  const sig = req.get("x-razorpay-signature");
  if (!verifyRazorpayWebhookSignature(raw, sig)) {
    return res.status(400).json({ error: "Invalid webhook signature" });
  }
  try {
    JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  res.json({ received: true });
});

export default router;
