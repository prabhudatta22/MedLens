const $ = (id) => document.getElementById(id);

let cities = [];
let selectedMedicine = null;
let loggedIn = false;
/** @type {{ provider_id: string, label: string, search_url: string, price_inr?: number } | null} */
let selectedOnlineOffer = null;

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
  if (selectedMedicine) {
    loadCompare();
    loadOnlineCompare();
  }
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
  updateReminderHint();
  loadCompare();
  loadOnlineCompare();
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

async function loadOnlineCompare() {
  const section = $("online-section");
  const status = $("online-status");
  const wrap = $("online-table-wrap");
  const statsEl = $("online-stats");
  const tbody = $("online-rows");
  const checkout = $("online-checkout");
  const openBtn = $("online-open-btn");
  const selLabel = $("online-selected-label");

  if (!selectedMedicine) {
    section?.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  status.textContent = "Fetching MedPlus, Apollo, Netmeds, 1mg, Medkart in parallel…";
  wrap.classList.add("hidden");
  checkout.classList.add("hidden");
  statsEl.classList.add("hidden");
  tbody.innerHTML = "";
  selectedOnlineOffer = null;
  openBtn.disabled = true;
  selLabel.textContent = "";

  try {
    const res = await fetch(
      `/api/online/compare?medicineId=${selectedMedicine.id}`
    );
    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.error || "Online compare failed.";
      return;
    }

    const anyOk = providers.some((p) => p.ok);
    status.textContent = `Parallel fetch completed in ${data.parallel_ms ?? "—"} ms.${
      anyOk
        ? ""
        : " No partner APIs returned prices — configure .env (see README) or set ONLINE_USE_ILLUSTRATIVE_FALLBACK=true for demo numbers."
    }`;
    const providers = data.providers || [];
    const s = data.stats || {};
    const spread =
      s.spread_percent != null
        ? `<span>Illustrative spread: <strong>${s.spread_percent}%</strong></span>`
        : "";
    statsEl.innerHTML = `
      <span>Lowest (est.): <strong>₹${fmt(s.min_inr)}</strong></span>
      <span>Highest (est.): <strong>₹${fmt(s.max_inr)}</strong></span>
      ${spread}
    `;
    statsEl.classList.remove("hidden");

    let bestId = null;
    let minP = Infinity;
    for (const p of providers) {
      if (p.ok && p.price_inr != null && Number(p.price_inr) < minP) {
        minP = Number(p.price_inr);
        bestId = p.provider_id;
      }
    }

    tbody.innerHTML = providers
      .map((p) => {
        const ok = p.ok;
        const id = escapeAttr(p.provider_id || "");
        const checked = ok && p.provider_id === bestId ? " checked" : "";
        const price = ok ? fmt(p.price_inr) : "—";
        const mrp = ok && p.mrp_inr != null ? fmt(p.mrp_inr) : "—";
        const url = escapeAttr(p.search_url || p.website || "#");
        const err = !ok ? ` <span class="muted">(${escapeHtml(p.error || "error")})</span>` : "";
        return `
      <tr>
        <td><input type="radio" name="online-pick" value="${id}"${checked} /></td>
        <td>${escapeHtml(p.label || p.provider_id)}${err}</td>
        <td class="price-cell">${escapeHtml(price)}</td>
        <td class="muted">${escapeHtml(mrp)}</td>
        <td><a href="${url}" target="_blank" rel="noopener noreferrer">Open site</a></td>
      </tr>`;
      })
      .join("");

    wrap.classList.remove("hidden");

    function syncFromRadio(radio) {
      if (!radio) {
        selectedOnlineOffer = null;
        openBtn.disabled = true;
        selLabel.textContent = "";
        return;
      }
      const id = radio.value;
      const row = providers.find((x) => x.provider_id === id);
      if (!row || !row.search_url) {
        selectedOnlineOffer = null;
        openBtn.disabled = true;
        return;
      }
      selectedOnlineOffer = {
        provider_id: row.provider_id,
        label: row.label,
        search_url: row.search_url,
        price_inr: row.price_inr,
      };
      openBtn.disabled = false;
      selLabel.textContent = `Selected: ${row.label}${
        row.price_inr != null ? ` — est. ₹${fmt(row.price_inr)}` : ""
      }`;
    }

    const firstChecked = tbody.querySelector('input[name="online-pick"]:checked');
    syncFromRadio(firstChecked || tbody.querySelector('input[name="online-pick"]'));

    tbody.querySelectorAll('input[name="online-pick"]').forEach((radio) => {
      radio.addEventListener("change", () => syncFromRadio(radio));
    });

    openBtn.onclick = () => {
      if (!selectedOnlineOffer?.search_url) return;
      window.open(selectedOnlineOffer.search_url, "_blank", "noopener,noreferrer");
    };

    checkout.classList.remove("hidden");
  } catch (e) {
    status.textContent = String(e?.message || e);
  }
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function refreshAuth() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    const data = await res.json();
    loggedIn = Boolean(data.user);
  } catch {
    loggedIn = false;
  }
}

function updateReminderHint() {
  const el = $("reminderHint");
  const link = $("reminderLink");
  if (!el || !link) return;
  if (!selectedMedicine || !loggedIn) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const label = encodeURIComponent(selectedMedicine.display_name);
  const mid = selectedMedicine.id;
  link.href = `/reminders.html?medicine_id=${mid}&medicine_label=${label}`;
}

loadCities()
  .then(() => refreshAuth())
  .then(() => updateReminderHint())
  .catch(console.error);
