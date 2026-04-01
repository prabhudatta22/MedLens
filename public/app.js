import { addCartLine, cartLineCount, STORAGE_KEY } from "./cartStore.js";

const $ = (id) => document.getElementById(id);

const SEARCH_DEBOUNCE_MS = 420;
const MIN_QUERY_LEN = 2;

function refreshCartBadge() {
  const n = cartLineCount();
  const el = $("cartBadge");
  if (!el) return;
  el.textContent = String(n);
  el.classList.toggle("hidden", n === 0);
}

let cities = [];
/** For purchase-reminder deep link only — set when local results show exactly one medicine */
let selectedMedicine = null;
let loggedIn = false;
let currentUser = null;
/** @type {{ provider_id: string, label: string, search_url: string, price_inr?: number } | null} */
let selectedOnlineOffer = null;

/** @type {AbortController | null} */
let compareAbort = null;

let liveQuery = "";

const GEO_STORAGE_KEY = "medlens_geo_location_v1";

const DEFAULT_METRO_CITIES = [
  { slug: "mumbai", name: "Mumbai", state: "Maharashtra" },
  { slug: "bengaluru", name: "Bengaluru", state: "Karnataka" },
  { slug: "new-delhi", name: "New Delhi", state: "Delhi" },
];

function setCityOptions(sel, list) {
  if (!sel) return;
  sel.innerHTML = (list || [])
    .map(
      (c) =>
        `<option value="${escapeAttr(c.slug)}">${escapeHtml(c.name)}, ${escapeHtml(c.state || "")}</option>`
    )
    .join("");
}

async function loadCities() {
  const sel = $("city");
  try {
    const res = await fetch("/api/cities");
    const data = await res.json().catch(() => ({}));
    cities = data.cities || [];
  } catch {
    cities = [];
  }

  if (!Array.isArray(cities) || cities.length === 0) {
    cities = DEFAULT_METRO_CITIES.slice();
  }

  setCityOptions(sel, cities);
  restoreGeoFromSession();
  if (!loadGeoState()?.google) maybeAutoLocateFromPermission();
}

function saveGeoState(google, matched_city) {
  try {
    sessionStorage.setItem(
      GEO_STORAGE_KEY,
      JSON.stringify({
        google,
        matched_city: matched_city
          ? { slug: matched_city.slug, name: matched_city.name, state: matched_city.state }
          : null,
      })
    );
  } catch {
    /* ignore quota / private mode */
  }
}

