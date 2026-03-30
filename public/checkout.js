import {
  getCartItems,
  setLineQuantity,
  removeLine,
  clearCart,
  bucketKey,
  bucketTitle,
} from "./cartStore.js";

const $ = (id) => document.getElementById(id);

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
            <input type="number" min="1" max="99" class="qty-input" data-id="${escapeHtml(L.lineId)}" value="${Number(
              L.quantity
            )}" />
          </td>
          <td class="price-cell">₹${fmt(L.unitPriceInr)}</td>
          <td class="price-cell">₹${fmt((Number(L.unitPriceInr) || 0) * (Number(L.quantity) || 1))}</td>
          <td><a href="${escapeHtml(L.checkoutUrl)}" target="_blank" rel="noopener noreferrer">Open</a></td>
          <td><button type="button" class="btn btn-sm remove-line" data-id="${escapeHtml(L.lineId)}">Remove</button></td>
        </tr>`
        )
        .join("");

      return `
      <section class="panel checkout-bucket" style="margin-top: 1rem" data-bucket-key="${escapeHtml(key)}">
        <div class="online-head">
          <h3 style="margin: 0; font-size: 1.1rem">${escapeHtml(title)} <span class="muted">(${escapeHtml(src)})</span></h3>
          <button type="button" class="btn btn-sm open-bucket-btn">
            Open this ${src === "local" ? "location" : "retailer"}
          </button>
        </div>
        <p class="muted" style="margin: 0.4rem 0 0.75rem">${urls.length} unique link(s) for this bucket.</p>
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
