const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtInr(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtTs(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

async function loadOrders() {
  const status = $("ordersStatus");
  const tbody = $("ordersRows");
  if (!status || !tbody) return;
  status.textContent = "Loading…";
  tbody.innerHTML = "";

  const res = await fetch("/api/orders", { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    status.innerHTML = `Please <a href="/login.html">login</a> to see your orders.`;
    return;
  }
  if (!res.ok) {
    status.textContent = data.error || `Failed to load (${res.status})`;
    return;
  }
  const orders = data.orders || [];
  if (!orders.length) {
    status.textContent = "No orders yet.";
    return;
  }
  status.textContent = `Showing ${orders.length} order(s).`;
  tbody.innerHTML = orders
    .map((o) => {
      return `
        <tr>
          <td><strong>#${escapeHtml(o.id)}</strong></td>
          <td>${escapeHtml(o.status)}</td>
          <td class="muted">${escapeHtml(o.delivery_option)}${o.scheduled_for ? ` · ${escapeHtml(fmtTs(o.scheduled_for))}` : ""}</td>
          <td class="price-cell">${fmtInr(o.delivery_fee_inr)}</td>
          <td class="muted">${escapeHtml(fmtTs(o.created_at))}</td>
          <td><a href="/order.html?id=${encodeURIComponent(o.id)}">Track</a></td>
        </tr>`;
    })
    .join("");
}

loadOrders().catch((e) => {
  const status = $("ordersStatus");
  if (status) status.textContent = String(e?.message || e);
});

