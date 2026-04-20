const $ = (id) => document.getElementById(id);

let cartId = null;
let itemsBase = [];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

function fmtINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

async function loadCitiesIntoSelect() {
  const res = await fetch("/api/cities");
  const data = await res.json();
  const cities = data.cities || [];
  const sel = $("city");
  sel.innerHTML = cities
    .map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</option>`)
    .join("");
  return cities;
}

function renderBaseItems(items) {
  $("itemsWrap").classList.remove("hidden");
  $("items").innerHTML = items
    .map(
      (it) => `
    <tr data-mid="${it.medicine_id}">
      <td>${escapeHtml(it.display_name)} <span class="muted">· ${escapeHtml(
        it.strength
      )} · ${escapeHtml(it.form)}</span></td>
      <td>${it.quantity}</td>
      <td class="price-cell" style="color: var(--warn)">${fmtPct(it.match_score)}</td>
      <td class="muted">—</td>
      <td class="muted">—</td>
      <td class="muted">—</td>
    </tr>`
    )
    .join("");
}

function renderComparedItems(compared) {
  const byMid = new Map(compared.map((x) => [Number(x.medicine_id), x]));
  $("items").querySelectorAll("tr").forEach((tr) => {
    const mid = Number(tr.dataset.mid);
    const item = byMid.get(mid);
    const tds = tr.querySelectorAll("td");
    if (!item) return;

    const best = item.best;
    const stats = item.stats || {};
    const spread =
      stats.spread_percent != null ? `${stats.spread_percent}%` : "—";

    // columns: 0 med, 1 qty, 2 match, 3 best price, 4 pharmacy, 5 spread
    {
      const p = best?.price_inr;
      const d = best?.discount_pct;
      let priceHtml = p != null ? `₹${fmtINR(p)}` : "—";
      if (d != null && Number.isFinite(Number(d)) && Number(d) > 0) {
        const dp = Number(d);
        const label = dp % 1 < 0.05 ? `${Math.round(dp)}%` : `${dp.toFixed(1)}%`;
        priceHtml += ` <span class="muted">(${label} off)</span>`;
      }
      tds[3].innerHTML = priceHtml;
      tds[3].className = p != null ? "price-cell" : "muted";
    }

    tds[4].innerHTML =
      best?.pharmacy_name
        ? `${escapeHtml(best.pharmacy_name)} <span class="muted">${
            best.chain ? `(${escapeHtml(best.chain)})` : ""
          }</span>`
        : "<span class=\"muted\">No listing in this city</span>";

    tds[5].innerHTML =
      stats.min_inr != null && stats.max_inr != null
        ? `<span class="muted">₹${fmtINR(stats.min_inr)}–₹${fmtINR(stats.max_inr)}</span> <span class="muted">(${escapeHtml(
            spread
          )})</span>`
        : "<span class=\"muted\">—</span>";
  });
}

async function loadCompareForCity(citySlug) {
  const res = await fetch(
    `/api/carts/${encodeURIComponent(cartId)}/compare?city=${encodeURIComponent(citySlug)}`
  );
  if (!res.ok) return;
  const data = await res.json();
  renderComparedItems(data.items || []);
}

async function main() {
  const url = new URL(window.location.href);
  const id = url.searchParams.get("id");
  if (!id) {
    $("meta").textContent = "Missing cart id.";
    return;
  }

  const res = await fetch(`/api/carts/${encodeURIComponent(id)}`);
  if (!res.ok) {
    $("meta").textContent = "Cart not found.";
    return;
  }
  const data = await res.json();
  const cart = data.cart;
  cartId = cart.id;
  const items = data.items || [];
  itemsBase = items;

  $("meta").innerHTML = `Cart <strong>#${cart.id}</strong> · status <strong>${escapeHtml(
    cart.status
  )}</strong> · created ${escapeHtml(new Date(cart.created_at).toLocaleString("en-IN"))}`;

  if (!items.length) {
    $("empty").classList.remove("hidden");
    return;
  }

  $("controls").classList.remove("hidden");
  await loadCitiesIntoSelect();
  renderBaseItems(items);

  const citySel = $("city");
  citySel.addEventListener("change", () => loadCompareForCity(citySel.value));
  await loadCompareForCity(citySel.value);
}

main().catch((e) => {
  console.error(e);
  $("meta").textContent = "Failed to load cart.";
});