function loadGeoState() {
  try {
    const raw = sessionStorage.getItem(GEO_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function renderLocationDetail(google, matched_city) {
  const el = $("locationDetail");
  if (!el) return;
  if (!google?.formatted_address) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");
  const metaParts = [google.locality, google.administrative_area_level_1, google.country].filter(Boolean);
  const pin = google.postal_code ? `PIN ${escapeHtml(google.postal_code)}` : "";
  const matchHtml = matched_city
    ? `<span class="muted">Local demo prices: <strong>${escapeHtml(matched_city.name)}</strong> (${escapeHtml(
        matched_city.state || ""
      )})</span>`
    : `<span class="muted">No demo city matched this address — choose the closest city in the list.</span>`;
  const ll =
    google.lat != null && google.lng != null
      ? `${Number(google.lat).toFixed(5)}, ${Number(google.lng).toFixed(5)}`
      : "";
  el.innerHTML = `
    <div class="location-line-primary">${escapeHtml(google.formatted_address)}</div>
    <div class="location-meta muted">
      ${escapeHtml(metaParts.join(" · "))}${pin ? ` · ${escapeHtml(pin)}` : ""}
      ${ll ? `<br/>Coordinates: ${escapeHtml(ll)}` : ""}
    </div>
    <div class="location-meta" style="margin-top: 0.4rem">${matchHtml}</div>`;
}

function applyGeocodeResponse(body) {
  const { google, matched_city } = body;
  const sel = $("city");
  if (matched_city && sel) {
    const ok = [...sel.options].some((o) => o.value === matched_city.slug);
    if (ok) sel.value = matched_city.slug;
  }
  if (google) {
    const pinEl = $("pincode");
    if (pinEl && google.postal_code) {
      const d = String(google.postal_code).replace(/\D/g, "").slice(0, 6);
      if (d.length === 6 && !pinEl.value.trim()) pinEl.value = d;
    }
    renderLocationDetail(google, matched_city);
    saveGeoState(google, matched_city);
  }
}

/** 6-digit PIN for database-backed “Online retailers” compare (input or geocoded). */
function getComparePincode() {
  const raw = $("pincode")?.value?.trim() || "";
  const digits = raw.replace(/\D/g, "").slice(0, 6);
  if (digits.length === 6) return digits;
  const geoPin = loadGeoState()?.google?.postal_code;
  if (geoPin) {
    const d = String(geoPin).replace(/\D/g, "").slice(0, 6);
    if (d.length === 6) return d;
  }
  return "";
}

function mapsUrlFromDbOffer(o) {
  const mapsQuery = [o.address_line, o.pincode, o.city_name, o.pharmacy_name].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;
}

/** Map /api/compare/by-pincode JSON into the shape expected by renderOnlineTable */
function dbCompareResponseToOnlineShape(data) {
  const offers = data.offers || [];
  const prices = offers.map((o) => Number(o.price_inr)).filter((n) => Number.isFinite(n));
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  let spread_percent = null;
  if (min != null && max != null && max > 0 && min < max) {
    spread_percent = Math.round(((max - min) / max) * 1000) / 10;
  }
  const stats =
    data.stats && (data.stats.min_inr != null || data.stats.max_inr != null)
      ? data.stats
      : { min_inr: min, max_inr: max, spread_percent };

  return {
    source: "db",
    filter_label: data.filter_label || "",
    parallel_ms: 0,
    stats,
    providers: offers.map((o) => ({
      provider_id: `db-${o.pharmacy_id}-${o.price_id}`,
      label: o.chain ? `${o.pharmacy_name} (${o.chain})` : o.pharmacy_name,
      ok: true,
      price_inr: o.price_inr,
      mrp_inr: o.mrp_inr,
      product_title: `${o.display_name} · ${o.strength || ""}`.trim(),
      search_url: mapsUrlFromDbOffer(o),
      website: mapsUrlFromDbOffer(o),
      data_mode: "local_db",
      pharmacy_id: o.pharmacy_id,
      medicine_id: o.medicine_id,
      address_line: o.address_line,
      pincode: o.pincode,
      city_name: o.city_name,
      pharmacy_name: o.pharmacy_name,
      chain: o.chain,
      display_name: o.display_name,
      strength: o.strength,
    })),
  };
}

function restoreGeoFromSession() {
  const saved = loadGeoState();
  if (!saved?.google) return;
  renderLocationDetail(saved.google, saved.matched_city);
  if (saved.matched_city?.slug) {
    const sel = $("city");
    if (sel && [...sel.options].some((o) => o.value === saved.matched_city.slug)) {
      sel.value = saved.matched_city.slug;
    }
  }
}

async function reverseGeocodeCoords(latitude, longitude) {
  const res = await fetch(
    `/api/geocode/reverse?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error || data.hint || `Geocoding failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function useBrowserLocation() {
  const btn = $("useLocationBtn");
  const hint = $("locationHint");
  if (!navigator.geolocation) {
    if (hint) hint.textContent = "Geolocation is not supported in this browser.";
    return;
  }
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = "Getting your location…";

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        if (hint) hint.textContent = "Looking up address with Google…";
        const { latitude, longitude } = pos.coords;
        const data = await reverseGeocodeCoords(latitude, longitude);
        applyGeocodeResponse(data);
        if (hint) hint.textContent = "";
        if (btn) btn.disabled = false;
        runRealtimeSearch();
      } catch (e) {
        if (hint) hint.textContent = String(e?.message || e);
        if (btn) btn.disabled = false;
      }
    },
    (err) => {
      if (hint) {
        hint.textContent =
          err.code === 1
            ? "Location blocked. Allow location for this site in browser settings, or pick a city below."
            : `Location unavailable (${err.message || err.code}). Pick a city below.`;
      }
      if (btn) btn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 18000, maximumAge: 300_000 }
  );
}

/** If the user already granted geolocation, refresh address without an extra permission prompt */
function maybeAutoLocateFromPermission() {
  if (!navigator.geolocation || !navigator.permissions?.query) return;
  navigator.permissions
    .query({ name: "geolocation" })
    .then((p) => {
      if (p.state !== "granted") return;
      const hint = $("locationHint");
      if (hint) hint.textContent = "Refreshing location…";
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude, longitude } = pos.coords;
            const data = await reverseGeocodeCoords(latitude, longitude);
            applyGeocodeResponse(data);
            if (hint) hint.textContent = "";
            runRealtimeSearch();
          } catch (e) {
            if (hint) hint.textContent = String(e?.message || e);
          }
        },
        () => {
          if (hint) hint.textContent = "";
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 300_000 }
      );
    })
    .catch(() => {});
}

