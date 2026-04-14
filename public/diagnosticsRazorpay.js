/** Shared Razorpay Checkout helpers for diagnostics prepaid flows. */

export function totalPaiseFromPackages(packages) {
  const packs = packages || [];
  return packs.reduce((s, p) => s + Math.round((Number(p.price_inr) || 0) * 100), 0);
}

export function totalInrFromPackages(packages) {
  return totalPaiseFromPackages(packages) / 100;
}

export function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay Checkout"));
    document.body.appendChild(s);
  });
}

export async function fetchRazorpayStatus() {
  const res = await fetch("/api/payments/razorpay/status", { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, configured: Boolean(data.configured), key_id: data.key_id || null };
}

export async function createRazorpayServerOrder(amountInr) {
  const res = await fetch("/api/payments/razorpay/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ amount_inr: amountInr }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Could not start payment (${res.status})`);
  }
  return data;
}
