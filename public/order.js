import { fetchAndCacheUser, loadCachedUser } from "./authProfile.js";

const $ = (id) => document.getElementById(id);
const ORDER_SUCCESS_KEY = "medlens_order_success_message_v1";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTs(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function parseJsonLoose(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function readId() {
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get("id"));
  return Number.isFinite(id) && id > 0 ? id : null;
}

function renderAuthNav(user) {
  const logged = Boolean(user && user.role !== "service_provider");
  $("navLogin")?.classList.toggle("hidden", logged);
  $("navProfile")?.classList.toggle("hidden", !logged);
}

async function refreshAuthNav() {
  renderAuthNav(loadCachedUser());
  const fresh = await fetchAndCacheUser();
  renderAuthNav(fresh);
}

function renderTimeline(events) {
  const host = $("orderTimeline");
  if (!host) return;
  if (!events?.length) {
    host.innerHTML = `<p class="muted">No events yet.</p>`;
    return;
  }
  host.innerHTML = events
    .map(
      (e) => `
      <div class="rx-match" style="justify-content: flex-start">
        <div>
          <div class="rx-match-title">${escapeHtml(e.status)}</div>
          <div class="rx-match-sub muted">${escapeHtml(fmtTs(e.created_at))}${e.message ? ` · ${escapeHtml(e.message)}` : ""}</div>
        </div>
      </div>`
    )
    .join("");
}

async function load() {
  const id = readId();
  const title = $("orderTitle");
  const meta = $("orderMeta");
  const status = $("orderStatus");
  const itemsTbody = $("orderItems");
  if (!status || !itemsTbody) return;
  if (!id) {
    status.textContent = "Missing order id.";
    return;
  }
  if (title) title.textContent = `Order #${id}`;
  status.textContent = "Loading…";

  const res = await fetch(`/api/orders/${encodeURIComponent(id)}`, { credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const returnTo = `${window.location.pathname}${window.location.search || ""}`;
    status.innerHTML = `Please <a href="/login.html?returnTo=${encodeURIComponent(returnTo)}">log in</a> to view this order.`;
    return;
  }
  if (!res.ok) {
    status.textContent = data.error || `Failed to load (${res.status})`;
    return;
  }

  const o = data.order;
  if (meta) {
    const kind = o.order_kind === "diagnostics" ? "Diagnostics" : "Medicines";
    const providerRef = o.provider_order_ref ? ` · Ref ${o.provider_order_ref}` : "";
    meta.textContent = `${kind} · ${o.status} · ${o.delivery_option}${o.scheduled_for ? ` · scheduled ${fmtTs(o.scheduled_for)}` : ""}${providerRef}`;
  }
  const partnerStatus = data.partner_status?.booking_status ? ` · Partner stage ${data.partner_status.booking_status}` : "";
  let successFlash = "";
  try {
    successFlash = sessionStorage.getItem(ORDER_SUCCESS_KEY) || "";
    if (successFlash) sessionStorage.removeItem(ORDER_SUCCESS_KEY);
  } catch {
    successFlash = "";
  }
  status.textContent = `${successFlash ? `${successFlash} · ` : ""}Status: ${o.status}${partnerStatus}`;

  const items = data.items || [];
  itemsTbody.innerHTML = items
    .map((it) => {
      const m = parseJsonLoose(it.item_meta);
      const diagBits = [
        m?.patient_name ? `Patient: ${m.patient_name}` : "",
        m?.patient_age ? `Age: ${m.patient_age}` : "",
        m?.payment_type ? `Payment: ${String(m.payment_type).toUpperCase()}` : "",
        m?.slot?.label ? `Slot: ${m.slot.label}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
      <tr>
        <td>${escapeHtml(it.item_label)}${it.strength ? ` <span class="muted">${escapeHtml(it.strength)}</span>` : ""}</td>
        <td class="muted">${escapeHtml(it.quantity_units)}</td>
        <td class="muted">${escapeHtml(it.pharmacy_name || (diagBits || "—"))}</td>
      </tr>`;
    })
    .join("");

  renderTimeline(data.events || []);
}

const returnToOrder = `${window.location.pathname}${window.location.search || ""}`;
$("navLogin")?.setAttribute("href", `/login.html?returnTo=${encodeURIComponent(returnToOrder)}`);

Promise.all([refreshAuthNav(), load()]).catch((e) => {
  const status = $("orderStatus");
  if (status) status.textContent = String(e?.message || e);
});

