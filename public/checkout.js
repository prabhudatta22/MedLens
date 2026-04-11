import {
  getCartItems,
  setLineQuantity,
  removeLine,
  clearCart,
  bucketKey,
  bucketTitle,
} from "./cartStore.js";
import { fetchAndCacheUser, loadCachedUser } from "./authProfile.js";

const $ = (id) => document.getElementById(id);
const DIAG_PREPAID_KEY = "medlens_diag_prepaid_payload_v1";
const ORDER_SUCCESS_KEY = "medlens_order_success_message_v1";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function localDateInputValue(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

function toStartOfLocalDayIso(dateInput) {
  const v = String(dateInput || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T09:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function onlyDiagnosticsItems(items) {
  return (items || []).filter((x) => x && x.source === "diagnostics");
}

function removeLinesById(lineIds) {
  const ids = new Set((lineIds || []).map((x) => String(x)));
  if (!ids.size) return;
  const lines = getCartItems();
  lines.forEach((L) => {
    if (ids.has(String(L.lineId))) removeLine(L.lineId);
  });
}

async function placeDiagnosticsOrder() {
  const statusEl = $("diagnosticsStatus");
  const btn = $("placeDiagnosticsBtn");
  if (!statusEl || !btn) return;

  const user = await fetchMe();
  if (!user || user.role === "service_provider") {
    statusEl.textContent = "Please login with your phone OTP to place diagnostics booking.";
    return;
  }

  const lines = onlyDiagnosticsItems(getCartItems());
  if (!lines.length) {
    statusEl.textContent = "No diagnostics tests in cart.";
    return;
  }

  const citySet = new Set(lines.map((L) => String(L.city || "").trim().toLowerCase()).filter(Boolean));
  if (citySet.size !== 1) {
    statusEl.textContent = "Diagnostics booking supports one city per order. Remove mixed-city tests and retry.";
    return;
  }

  const scheduledForIso = toStartOfLocalDayIso($("diagDate")?.value);
  if (!scheduledForIso) {
    statusEl.textContent = "Please choose a valid future booking date.";
    return;
  }

  const paymentType = $("diagPaymentType")?.value === "prepaid" ? "prepaid" : "cod";
  const packages = [];
  lines.forEach((L) => {
    const qty = Math.max(1, Number(L.quantity) || 1);
    for (let i = 0; i < qty; i += 1) {
      packages.push({
        package_id: String(L.packageId || ""),
        deal_id: String(L.dealId || L.packageId || ""),
        package_name: String(L.medicineLabel || "Diagnostics package"),
        city: String(L.city || ""),
        price_inr: Number(L.unitPriceInr) || 0,
        mrp_inr: L.mrpInr == null ? null : Number(L.mrpInr),
      });
    }
  });
  const payload = {
    package_id: packages[0].package_id,
    deal_id: packages[0].deal_id,
    package_name: packages[0].package_name,
    city: packages[0].city,
    price_inr: packages[0].price_inr,
    mrp_inr: packages[0].mrp_inr,
    packages,
    payment_type: paymentType,
    scheduled_for: scheduledForIso,
    cart_line_ids: lines.map((L) => L.lineId),
  };

  if (!payload.package_id || !payload.city || !Number.isFinite(payload.price_inr) || payload.price_inr <= 0) {
    statusEl.textContent = "Diagnostics cart item is incomplete. Re-add the test and retry.";
    return;
  }

  if (paymentType === "prepaid") {
    localStorage.setItem(DIAG_PREPAID_KEY, JSON.stringify(payload));
    statusEl.textContent = "Redirecting to payment page…";
    window.location.assign("/diagnostics-payment.html");
    return;
  }

  btn.disabled = true;
  statusEl.textContent = "Booking diagnostics order…";
  try {
    const res = await fetch("/api/orders/diagnostics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = data.error || `Diagnostics booking failed (${res.status})`;
      btn.disabled = false;
      return;
    }
    removeLinesById(payload.cart_line_ids);
    const id = data?.order?.id;
    try {
      sessionStorage.setItem(ORDER_SUCCESS_KEY, "Successfully order placed");
    } catch {
      /* ignore */
    }
    statusEl.textContent = "Successfully order placed. Redirecting to order details…";
    setTimeout(() => {
      window.location.assign(`/order.html?id=${encodeURIComponent(id)}`);
    }, 700);
  } catch (e) {
    statusEl.textContent = String(e?.message || e);
    btn.disabled = false;
  } finally {
    btn.disabled = false;
  }
}

function groupItems(items) {
  const map = new Map();
  for (const line of items) {
    const k = bucketKey(line);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(line);
  }
  return map;
}

function uniqueOpenUrls(lines) {
  const seen = new Set();
  const out = [];
  for (const L of lines) {
    const u = L.checkoutUrl;
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function fetchMe() {
  const cached = loadCachedUser();
  if (cached) return cached;
  return fetchAndCacheUser();
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

function onlyLocalItems(items) {
  return (items || []).filter((x) => x && x.source === "local");
}

function renderDoseTable(lines) {
  const host = $("doseRows");
  if (!host) return;
  if (!lines.length) {
    host.innerHTML = `<p class="muted">Add at least one <strong>local pharmacy</strong> item to place a delivery order.</p>`;
    return;
  }
  host.innerHTML = `
    <table class="price-table">
      <thead>
        <tr>
          <th>Medicine</th>
          <th>Qty</th>
          <th>Tablets / day</th>
        </tr>
      </thead>
      <tbody>
        ${lines
          .map(
            (L) => `
          <tr>
            <td>${escapeHtml(L.medicineLabel)}${L.strength ? ` <span class="muted">${escapeHtml(L.strength)}</span>` : ""}</td>
            <td class="muted">${Number(L.quantity) || 1}</td>
            <td><input class="qty-input dose-input" type="number" min="0.25" step="0.25" data-line-id="${escapeHtml(
              L.lineId
            )}" placeholder="e.g. 2" /></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function collectDoseByLineId() {
  const map = new Map();
  document.querySelectorAll(".dose-input[data-line-id]").forEach((inp) => {
    const id = inp.getAttribute("data-line-id");
    const v = inp.value;
    if (!id) return;
    const n = v == null || v === "" ? null : Number(v);
    if (n != null && (!Number.isFinite(n) || n <= 0)) return;
    map.set(id, n);
  });
  return map;
}

async function placeDeliveryOrder() {
  const statusEl = $("deliveryStatus");
  const btn = $("placeOrderBtn");
  if (!statusEl || !btn) return;

  const user = await fetchMe();
  if (!user || user.role === "service_provider") {
    statusEl.textContent = "Please login with your phone OTP to place an order.";
    return;
  }

  const items = onlyLocalItems(getCartItems());
  if (!items.length) {
    statusEl.textContent = "Your cart has no local pharmacy items (delivery MVP supports local items only).";
    return;
  }

  const addr1 = $("addr1")?.value?.trim() || "";
  if (!addr1) {
    statusEl.textContent = "Address line is required.";
    return;
  }

  btn.disabled = true;
  statusEl.textContent = "Placing order…";

  const doseMap = collectDoseByLineId();
  const delivery_option = $("deliveryOption")?.value || "normal";

  const payload = {
    delivery_option,
    address: {
      address_line1: addr1,
      landmark: $("landmark")?.value?.trim() || "",
      city: $("addrCity")?.value?.trim() || "",
      pincode: $("addrPin")?.value?.trim() || "",
    },
    items: items.map((L) => ({
      source: "local",
      pharmacyId: L.pharmacyId,
      medicineId: L.medicineId,
      medicineLabel: L.medicineLabel,
      strength: L.strength || "",
      form: L.form || "",
      pack_size: L.pack_size ?? null,
      quantity: Number(L.quantity) || 1,
      unitPriceInr: Number(L.unitPriceInr) || 0,
      mrpInr: L.mrpInr ?? null,
      tablets_per_day: doseMap.get(L.lineId) ?? null,
    })),
  };

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = data.error || `Order failed (${res.status})`;
      btn.disabled = false;
      return;
    }
    const id = data.order?.id;
    statusEl.innerHTML = `Order placed: <strong>#${escapeHtml(id)}</strong>. <a href="/order.html?id=${encodeURIComponent(
      id
    )}">Track order</a>.`;
  } catch (e) {
    statusEl.textContent = String(e?.message || e);
  } finally {
    btn.disabled = false;
  }
}

function render() {
  const items = getCartItems();
  const empty = $("empty-state");
  const main = $("cart-main");
  if (!items.length) {
    empty.classList.remove("hidden");
    main.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  main.classList.remove("hidden");

  const groups = groupItems(items);
  let grand = 0;

  $("buckets").innerHTML = Array.from(groups.entries())
    .map(([key, lines]) => {
      const sub = lines.reduce(
        (s, L) => s + (Number(L.unitPriceInr) || 0) * (Number(L.quantity) || 1),
        0
      );
      grand += sub;
      const title = bucketTitle(lines[0]);
      const src = lines[0].source;
      const urls = uniqueOpenUrls(lines);

      const rows = lines
        .map(
          (L) => `
        <tr>
          <td>${escapeHtml(L.medicineLabel)}${L.strength ? ` <span class="muted">${escapeHtml(L.strength)}</span>` : ""}</td>
          <td>
            ${
              L.source === "diagnostics"
                ? `<span class="muted">${Number(L.quantity) || 1}</span>`
                : `<input type="number" min="1" max="99" class="qty-input" data-id="${escapeHtml(L.lineId)}" value="${Number(
                    L.quantity
                  )}" />`
            }
          </td>
          <td class="price-cell">₹${fmt(L.unitPriceInr)}</td>
          <td class="price-cell">₹${fmt((Number(L.unitPriceInr) || 0) * (Number(L.quantity) || 1))}</td>
          <td>${
            L.checkoutUrl
              ? `<a href="${escapeHtml(L.checkoutUrl)}" target="_blank" rel="noopener noreferrer">Open</a>`
              : `<span class="muted">Booked on checkout</span>`
          }</td>
          <td><button type="button" class="btn btn-sm remove-line" data-id="${escapeHtml(L.lineId)}">Remove</button></td>
        </tr>`
        )
        .join("");

      return `
      <section class="panel checkout-bucket" style="margin-top: 1rem" data-bucket-key="${escapeHtml(key)}">
        <div class="online-head">
          <h3 style="margin: 0; font-size: 1.1rem">${escapeHtml(title)} <span class="muted">(${escapeHtml(src)})</span></h3>
          ${
            urls.length
              ? `<button type="button" class="btn btn-sm open-bucket-btn">
            Open this ${src === "local" ? "location" : "retailer"}
          </button>`
              : ""
          }
        </div>
        <p class="muted" style="margin: 0.4rem 0 0.75rem">${
          src === "diagnostics"
            ? "Diagnostics item(s) stay in cart until booking/payment completes."
            : `${urls.length} unique link(s) for this bucket.`
        }</p>
        <div class="table-wrap">
          <table class="price-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Line total</th>
                <th>Link</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="muted" style="margin-top: 0.75rem">Subtotal: <strong class="price-cell">₹${fmt(sub)}</strong></p>
      </section>`;
    })
    .join("");

  $("grandStats").innerHTML = `<span>Pharmacy / retailer groups: <strong>${groups.size}</strong></span>
    <span>Lines: <strong>${items.length}</strong></span>
    <span>Estimated total: <strong>₹${fmt(grand)}</strong></span>`;

  $("buckets").querySelectorAll(".qty-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      setLineQuantity(inp.dataset.id, inp.value);
      render();
    });
  });
  $("buckets").querySelectorAll(".remove-line").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeLine(btn.dataset.id);
      render();
    });
  });
  $("buckets").querySelectorAll(".open-bucket-btn").forEach((btn) => {
    const section = btn.closest(".checkout-bucket");
    const k = section?.getAttribute("data-bucket-key");
    const lines = k ? groups.get(k) || [] : [];
    const urls = uniqueOpenUrls(lines);
    btn.addEventListener("click", () => {
      urls.forEach((u, i) => {
        setTimeout(() => window.open(u, "_blank", "noopener,noreferrer"), i * 450);
      });
    });
  });

  // Home delivery panel
  renderDoseTable(onlyLocalItems(items));
  const diagPanel = $("diagnosticsPanel");
  const diagDate = $("diagDate");
  const diagPay = $("diagPaymentType");
  const diagLines = onlyDiagnosticsItems(items);
  if (diagPanel) diagPanel.classList.toggle("hidden", diagLines.length === 0);
  if (diagDate) {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 1);
    const maxDate = new Date(minDate.getTime());
    maxDate.setDate(maxDate.getDate() + 30);
    diagDate.min = localDateInputValue(minDate);
    diagDate.max = localDateInputValue(maxDate);
    if (!diagDate.value || diagDate.value < diagDate.min || diagDate.value > diagDate.max) {
      diagDate.value = diagDate.min;
    }
  }
  if (diagPay && !diagPay.value) diagPay.value = "cod";
}

$("clearBtn")?.addEventListener("click", () => {
  if (confirm("Remove all items from the cart?")) {
    clearCart();
    render();
  }
});

$("openAllBtn")?.addEventListener("click", () => {
  const items = getCartItems();
  const urls = uniqueOpenUrls(items);
  urls.forEach((u, i) => {
    setTimeout(() => window.open(u, "_blank", "noopener,noreferrer"), i * 450);
  });
});

render();

const returnToCheckout = `${window.location.pathname}${window.location.search || ""}`;
const loginReturn = `/login.html?returnTo=${encodeURIComponent(returnToCheckout || "/checkout.html")}`;
$("loginToOrderLink")?.setAttribute("href", loginReturn);
$("navLogin")?.setAttribute("href", loginReturn);

Promise.all([refreshAuthNav(), fetchMe()]).then(([, u]) => {
  const loginLink = $("loginToOrderLink");
  if (loginLink) loginLink.classList.toggle("hidden", Boolean(u && u.role !== "service_provider"));
});
$("placeOrderBtn")?.addEventListener("click", () => placeDeliveryOrder());
$("placeDiagnosticsBtn")?.addEventListener("click", () => placeDiagnosticsOrder());