$("useLocationBtn")?.addEventListener("click", () => useBrowserLocation());

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

function syncReminderMedicineFromOffers(offers) {
  const ids = new Set(
    (offers || []).map((o) => o.medicine_id).filter((id) => id != null && Number(id) > 0)
  );
  if (ids.size !== 1) {
    selectedMedicine = null;
    updateReminderHint();
    return;
  }
  const id = [...ids][0];
  const row = offers.find((o) => Number(o.medicine_id) === Number(id));
  if (!row) {
    selectedMedicine = null;
    updateReminderHint();
    return;
  }
  selectedMedicine = {
    id: Number(row.medicine_id),
    display_name: row.display_name,
    strength: row.strength,
  };
  updateReminderHint();
}

let searchTimer;
$("q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runRealtimeSearch, SEARCH_DEBOUNCE_MS);
});

$("q").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  clearTimeout(searchTimer);
  runRealtimeSearch();
});

$("searchBtn")?.addEventListener("click", () => {
  clearTimeout(searchTimer);
  runRealtimeSearch();
});

$("city").addEventListener("change", () => {
  runRealtimeSearch();
});

$("pincode")?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runRealtimeSearch, SEARCH_DEBOUNCE_MS);
});

function abortPendingSearch() {
  if (compareAbort) {
    compareAbort.abort();
    compareAbort = null;
  }
}

async function runRealtimeSearch() {
  const q = $("q").value.trim();
  liveQuery = q;
  const city = $("city").value;
  const statusEl = $("search-status");

  abortPendingSearch();

  if (!q) {
    statusEl.textContent = "";
    resetLocalPanel();
    resetOnlinePanel();
    selectedMedicine = null;
    updateReminderHint();
    return;
  }

  if (q.length < MIN_QUERY_LEN) {
    statusEl.textContent = `Enter at least ${MIN_QUERY_LEN} characters to run a live search.`;
    resetLocalPanel();
    resetOnlinePanel();
    selectedMedicine = null;
    updateReminderHint();
    return;
  }

  compareAbort = new AbortController();
  const signal = compareAbort.signal;
  statusEl.textContent = "Searching database (by PIN / city) and local demo pharmacies…";

  const pin = getComparePincode();
  const pinParam = pin ? `&pincode=${encodeURIComponent(pin)}` : "";
  const dbRetailersUrl = `/api/compare/by-pincode?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}${pinParam}`;
  const localUrl = `/api/compare/search?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}`;

  try {
    const [dbRes, localRes] = await Promise.all([fetch(dbRetailersUrl, { signal }), fetch(localUrl, { signal })]);

    if (signal.aborted) return;

    if (dbRes.ok) {
      const dbData = await dbRes.json();
      if (signal.aborted) return;
      const shaped = dbData.source === "db" ? dbCompareResponseToOnlineShape(dbData) : dbData;
      renderOnlineTable(shaped, q);
    } else {
      const errBody = await dbRes.json().catch(() => ({}));
      if (signal.aborted) return;
      $("online-stats")?.classList.add("hidden");
      $("online-table-wrap")?.classList.add("hidden");
      $("online-checkout")?.classList.add("hidden");
      $("online-rows").innerHTML = "";
      $("online-status").textContent = errBody.error || `Database compare failed (${dbRes.status})`;
    }

    if (localRes.ok) {
      const localData = await localRes.json();
      if (signal.aborted) return;
      renderLocalTable(localData.offers || [], city, q, null);
      syncReminderMedicineFromOffers(localData.offers || []);
    } else {
      const errBody = await localRes.json().catch(() => ({}));
      if (signal.aborted) return;
      renderLocalTable([], city, q, errBody.error || `Local search failed (${localRes.status})`);
      selectedMedicine = null;
      updateReminderHint();
    }

    const pinNote = pin ? ` · PIN ${pin}` : "";
    statusEl.textContent = `Results for “${q}” in ${city}${pinNote}. Online retailers: pilot DB. Local: city-wide search.`;
  } catch (e) {
    if (e?.name === "AbortError") return;
    statusEl.textContent = String(e?.message || e);
  }
}

