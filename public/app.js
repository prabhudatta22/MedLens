const $ = (id) => document.getElementById(id);

let cities = [];
let selectedMedicine = null;

async function loadCities() {
  const res = await fetch("/api/cities");
  const data = await res.json();
  cities = data.cities || [];
  const sel = $("city");
  sel.innerHTML = cities
    .map(
      (c) =>
        `<option value="${escapeAttr(c.slug)}">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</option>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

let searchTimer;
$("q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 220);
});

$("city").addEventListener("change", () => {
  if (selectedMedicine) loadCompare();
});

async function runSearch() {
  const q = $("q").value.trim();
  const ul = $("results");
  if (!q) {
    ul.innerHTML = "";
    return;
  }
  const res = await fetch(`/api/medicines/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  const list = data.medicines || [];
  ul.innerHTML = list
    .map(
      (m) => `
    <li role="option" tabindex="0" data-id="${m.id}"
        class="${selectedMedicine?.id === m.id ? "active" : ""}">
      <span>
        <span class="med-name">${escapeHtml(m.display_name)}</span>
        <span class="med-meta"> · ${escapeHtml(m.strength)} · ${escapeHtml(m.form)} · pack ${m.pack_size}</span>
      </span>
    </li>`
    )
    .join("");

  ul.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => selectMedicine(Number(li.dataset.id), list));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectMedicine(Number(li.dataset.id), list);
      }
    });
  });
}

function selectMedicine(id, list) {
  selectedMedicine = list.find((m) => m.id === id) || null;
  $("results").querySelectorAll("li").forEach((li) => {
    li.classList.toggle("active", Number(li.dataset.id) === id);
  });
  if (!selectedMedicine) return;
  $("selection").innerHTML = `Showing <strong>${escapeHtml(selectedMedicine.display_name)}</strong> (${escapeHtml(
    selectedMedicine.strength
  )}).`;
  loadCompare();
}

async function loadCompare() {
  if (!selectedMedicine) return;
  const city = $("city").value;
  const res = await fetch(
    `/api/compare?medicineId=${selectedMedicine.id}&city=${encodeURIComponent(city)}`
  );
  const data = await res.json();
  const stats = $("stats");
  const tableWrap = $("table-wrap");
  const empty = $("empty");
  const tbody = $("offers");

  const offers = data.offers || [];
  if (!offers.length) {
    stats.classList.add("hidden");
    tableWrap.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.textContent = `No listing for this medicine in ${city} in the demo dataset. Try another city or medicine.`;
    return;
  }

  empty.classList.add("hidden");
  stats.classList.remove("hidden");
  tableWrap.classList.remove("hidden");

  const s = data.stats || {};
  const spread =
    s.spread_percent != null
      ? `<span>Typical spread in this sample: <strong>${s.spread_percent}%</strong> between highest and lowest.</span>`
      : "";
  stats.innerHTML = `
    <span>Lowest: <strong>₹${fmt(s.min_inr)}</strong></span>
    <span>Highest: <strong>₹${fmt(s.max_inr)}</strong></span>
    ${spread}
  `;

  const minPrice = s.min_inr;
  tbody.innerHTML = offers
    .map((o) => {
      const best = Number(o.price_inr) === minPrice;
      return `
      <tr class="${best ? "best" : ""}">
        <td>${escapeHtml(o.pharmacy_name)}${o.chain ? ` <span class="muted">(${escapeHtml(o.chain)})</span>` : ""}</td>
        <td class="price-cell">₹${fmt(o.price_inr)}</td>
        <td class="muted">${o.mrp_inr != null ? `₹${fmt(o.mrp_inr)}` : "—"}</td>
        <td class="muted">${escapeHtml(o.address_line || "")}${o.pincode ? ` · ${escapeHtml(o.pincode)}` : ""}</td>
      </tr>`;
    })
    .join("");
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

loadCities().catch(console.error);
