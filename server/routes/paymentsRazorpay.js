import { Router } from "express";
import { requireUser } from "../auth/middleware.js";
import {
  createRazorpayOrder,
  getRazorpayPublicKeyId,
  isRazorpayConfigured,
} from "../payments/razorpayClient.js";

const router = Router();

/** Public: only exposes key_id when configured (safe client-side). */
router.get("/status", (_req, res) => {
  res.json({
    configured: isRazorpayConfigured(),
    key_id: isRazorpayConfigured() ? getRazorpayPublicKeyId() : null,
  });
});

router.post("/order", requireUser, async (req, res) => {
  if (!isRazorpayConfigured()) {
    return res.status(503).json({ error: "Razorpay is not configured on the server" });
  }
  const role = req.user?.role;
  if (role === "service_provider") {
    return res.status(403).json({ error: "Service provider cannot create consumer payments" });
  }
  const amountInr = Number(req.body?.amount_inr);
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    return res.status(400).json({ error: "amount_inr must be a positive number" });
  }
  const amountPaise = Math.round(amountInr * 100);
  const uid = Number(req.user.id);
  const receipt = `ml_${Number.isFinite(uid) ? uid : 0}_${Date.now()}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 40);
  try {
    const order = await createRazorpayOrder({
      amountPaise,
      receipt,
      notes: { medlens_user: String(req.user.id), medlens_flow: "diagnostics" },
    });
    res.json({
      key_id: getRazorpayPublicKeyId(),
      order_id: order.id,
      amount: order.amount,
      currency: order.currency || "INR",
      receipt: order.receipt || receipt,
    });
  } catch (e) {
    res.status(502).json({ error: e?.message || "Failed to create Razorpay order" });
  }
});

export default router;
