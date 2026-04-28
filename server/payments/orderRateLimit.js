/**
 * Per-user sliding window for Razorpay order creation (single Node instance).
 * For horizontal scale, place a Redis-backed limiter in front of this app.
 */
export function razorpayOrderCreateRateLimit() {
  const windowMs = Math.max(60_000, Number(process.env.RAZORPAY_ORDER_RATE_WINDOW_MS || 900_000));
  const max = Math.max(1, Number(process.env.RAZORPAY_ORDER_RATE_MAX || 40));
  const buckets = new Map();

  return (req, res, next) => {
    const uid = req.user?.id;
    if (typeof uid !== "number") return next();
    const now = Date.now();
    const key = String(uid);
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { n: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.n += 1;
    if (b.n > max) {
      return res.status(429).json({ error: "Too many checkout attempts. Try again later." });
    }
    return next();
  };
}
