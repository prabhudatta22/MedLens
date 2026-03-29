const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `${Math.round(x * 1000) / 10}%`;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function defaultRange() {
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  return { from: isoDate(from), to: isoDate(to) };
}

async function api(path, { apiKey }) {
  const res = await fetch(path, { headers: { "x-api-key": apiKey } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(json?.error || `Request failed: ${res.status}`);
  }
  return json;
}

function setError(msg) {
  $("err").textContent = msg || "";
}

function renderKpis(kpi) {
  const revenue = Number(kpi.revenue_inr);
  const cost = Number(kpi.cost_inr);
  const profit = Number(kpi.profit_inr);
  const margin = kpi.margin;

  $("kpis").innerHTML = `
    <span>Orders: <strong>${escapeHtml(kpi.orders)}</strong></span>
    <span>Revenue: <strong>${escapeHtml(fmtINR(revenue))}</strong></span>
    <span>Cost: <strong>${escapeHtml(fmtINR(cost))}</strong></span>
    <span>Profit: <strong>${escapeHtml(fmtINR(profit))}</strong></span>
    <span>Margin: <strong>${escapeHtml(margin == null ? "—" : fmtPct(margin))}</strong></span>
  `;
}

function renderTop(list) {
  $("top").innerHTML = list
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.display_name)}</td>
      <td>${escapeHtml(r.units)}</td>
      <td class="price-cell">${escapeHtml(fmtINR(r.revenue_inr))}</td>
      <td class="price-cell" style="color: var(--warn)">${escapeHtml(fmtINR(r.profit_inr))}</td>
    </tr>`
    )
    .join("");
}

function renderRecent(list) {
  $("recent").innerHTML = list
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(new Date(r.sold_at).toLocaleString("en-IN"))} <span class="muted">(#${escapeHtml(
        r.id
      )})</span></td>
      <td class="muted">${escapeHtml(r.channel)}</td>
      <td class="price-cell">${escapeHtml(fmtINR(r.revenue_inr))}</td>
      <td class="price-cell" style="color: var(--warn)">${escapeHtml(fmtINR(r.profit_inr))}</td>
    </tr>`
    )
    .join("");
}

async function loadDashboard() {
  setError("");
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) {
    setError("Enter your API key.");
    return;
  }
  const from = $("from").value;
  const to = $("to").value;

  try {
    const me = await api("/api/partner/me", { apiKey });
    $("dash").classList.remove("hidden");
    $("title").textContent = `${me.partner.display_name} — ${me.partner.pharmacy_name}`;

    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const summary = await api(`/api/partner/sales/summary?${q.toString()}`, { apiKey });
    renderKpis(summary.kpi);
    renderTop(summary.top_medicines || []);

    const recent = await api("/api/partner/sales/recent", { apiKey });
    renderRecent(recent.sales || []);
  } catch (e) {
    setError(e.message || String(e));
    $("dash").classList.add("hidden");
  }
}

const r = defaultRange();
$("from").value = r.from;
$("to").value = r.to;

$("load").addEventListener("click", loadDashboard);

