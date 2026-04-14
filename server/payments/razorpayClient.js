import crypto from "node:crypto";

const API_BASE = "https://api.razorpay.com/v1";

function getKeyId() {
  return String(process.env.RAZORPAY_KEY_ID || "").trim();
}

function getKeySecret() {
  return String(process.env.RAZORPAY_KEY_SECRET || "").trim();
}

export function isRazorpayConfigured() {
  return Boolean(getKeyId() && getKeySecret());
}

export function getRazorpayPublicKeyId() {
  return getKeyId() || null;
}

function basicAuthHeader() {
  const id = getKeyId();
  const secret = getKeySecret();
  const token = Buffer.from(`${id}:${secret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function razorpayFetch(path, { method = "GET", body = null } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error?.description || data?.error?.code || data?.message || res.statusText;
    throw new Error(String(msg || `Razorpay HTTP ${res.status}`));
  }
  return data;
}

/**
 * @param {{ amountPaise: number, receipt: string, notes?: Record<string, string> }} opts
 */
export async function createRazorpayOrder({ amountPaise, receipt, notes = {} }) {
  const amount = Math.round(Number(amountPaise));
  if (!Number.isFinite(amount) || amount < 100) {
    throw new Error("amount must be at least 100 paise (₹1)");
  }
  if (amount > 50_000_000) {
    throw new Error("amount exceeds allowed maximum");
  }
  const rcpt = String(receipt || "").trim().slice(0, 40);
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(rcpt)) {
    throw new Error("receipt must be 1–40 alphanumeric characters, underscores, or hyphens");
  }
  return razorpayFetch("/orders", {
    method: "POST",
    body: {
      amount,
      currency: "INR",
      receipt: rcpt,
      notes: Object.fromEntries(
        Object.entries(notes).map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 256)])
      ),
    },
  });
}

export async function fetchRazorpayPayment(paymentId) {
  const id = String(paymentId || "").trim();
  if (!id) throw new Error("payment_id is required");
  return razorpayFetch(`/payments/${encodeURIComponent(id)}`);
}

export function verifyRazorpayPaymentSignature(orderId, paymentId, signature) {
  const secret = getKeySecret();
  if (!secret) return false;
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const sig = String(signature || "").trim();
  if (expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
  } catch {
    return false;
  }
}

/**
 * @param {Buffer|string} rawBody
 * @param {string|undefined} signatureHeader X-Razorpay-Signature
 */
export function verifyRazorpayWebhookSignature(rawBody, signatureHeader) {
  const whSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  if (!whSecret) return false;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = crypto.createHmac("sha256", whSecret).update(buf).digest("hex");
  const sig = String(signatureHeader || "").trim();
  if (!expected.length || expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Confirms payment belongs to order, signature is valid, and amount matches expected paise.
 */
export async function assertCapturedDiagnosticsPayment({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  expectedAmountPaise,
}) {
  if (!isRazorpayConfigured()) {
    throw new Error("Razorpay is not configured");
  }
  if (!verifyRazorpayPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw new Error("Invalid Razorpay payment signature");
  }
  const payment = await fetchRazorpayPayment(razorpayPaymentId);
  const status = String(payment.status || "").toLowerCase();
  if (status !== "captured" && status !== "authorized") {
    throw new Error(`Payment is not complete (status: ${payment.status || "unknown"})`);
  }
  if (String(payment.order_id || "") !== String(razorpayOrderId)) {
    throw new Error("Payment does not match Razorpay order");
  }
  const amt = Number(payment.amount);
  const expected = Math.round(Number(expectedAmountPaise));
  if (!Number.isFinite(amt) || amt !== expected) {
    throw new Error("Paid amount does not match order total");
  }
  if (String(payment.currency || "").toUpperCase() !== "INR") {
    throw new Error("Payment currency must be INR");
  }
  return payment;
}
