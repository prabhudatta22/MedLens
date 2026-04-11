import { removeLine } from "./cartStore.js";
import { fetchAndCacheUser, loadCachedUser } from "./authProfile.js";

const $ = (id) => document.getElementById(id);
const DIAG_PREPAID_KEY = "medlens_diag_prepaid_payload_v1";
const ORDER_SUCCESS_KEY = "medlens_order_success_message_v1";

function fmtINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadPending() {
  try {
    const raw = localStorage.getItem(DIAG_PREPAID_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.packages) || !data.packages.length) return null;
    return data;
  } catch {
    return null;
  }
}

function paymentMeta() {
  const method = $("dxPayMethod")?.value || "upi";
  if (method === "upi") {
    const upi = String($("dxUpiId")?.value || "").trim();
    if (!/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(upi)) return { ok: false, error: "Enter a valid UPI ID." };
    return { ok: true, value: { method: "upi", upi_id: upi } };
  }
  const num = String($("dxCardNumber")?.value || "").replace(/\D/g, "");
  const exp = String($("dxCardExp")?.value || "").trim();
  const cvv = String($("dxCardCvv")?.value || "").replace(/\D/g, "");
  const holder = String($("dxCardHolder")?.value || "").trim();
  if (num.length < 12 || num.length > 19) return { ok: false, error: "Enter a valid card number." };
  if (!/^\d{2}\/\d{2}$/.test(exp)) return { ok: false, error: "Enter expiry in MM/YY format." };
  if (!(cvv.length === 3 || cvv.length === 4)) return { ok: false, error: "Enter a valid CVV." };
  if (!holder) return { ok: false, error: "Enter card holder name." };
  return {
    ok: true,
    value: {
      method: "card",
      card_last4: num.slice(-4),
      card_network: "CARD",
      card_holder_name: holder,
    },
  };
}

async function placePrepaidOrder(pending) {
  const status = $("dxPayStatus");
  const btn = $("dxPayBtn");
  const meta = paymentMeta();
  if (!meta.ok) {
    status.textContent = meta.error;
    return;
  }
  btn.disabled = true;
  status.textContent = "Processing payment and creating order…";
  const payload = {
    ...pending,
    payment_type: "prepaid",
    payment_meta: meta.value,
  };
  try {
    const res = await fetch("/api/orders/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.textContent = data?.error || `Payment/booking failed (${res.status})`;
      btn.disabled = false;
      return;
    }
    localStorage.removeItem(DIAG_PREPAID_KEY);
    const lineIds = Array.isArray(pending?.cart_line_ids) ? pending.cart_line_ids : [];
    lineIds.forEach((id) => removeLine(id));
    const id = data?.order?.id;
    try {
      sessionStorage.setItem(ORDER_SUCCESS_KEY, "Successfully order placed");
    } catch {
      /* ignore */
    }
    status.textContent = "Successfully order placed. Redirecting to order details…";
    setTimeout(() => {
      window.location.assign(`/order.html?id=${encodeURIComponent(id)}`);
    }, 900);
  } catch (e) {
    status.textContent = String(e?.message || e);
    btn.disabled = false;
  }
}

function renderAuthNav(user) {
  const logged = Boolean(user && user.role !== "service_provider");
  $("navLogin")?.classList.toggle("hidden", logged);
  $("navProfile")?.classList.toggle("hidden", !logged);
  $("navOrders")?.classList.toggle("hidden", !logged);
}

async function refreshAuthNav() {
  renderAuthNav(loadCachedUser());
  const fresh = await fetchAndCacheUser();
  renderAuthNav(fresh);
}

function init() {
  const returnTo = `${window.location.pathname}${window.location.search || ""}`;
  $("navLogin")?.setAttribute("href", `/login.html?returnTo=${encodeURIComponent(returnTo)}`);

  const pending = loadPending();
  const status = $("dxPayStatus");
  const summary = $("dxPaySummary");
  if (!pending) {
    status.innerHTML = `No pending prepaid diagnostics booking found. <a href="/labs.html">Go back</a>.`;
    $("dxPayBtn")?.setAttribute("disabled", "true");
    return;
  }

  const total = pending.packages.reduce((s, p) => s + (Number(p.price_inr) || 0), 0);
  summary.innerHTML = pending.packages
    .map(
      (p) => `
      <div class="rx-match">
        <div>
          <div class="rx-match-title">${esc(p.package_name || "Package")}</div>
          <div class="rx-match-sub muted">${esc(p.deal_id || p.package_id || "")}</div>
        </div>
        <strong>${esc(fmtINR(p.price_inr))}</strong>
      </div>`
    )
    .join("");
  status.textContent = `Total payable: ${fmtINR(total)} · Scheduled: ${new Date(pending.scheduled_for).toLocaleString("en-IN")}`;

  $("dxPayMethod")?.addEventListener("change", () => {
    const m = $("dxPayMethod")?.value || "upi";
    $("dxUpiForm")?.classList.toggle("hidden", m !== "upi");
    $("dxCardForm")?.classList.toggle("hidden", m !== "card");
  });
  $("dxPayBtn")?.addEventListener("click", () => placePrepaidOrder(pending));
}

refreshAuthNav().catch(() => {});
init();