function resetLocalPanel() {
  const stats = $("stats");
  const tableWrap = $("table-wrap");
  const empty = $("empty");
  const tbody = $("offers");
  $("selection").textContent = "Type a medicine name to search local listings (pilot data).";
  stats.classList.add("hidden");
  tableWrap.classList.add("hidden");
  empty.classList.add("hidden");
  tbody.innerHTML = "";
}

function resetOnlinePanel() {
  const section = $("online-section");
  const status = $("online-status");
  const wrap = $("online-table-wrap");
  const statsEl = $("online-stats");
  const tbody = $("online-rows");
  const checkout = $("online-checkout");
  const openBtn = $("online-open-btn");
  const selLabel = $("online-selected-label");
  if (!section) return;
  status.textContent = "";
  wrap.classList.add("hidden");
  checkout.classList.add("hidden");
  statsEl.classList.add("hidden");
  tbody.innerHTML = "";
  selectedOnlineOffer = null;
  openBtn.disabled = true;
  selLabel.textContent = "";
  if (openBtn) openBtn.textContent = "Continue on selected site";
  const hintEl = openBtn?.nextElementSibling;
  if (hintEl?.classList?.contains("hint")) {
    hintEl.textContent = "Opens the retailer search in a new tab.";
  }
}

function renderLocalTable(offers, city, q, errorMsg) {
  const stats = $("stats");
  const tableWrap = $("table-wrap");
  const empty = $("empty");
  const tbody = $("offers");

  $("selection").innerHTML = `Local matches for <strong>${escapeHtml(q)}</strong> in <strong>${escapeHtml(
    city
  )}</strong> (pilot data).`;

  if (errorMsg) {
    stats.classList.add("hidden");
    tableWrap.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.textContent = errorMsg;
    tbody.innerHTML = "";
    return;
  }

  if (!offers.length) {
    stats.classList.add("hidden");
    tableWrap.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.textContent = `No local listings match “${q}” in ${city}. Try another spelling or city.`;
    tbody.innerHTML = "";
    return;
  }

  empty.classList.add("hidden");
  stats.classList.remove("hidden");
  tableWrap.classList.remove("hidden");

  const minPrice = Math.min(...offers.map((o) => Number(o.price_inr)).filter((n) => Number.isFinite(n)));
  stats.innerHTML = `
    <span>Rows: <strong>${offers.length}</strong></span>
    <span>Lowest in list: <strong>₹${fmt(minPrice)}</strong></span>
  `;

  tbody.innerHTML = offers
    .map((o, idx) => {
      const best = Number(o.price_inr) === minPrice;
      const med = `${escapeHtml(o.display_name)} · ${escapeHtml(o.strength || "")}`;
      return `
      <tr class="${best ? "best" : ""}">
        <td>${escapeHtml(o.pharmacy_name)}${o.chain ? ` <span class="muted">(${escapeHtml(o.chain)})</span>` : ""}</td>
        <td class="muted">${med}</td>
        <td class="price-cell">₹${fmt(o.price_inr)}</td>
        <td class="muted">${o.mrp_inr != null ? `₹${fmt(o.mrp_inr)}` : "—"}</td>
        <td class="muted">${escapeHtml(o.address_line || "")}${o.pincode ? ` · ${escapeHtml(o.pincode)}` : ""}</td>
        <td><button type="button" class="btn btn-sm add-local-cart" data-offer-idx="${idx}">Add</button></td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".add-local-cart").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = Number(btn.dataset.offerIdx);
      const o = offers[idx];
      if (!o) return;
      const mapsQuery = [o.address_line, o.pincode, o.city_name, o.pharmacy_name].filter(Boolean).join(" ");
      const checkoutUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;
      addCartLine({
        source: "local",
        medicineId: o.medicine_id,
        medicineLabel: o.display_name,
        strength: o.strength,
        unitPriceInr: Number(o.price_inr),
        mrpInr: o.mrp_inr != null ? Number(o.mrp_inr) : null,
        pharmacyId: o.pharmacy_id,
        pharmacyName: o.pharmacy_name,
        pharmacyAddress: o.address_line,
        pharmacyPincode: o.pincode,
        citySlug: city,
        checkoutUrl,
      });
      refreshCartBadge();
    });
  });
}

function renderOnlineTable(data, q) {
  const status = $("online-status");
  const wrap = $("online-table-wrap");
  const statsEl = $("online-stats");
  const tbody = $("online-rows");
  const checkout = $("online-checkout");
  const openBtn = $("online-open-btn");
  const selLabel = $("online-selected-label");
  const isDbSource = data.source === "db";

  if (openBtn) {
    openBtn.textContent = isDbSource ? "Open in Maps" : "Continue on selected site";
  }
  const hintEl = openBtn?.nextElementSibling;
  if (hintEl?.classList?.contains("hint")) {
    hintEl.textContent = isDbSource
      ? "Opens Google Maps for the selected pharmacy."
      : "Opens the retailer search in a new tab.";
  }

  const providers = data.providers || [];
  if (!providers.length) {
    statsEl.classList.add("hidden");
    wrap.classList.add("hidden");
    checkout.classList.add("hidden");
    tbody.innerHTML = "";
    selectedOnlineOffer = null;
    if (openBtn) openBtn.disabled = true;
    selLabel.textContent = "";
    status.textContent = isDbSource
      ? `No database matches for “${q}” (${data.filter_label || "try another PIN or city"}).`
      : "No retailer rows to display.";
    return;
  }

  const anyOk = providers.some((p) => p.ok);
  status.textContent = isDbSource
    ? `Pilot database · ${data.filter_label || "compare"}. ${providers.filter((p) => p.ok).length} listing(s).`
    : `Parallel fetch completed in ${data.parallel_ms ?? "—"} ms.${
        anyOk
          ? ""
          : " No partner APIs returned prices — configure .env (see README) or set ONLINE_USE_ILLUSTRATIVE_FALLBACK=true for demo numbers."
      }`;

  const s = data.stats || {};
  const spread =
    s.spread_percent != null
      ? `<span>Spread: <strong>${s.spread_percent}%</strong></span>`
      : "";
  const lowLbl = isDbSource ? "Lowest" : "Lowest (est.)";
  const highLbl = isDbSource ? "Highest" : "Highest (est.)";
  statsEl.innerHTML = `
    <span>${lowLbl}: <strong>₹${fmt(s.min_inr)}</strong></span>
    <span>${highLbl}: <strong>₹${fmt(s.max_inr)}</strong></span>
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
    .map((p, pidx) => {
      const ok = p.ok;
      const id = escapeAttr(p.provider_id || "");
      const checked = ok && p.provider_id === bestId ? " checked" : "";
      const priceCell = ok ? `₹${escapeHtml(fmt(p.price_inr))}` : "—";
      const mrpCell = ok && p.mrp_inr != null ? `₹${escapeHtml(fmt(p.mrp_inr))}` : "—";
      const url = escapeAttr(p.search_url || p.website || "#");
      const err = !ok ? ` <span class="muted">(${escapeHtml(p.error || "error")})</span>` : "";
      const canAdd = Boolean(p.search_url || p.website);
      const title = p.product_title ? escapeHtml(p.product_title) : `<span class="muted">—</span>`;
      const openLabel = isDbSource ? "Map" : "Open site";
      return `
      <tr>
        <td><input type="radio" name="online-pick" value="${id}"${checked} /></td>
        <td>${escapeHtml(p.label || p.provider_id)}${err}</td>
        <td class="muted">${title}</td>
        <td class="price-cell">${priceCell}</td>
        <td class="muted">${mrpCell}</td>
        <td><a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(openLabel)}</a></td>
        <td><button type="button" class="btn btn-sm add-online-cart" data-pidx="${pidx}"${
          canAdd ? "" : " disabled"
        }>Add</button></td>
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
      row.price_inr != null ? ` — ₹${fmt(row.price_inr)}${isDbSource ? "" : " (est.)"}` : ""
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

  tbody.querySelectorAll(".add-online-cart").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = Number(btn.dataset.pidx);
      const p = providers[idx];
      if (!p) return;
      const checkoutUrl = p.search_url || p.website;
      if (!checkoutUrl) return;
      const citySlug = $("city")?.value || "";
      if (p.data_mode === "local_db") {
        addCartLine({
          source: "local",
          medicineId: p.medicine_id,
          medicineLabel: p.display_name,
          strength: p.strength || "",
          unitPriceInr: Number(p.price_inr),
          mrpInr: p.mrp_inr != null ? Number(p.mrp_inr) : null,
          pharmacyId: p.pharmacy_id,
          pharmacyName: p.pharmacy_name,
          pharmacyAddress: p.address_line,
          pharmacyPincode: p.pincode,
          citySlug: citySlug,
          checkoutUrl,
        });
      } else {
        const label = (p.product_title || q).trim();
        addCartLine({
          source: "online",
          medicineId: 0,
          medicineLabel: label,
          strength: "",
          searchQuery: q,
          unitPriceInr: p.price_inr != null ? Number(p.price_inr) : 0,
          mrpInr: p.mrp_inr != null ? Number(p.mrp_inr) : null,
          onlineProviderId: p.provider_id,
          onlineLabel: p.label,
          checkoutUrl,
        });
      }
      refreshCartBadge();
    });
  });

  checkout.classList.remove("hidden");
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function renderAuthNav() {
  const userEl = $("navUser");
  const loginEl = $("navLogin");
  const logoutEl = $("navLogout");
  const importEl = $("navImport");
  if (!userEl || !loginEl || !logoutEl) return;

  const u = currentUser;
  const isLogged = Boolean(u);
  loginEl.classList.toggle("hidden", isLogged);
  logoutEl.classList.toggle("hidden", !isLogged);
  userEl.classList.toggle("hidden", !isLogged);
  if (importEl) importEl.classList.toggle("hidden", !(isLogged && u?.role === "service_provider"));

  if (!isLogged) {
    userEl.textContent = "";
    return;
  }

  const label =
    u.role === "service_provider"
      ? `SP · ${u.username || "account"}`
      : u.phone_e164
        ? `${u.phone_e164}`
        : "Account";
  userEl.textContent = label;
}

async function refreshAuth() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    const data = await res.json();
    currentUser = data.user || null;
    loggedIn = Boolean(currentUser);
  } catch {
    currentUser = null;
    loggedIn = false;
  }
  renderAuthNav();
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

window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) refreshCartBadge();
});

// Logout from header (user + service provider)
$("navLogout")?.addEventListener("click", async (e) => {
  e.preventDefault();
  await postJson("/api/auth/logout", {});
  currentUser = null;
  loggedIn = false;
  renderAuthNav();
  updateReminderHint();
});

Promise.all([loadCities(), refreshAuth()])
  .then(() => updateReminderHint())
  .then(() => refreshCartBadge())
  .catch(console.error);
