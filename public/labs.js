import { cartLineCount } from "./cartStore.js";
import { clearCachedUser, fetchAndCacheUser, loadCachedUser } from "./authProfile.js";

const $ = (id) => document.getElementById(id);

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 380;
const SUGGEST_MIN_QUERY_LEN = 3;
const SUGGEST_DEBOUNCE_MS = 180;
const RECENT_KEY = "medlens_recent_lab_searches_v1";
const RECENT_MAX = 6;
const DIAG_PREPAID_KEY = "medlens_diag_prepaid_payload_v1";

let cities = [];
let selectedCategory = "";
let t = null;
let selectedDiagPackages = new Map();

const DEFAULT_METRO_CITIES = [
  { slug: "mumbai", name: "Mumbai", state: "Maharashtra" },
  { slug: "bengaluru", name: "Bengaluru", state: "Karnataka" },
  { slug: "new-delhi", name: "New Delhi", state: "Delhi" },
];

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

function cleanPincode(v) {
  return String(v || "").replace(/[^\d]/g, "").slice(0, 6);
}

function fmtINR(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

async function getJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
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

function modalEls() {
  return {
    wrap: $("labPkgModal"),
    closeBtn: $("labPkgModalClose"),
    backdrop: $("labPkgModalBackdrop"),
    title: $("labPkgModalTitle"),
    sub: $("labPkgModalSub"),
    provider: $("labPkgModalProvider"),
    tat: $("labPkgModalTat"),
    price: $("labPkgModalPrice"),
    mrp: $("labPkgModalMrp"),
    tests: $("labPkgModalTests"),
  };
}

function bookModalEls() {
  return {
    wrap: $("labBookModal"),
    backdrop: $("labBookModalBackdrop"),
    closeBtn: $("labBookModalClose"),
    cancelBtn: $("labBookCancel"),
    confirmBtn: $("labBookConfirm"),
    sub: $("labBookModalSub"),
    hint: $("labBookHint"),
    selectedWrap: $("labBookSelectedWrap"),
    total: $("labBookTotal"),
    dateInput: $("labBookDate"),
    paymentSelect: $("labBookPayment"),
  };
}

function pkgKey(pkg) {
  return String(pkg?.dealId || pkg?.packageId || "").trim();
}

function addSelectedPackage(pkg) {
  const key = pkgKey(pkg);
  if (!key) return;
  selectedDiagPackages.set(key, {
    city: pkg.city,
    packageId: String(pkg.packageId || ""),
    dealId: String(pkg.dealId || pkg.packageId || ""),
    packageName: String(pkg.packageName || ""),
    priceInr: Number(pkg.priceInr) || 0,
    mrpInr: pkg.mrpInr == null ? null : Number(pkg.mrpInr),
  });
}

function selectedPackagesList() {
  return [...selectedDiagPackages.values()];
}

function renderBookSelection() {
  const m = bookModalEls();
  if (!m.selectedWrap || !m.total) return;
  const packs = selectedPackagesList();
  if (!packs.length) {
    m.selectedWrap.innerHTML = `<p class="muted">No tests selected.</p>`;
    m.total.textContent = "";
    return;
  }
  m.selectedWrap.innerHTML = packs
    .map(
      (p) => `
      <div class="dx-book-selected-item">
        <span>${escapeHtml(p.packageName)} <span class="muted">(${escapeHtml(fmtINR(p.priceInr))})</span></span>
        <button type="button" class="btn btn-sm btn-ghost" data-remove-pkg="${escapeAttr(pkgKey(p))}">Remove</button>
      </div>`
    )
    .join("");
  const total = packs.reduce((s, p) => s + (Number(p.priceInr) || 0), 0);
  m.total.textContent = `Total for ${packs.length} test(s): ${fmtINR(total)}`;
}

function closePackageModal() {
  const m = modalEls();
  if (!m.wrap) return;
  m.wrap.classList.add("hidden");
  m.wrap.setAttribute("aria-hidden", "true");
}

function closeBookModal() {
  const m = bookModalEls();
  if (!m.wrap) return;
  m.wrap.classList.add("hidden");
  m.wrap.setAttribute("aria-hidden", "true");
  pendingBookCtx = null;
  if (m.confirmBtn) m.confirmBtn.disabled = false;
}

function openPackageModal(item) {
  const m = modalEls();
  if (!m.wrap) return;
  const tests = Array.isArray(item.tests_included) ? item.tests_included.slice(0, 15) : [];
  if (m.title) m.title.textContent = item.heading || "Diagnostics package";
  if (m.sub) m.sub.textContent = item.sub_heading || "";
  if (m.provider) m.provider.textContent = item.lab_name || "—";
  if (m.tat) m.tat.textContent = item.report_tat_hours != null ? `${item.report_tat_hours} hrs` : "—";
  if (m.price) m.price.textContent = item.price_inr != null ? fmtINR(item.price_inr) : "—";
  if (m.mrp) m.mrp.textContent = item.mrp_inr != null ? fmtINR(item.mrp_inr) : "—";
  if (m.tests) {
    if (tests.length) {
      m.tests.innerHTML = tests.map((t) => `<li>${escapeHtml(String(t))}</li>`).join("");
    } else {
      m.tests.innerHTML = `<li class="muted">Test list not available for this package.</li>`;
    }
  }
  m.wrap.classList.remove("hidden");
  m.wrap.setAttribute("aria-hidden", "false");
}

let pendingBookCtx = null;
function openBookModal(ctx) {
  const m = bookModalEls();
  if (!m.wrap) return;
  addSelectedPackage(ctx);
  pendingBookCtx = ctx;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 1);
  const min = localDateInputValue(minDate);
  const maxDate = new Date(minDate.getTime());
  maxDate.setDate(maxDate.getDate() + 30);
  const max = localDateInputValue(maxDate);
  const packs = selectedPackagesList();
  if (m.sub) m.sub.textContent = `${packs.length} test(s) selected for scheduled booking`;
  if (m.dateInput) {
    m.dateInput.min = min;
    m.dateInput.max = max;
    m.dateInput.value = min;
  }
  if (m.paymentSelect) m.paymentSelect.value = "cod";
  if (m.hint) m.hint.textContent = "A reminder will be added automatically before your scheduled sample collection.";
  renderBookSelection();
  m.wrap.classList.remove("hidden");
  m.wrap.setAttribute("aria-hidden", "false");
}

function initPackageModalHandlers() {
  const m = modalEls();
  if (!m.wrap) return;
  m.closeBtn?.addEventListener("click", () => closePackageModal());
  m.backdrop?.addEventListener("click", () => closePackageModal());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && m.wrap && !m.wrap.classList.contains("hidden")) closePackageModal();
  });
}

function initBookModalHandlers() {
  const m = bookModalEls();
  if (!m.wrap) return;
  const close = () => closeBookModal();
  m.closeBtn?.addEventListener("click", close);
  m.cancelBtn?.addEventListener("click", close);
  m.backdrop?.addEventListener("click", close);
  m.wrap?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-remove-pkg]");
    if (!btn) return;
    const id = btn.getAttribute("data-remove-pkg") || "";
    if (!id) return;
    selectedDiagPackages.delete(id);
    renderBookSelection();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && m.wrap && !m.wrap.classList.contains("hidden")) closeBookModal();
  });
  m.confirmBtn?.addEventListener("click", async () => {
    const selected = selectedPackagesList();
    if (!selected.length) {
      if (m.hint) m.hint.textContent = "Select at least one test before booking.";
      return;
    }
    const scheduledForIso = toStartOfLocalDayIso(m.dateInput?.value);
    if (!scheduledForIso) {
      if (m.hint) m.hint.textContent = "Please choose a valid future booking date.";
      return;
    }
    const statusEl = $("labStatus");
    m.confirmBtn.disabled = true;
    const bookingPayload = {
      package_id: selected[0].packageId,
      deal_id: selected[0].dealId,
      package_name: selected[0].packageName,
      city: selected[0].city,
      price_inr: selected[0].priceInr,
      mrp_inr: Number.isFinite(selected[0].mrpInr) ? selected[0].mrpInr : null,
      packages: selected.map((p) => ({
        package_id: p.packageId,
        deal_id: p.dealId,
        package_name: p.packageName,
        city: p.city,
        price_inr: p.priceInr,
        mrp_inr: Number.isFinite(p.mrpInr) ? p.mrpInr : null,
      })),
      payment_type: m.paymentSelect?.value || "cod",
      scheduled_for: scheduledForIso,
    };
    if (statusEl) statusEl.textContent = "Booking package with diagnostics partner…";
    try {
      if (bookingPayload.payment_type === "prepaid") {
        localStorage.setItem(DIAG_PREPAID_KEY, JSON.stringify(bookingPayload));
        closeBookModal();
        window.location.assign("/diagnostics-payment.html");
        return;
      }
      const booked = await getJson("/api/orders/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingPayload),
      });
      if (!booked.ok) {
        if (m.hint) m.hint.textContent = booked.data?.error || `Booking failed (${booked.status})`;
        if (statusEl) statusEl.textContent = booked.data?.error || `Booking failed (${booked.status})`;
        m.confirmBtn.disabled = false;
        return;
      }
      const ord = booked.data?.order || {};
      if (statusEl) {
        statusEl.textContent = `Booking confirmed. Order #${ord.id}${ord.partner_booking_ref ? ` · Ref ${ord.partner_booking_ref}` : ""}`;
      }
      selectedDiagPackages = new Map();
      closeBookModal();
      window.location.assign(`/order.html?id=${encodeURIComponent(ord.id)}`);
    } catch (e) {
      const msg = String(e?.message || e);
      if (m.hint) m.hint.textContent = msg;
      if (statusEl) statusEl.textContent = msg;
      m.confirmBtn.disabled = false;
    }
  });
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(q) {
  const s = String(q || "").trim();
  if (!s) return;
  const arr = loadRecent().filter((x) => x.toLowerCase() !== s.toLowerCase());
  arr.unshift(s);
  const next = arr.slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  renderRecent();
}

function renderRecent() {
  const host = document.querySelector('.quick-chips[aria-label="Popular"]');
  if (!host) return;
  const existing = host.querySelector(".recent-chip-group");
  if (existing) existing.remove();
  const recent = loadRecent();
  if (!recent.length) return;
  const wrap = document.createElement("div");
  wrap.className = "recent-chip-group";
  wrap.style.display = "contents";
  recent.slice(0, 4).forEach((q) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = q;
    btn.addEventListener("click", () => {
      const input = $("labQ");
      if (!input) return;
      input.value = q;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
    wrap.appendChild(btn);
  });
  host.appendChild(wrap);
}

async function uploadDiagnosticsPrescriptionAndExtract() {
  const fileEl = $("labRxFile");
  const btn = $("labRxUploadBtn");
  const status = $("labRxStatus");
  const out = $("labRxMatches");
  const city = $("labCity")?.value || "";
  if (!fileEl || !btn || !status || !out) return;

  const file = fileEl.files?.[0];
  if (!file) {
    status.textContent = "Choose an image/PDF first.";
    return;
  }
  if (!city) {
    status.textContent = "Choose a city first.";
    return;
  }

  btn.disabled = true;
  status.textContent = "Extracting tests from image…";
  out.classList.add("hidden");
  out.innerHTML = "";

  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/labs/prescription/ocr?city=${encodeURIComponent(city)}`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      status.textContent = data.error || `OCR failed (${res.status})`;
      btn.disabled = false;
      return;
    }
    const matches = data.matches || [];
    if (!matches.length) {
      status.textContent = "No tests confidently matched. Try a clearer photo (printed text works best).";
      btn.disabled = false;
      return;
    }
    status.textContent = `Matched ${matches.length} test(s). Click one to search.`;
    out.innerHTML = matches
      .map((m, idx) => {
        const extra = [m.lab_name ? `Lab: ${m.lab_name}` : "", m.price_inr != null ? fmtINR(m.price_inr) : ""]
          .filter(Boolean)
          .join(" · ");
        const line = m.match_line ? `Matched line: ${m.match_line}` : "";
        return `
          <div class="rx-match">
            <div>
              <div class="rx-match-title">${escapeHtml(m.heading || "")}</div>
              <div class="rx-match-sub muted">${escapeHtml(m.sub_heading || "")}${
                extra ? ` · ${escapeHtml(extra)}` : ""
              }${line ? ` · ${escapeHtml(line)}` : ""}</div>
            </div>
            <button type="button" class="btn btn-sm btn-primary dxrx-pick" data-idx="${idx}">Search</button>
          </div>`;
      })
      .join("");
    out.classList.remove("hidden");
    out.querySelectorAll(".dxrx-pick").forEach((b) => {
      b.addEventListener("click", () => {
        const idx = Number(b.dataset.idx);
        const m = matches[idx];
        if (!m?.heading) return;
        $("labQ").value = String(m.heading);
        closeSuggestions?.();
        runSearch();
      });
    });
  } catch (e) {
    status.textContent = String(e?.message || e);
  } finally {
    btn.disabled = false;
  }
}

function refreshCartBadge() {
  const n = cartLineCount();
  const el = $("cartBadge");
  if (!el) return;
  el.textContent = String(n);
  el.classList.toggle("hidden", n === 0);
}

let currentUser = null;

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
  const ordersEl = $("navOrders");
  const profileWrapEl = $("navProfileWrap");
  const profileNameEl = $("navProfileName");
  const profileLogoutEl = $("navProfileLogout");
  if (!userEl || !loginEl || !logoutEl) return;

  const u = currentUser;
  const isLogged = Boolean(u);
  loginEl.classList.toggle("hidden", isLogged);
  // Keep standalone logout hidden; logout is shown under Profile menu.
  logoutEl.classList.add("hidden");
  // Keep standalone user badge hidden; name is shown inside Profile dropdown.
  userEl.classList.add("hidden");
  // Orders are for consumer users only (OTP/Google). Hide for logged-out and service providers.
  if (ordersEl) ordersEl.classList.toggle("hidden", !(isLogged && u?.role !== "service_provider"));
  if (profileWrapEl) profileWrapEl.classList.toggle("hidden", !(isLogged && u?.role !== "service_provider"));
  if (profileLogoutEl) profileLogoutEl.classList.toggle("hidden", !isLogged);

  if (!isLogged) {
    userEl.textContent = "";
    if (profileNameEl) profileNameEl.textContent = "Account";
    return;
  }
  userEl.textContent =
    u.role === "service_provider"
      ? `SP · ${u.username || "account"}`
      : u.full_name
        ? `${u.full_name}`
      : u.email
        ? `${u.email}`
      : u.phone_e164
        ? `${u.phone_e164}`
        : "Account";
  if (profileNameEl) profileNameEl.textContent = userEl.textContent;
}

async function refreshAuth() {
  currentUser = loadCachedUser();
  renderAuthNav();
  currentUser = await fetchAndCacheUser();
  renderAuthNav();
}

async function loadCities() {
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
  const sel = $("labCity");
  sel.innerHTML = cities
    .map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.name)}, ${escapeHtml(c.state)}</option>`)
    .join("");
}

async function loadCategories() {
  const res = await fetch("/api/labs/categories");
  const data = await res.json();
  const cats = data.categories || ["PATHOLOGY"];
  $("labCats").innerHTML = cats
    .map((c) => {
      const active = c === selectedCategory ? " active" : "";
      return `<button type="button" class="chip${active}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`;
    })
    .join("");

  $("labCats").querySelectorAll("button[data-cat]").forEach((b) => {
    b.addEventListener("click", () => {
      const c = b.getAttribute("data-cat") || "";
      selectedCategory = selectedCategory === c ? "" : c;
      loadCategories();
      runSearch();
    });
  });
}

function setStatus(msg) {
  $("labStatus").textContent = msg || "";
}

function render(items) {
  const grid = $("labGrid");
  const empty = $("labEmpty");
  if (!items.length) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  grid.innerHTML = items
    .map((it) => {
      const price = Number(it.price_inr);
      const mrp = it.mrp_inr != null ? Number(it.mrp_inr) : null;
      const hasDiscount = mrp != null && mrp > price && price > 0;
      const pct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : null;
      const tat = it.report_tat_hours != null ? `${escapeHtml(it.report_tat_hours)} hrs` : "—";
      const home = it.home_collection ? "Home collection" : "Lab visit";
      const provider = String(it.provider || "").toLowerCase();
      const packageId = String(it.package_id || it.id || "");
      const dealId = String(it.deal_id || packageId || "");
      const hasExternalOpen = provider !== "healthians" && !!it.slug;
      const openUrl = hasExternalOpen ? `https://www.1mg.com${it.slug}` : "#";

      return `
      <article class="lab-card">
        <div class="lab-card-top">
          <div class="lab-icowrap">
            ${it.icon_url ? `<img src="${escapeHtml(it.icon_url)}" alt="" loading="lazy" />` : `<span>🧪</span>`}
          </div>
          <div class="lab-meta">
            <div class="lab-title">${escapeHtml(it.heading)}</div>
            <div class="lab-sub muted">${escapeHtml(it.sub_heading || "")}</div>
            <div class="lab-badges">
              <span class="pill">${escapeHtml(it.lab_name || "Lab")}</span>
              <span class="pill pill-muted">${escapeHtml(home)}</span>
              <span class="pill pill-muted">Report: ${tat}</span>
              ${hasDiscount ? `<span class="pill pill-deal">${pct}% OFF</span>` : ""}
            </div>
          </div>
        </div>
        <div class="lab-card-bottom">
          <div class="lab-price">
            <div class="lab-price-now">${escapeHtml(fmtINR(price))}</div>
            <div class="lab-price-was muted">${hasDiscount ? `<s>${escapeHtml(fmtINR(mrp))}</s>` : ""}</div>
          </div>
          <div class="lab-actions">
            ${
              hasExternalOpen
                ? `<a class="btn btn-sm btn-ghost" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener noreferrer">Open</a>`
                : `<button type="button" class="btn btn-sm btn-ghost" data-view="${escapeAttr(packageId)}">View</button>`
            }
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              data-add="${escapeAttr(packageId)}"
              data-deal-id="${escapeAttr(dealId)}"
              data-heading="${escapeAttr(it.heading || "")}"
              data-price="${escapeAttr(it.price_inr)}"
              data-mrp="${escapeAttr(it.mrp_inr ?? "")}"
            >Add</button>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              data-book="${escapeAttr(packageId)}"
              data-deal-id="${escapeAttr(dealId)}"
              data-heading="${escapeAttr(it.heading || "")}"
              data-price="${escapeAttr(it.price_inr)}"
              data-mrp="${escapeAttr(it.mrp_inr ?? "")}"
            >Book</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  grid.querySelectorAll("button[data-view]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const packageId = btn.getAttribute("data-view") || "";
      const city = $("labCity")?.value || "";
      const pincode = cleanPincode($("labPincode")?.value || "");
      if (!packageId || !city) return;
      const out = await getJson(
        `/api/labs/package/${encodeURIComponent(packageId)}?city=${encodeURIComponent(city)}&pincode=${encodeURIComponent(pincode)}`
      );
      if (!out.ok) {
        setStatus(out.data?.error || `Failed to load package details (${out.status})`);
        return;
      }
      const item = out.data?.item || {};
      openPackageModal(item);
    });
  });

  grid.querySelectorAll("button[data-book]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const city = $("labCity")?.value || "";
      const packageId = btn.getAttribute("data-book") || "";
      const dealId = btn.getAttribute("data-deal-id") || packageId;
      const packageName = btn.getAttribute("data-heading") || "";
      const priceInr = Number(btn.getAttribute("data-price"));
      const mrpRaw = btn.getAttribute("data-mrp");
      const mrpInr = mrpRaw === "" || mrpRaw == null ? null : Number(mrpRaw);
      if (!city || !packageId || !packageName || !Number.isFinite(priceInr)) return;
      if (!currentUser) {
        alert("Please login first to book diagnostics packages.");
        window.location.assign("/login.html");
        return;
      }
      openBookModal({ city, packageId, dealId, packageName, priceInr, mrpInr });
    });
  });

  grid.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const city = $("labCity")?.value || "";
      const packageId = btn.getAttribute("data-add") || "";
      const dealId = btn.getAttribute("data-deal-id") || packageId;
      const packageName = btn.getAttribute("data-heading") || "";
      const priceInr = Number(btn.getAttribute("data-price"));
      const mrpRaw = btn.getAttribute("data-mrp");
      const mrpInr = mrpRaw === "" || mrpRaw == null ? null : Number(mrpRaw);
      if (!city || !packageId || !packageName || !Number.isFinite(priceInr)) return;
      addSelectedPackage({ city, packageId, dealId, packageName, priceInr, mrpInr });
      setStatus(`Added ${selectedPackagesList().length} test(s) for scheduled booking.`);
    });
  });
}

async function runSearch() {
  const q = $("labQ").value.trim();
  const city = $("labCity").value;
  const pincode = cleanPincode($("labPincode")?.value || "");

  if (!q) {
    setStatus("Type a test name to search (e.g. CBC).");
    render([]);
    return;
  }
  if (q.length < MIN_QUERY_LEN) {
    setStatus(`Enter at least ${MIN_QUERY_LEN} characters to search.`);
    render([]);
    return;
  }

  setStatus("Searching…");
  saveRecent(q);

  const params = new URLSearchParams({ q, city, pincode });
  if (selectedCategory) params.set("category", selectedCategory);

  try {
    const res = await fetch(`/api/labs/search?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || `Search failed (${res.status})`);
      render([]);
      return;
    }
    setStatus(`Showing results for “${q}” in ${city}${selectedCategory ? ` · ${selectedCategory}` : ""}.`);
    render(data.items || []);
  } catch (e) {
    setStatus(String(e?.message || e));
    render([]);
  }
}

function scheduleSearch() {
  clearTimeout(t);
  t = setTimeout(runSearch, DEBOUNCE_MS);
}

function renderIntents(intents) {
  const row = $("labIntentRow");
  if (!row) return;
  if (!Array.isArray(intents) || intents.length === 0) {
    row.classList.add("hidden");
    row.innerHTML = "";
    return;
  }
  row.classList.remove("hidden");
  row.innerHTML = intents
    .slice(0, 6)
    .map((it) => `<button type="button" class="chip" data-intent="${escapeHtml(it.id)}">${escapeHtml(it.label)}</button>`)
    .join("");
  row.querySelectorAll("button[data-intent]").forEach((b) => {
    b.addEventListener("click", () => {
      const label = b.textContent || "";
      const input = $("labQ");
      if (!input) return;
      input.value = label;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });
  });
}

let intentTimer;
async function refreshIntentHints() {
  const q = $("labQ")?.value?.trim() || "";
  const city = $("labCity")?.value || "";
  const pincode = cleanPincode($("labPincode")?.value || "");
  if (!city || q.length < 2) {
    renderIntents([]);
    return;
  }
  try {
    const res = await fetch(
      `/api/labs/intent?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}&pincode=${encodeURIComponent(pincode)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      renderIntents([]);
      return;
    }
    renderIntents(data.intents || []);
  } catch {
    renderIntents([]);
  }
}

// --- Autocomplete suggestions (3+ chars) ---
let suggestTimer;
/** @type {AbortController | null} */
let suggestAbort = null;
let suggestItems = [];
let suggestActive = -1;

function getSuggestEls() {
  const input = $("labQ");
  const box = $("labQ-suggestions");
  return { input, box };
}

function closeSuggestions() {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  suggestItems = [];
  suggestActive = -1;
}

function openSuggestions() {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;
  box.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
}

function renderSuggestions(items, q) {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;

  if (!Array.isArray(items) || items.length === 0) {
    closeSuggestions();
    return;
  }

  suggestItems = items.slice(0, 10);
  suggestActive = -1;
  openSuggestions();

  const qLower = String(q || "").toLowerCase();
  box.innerHTML = suggestItems
    .map((it, idx) => {
      const id = `labQ-sug-${idx}`;
      const heading = String(it.heading || "").trim();
      const sub = String(it.sub_heading || "").trim();
      const headingLower = heading.toLowerCase();
      const hitAt = qLower && headingLower.includes(qLower) ? headingLower.indexOf(qLower) : -1;
      const label =
        hitAt >= 0 && qLower.length
          ? `${escapeHtml(heading.slice(0, hitAt))}<mark>${escapeHtml(
              heading.slice(hitAt, hitAt + qLower.length)
            )}</mark>${escapeHtml(heading.slice(hitAt + qLower.length))}`
          : escapeHtml(heading);
      return `
        <div class="suggestion" role="option" id="${escapeAttr(id)}" data-idx="${idx}" aria-selected="false">
          <div class="suggestion-title">${label}</div>
          ${sub ? `<div class="suggestion-sub muted">${escapeHtml(sub)}</div>` : ""}
        </div>`;
    })
    .join("");

  box.querySelectorAll(".suggestion").forEach((row) => {
    row.addEventListener("mousedown", (e) => e.preventDefault());
    row.addEventListener("click", () => {
      const idx = Number(row.dataset.idx);
      pickSuggestion(idx);
    });
  });
}

function setActiveSuggestion(nextIdx) {
  const { input, box } = getSuggestEls();
  if (!input || !box) return;
  const rows = [...box.querySelectorAll(".suggestion")];
  if (!rows.length) return;
  suggestActive = Math.max(0, Math.min(nextIdx, rows.length - 1));
  rows.forEach((el, i) => el.setAttribute("aria-selected", i === suggestActive ? "true" : "false"));
  const activeEl = rows[suggestActive];
  if (activeEl?.id) input.setAttribute("aria-activedescendant", activeEl.id);
  activeEl?.scrollIntoView?.({ block: "nearest" });
}

function pickSuggestion(idx) {
  const { input } = getSuggestEls();
  if (!input) return;
  const it = suggestItems[idx];
  const heading = String(it?.heading || "").trim();
  if (!heading) return;
  input.value = heading;
  closeSuggestions();
  clearTimeout(t);
  runSearch();
}

async function runSuggestSearch() {
  const { input } = getSuggestEls();
  if (!input) return;
  const q = input.value.trim();

  if (!q || q.length < SUGGEST_MIN_QUERY_LEN) {
    closeSuggestions();
    return;
  }

  if (suggestAbort) suggestAbort.abort();
  suggestAbort = new AbortController();
  const signal = suggestAbort.signal;

  const city = $("labCity")?.value || "";
  const pincode = cleanPincode($("labPincode")?.value || "");
  const params = new URLSearchParams({ q, city, pincode });
  if (selectedCategory) params.set("category", selectedCategory);

  try {
    // Reuse labs search endpoint for suggestions (we only display top results).
    const res = await fetch(`/api/labs/search?${params.toString()}`, { signal });
    const data = await res.json().catch(() => ({}));
    if (signal.aborted) return;
    if (!res.ok) {
      closeSuggestions();
      return;
    }
    renderSuggestions(data.items || [], q);
  } catch (e) {
    if (e?.name === "AbortError") return;
    closeSuggestions();
  }
}

$("labQ").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const { box } = getSuggestEls();
    if (!box || box.classList.contains("hidden")) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" ? 1 : -1;
    setActiveSuggestion((suggestActive < 0 ? -1 : suggestActive) + delta);
    return;
  }
  if (e.key === "Escape") {
    const { box } = getSuggestEls();
    if (box && !box.classList.contains("hidden")) {
      e.preventDefault();
      closeSuggestions();
      return;
    }
  }
  if (e.key !== "Enter") return;
  const { box } = getSuggestEls();
  if (box && !box.classList.contains("hidden")) {
    const rows = box.querySelectorAll(".suggestion");
    if (rows.length && suggestActive >= 0) {
      e.preventDefault();
      pickSuggestion(suggestActive);
      return;
    }
  }
});

$("labQ").addEventListener("input", () => {
  scheduleSearch();
  clearTimeout(intentTimer);
  intentTimer = setTimeout(refreshIntentHints, 220);
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(runSuggestSearch, SUGGEST_DEBOUNCE_MS);
});

$("labQ").addEventListener("blur", () => setTimeout(() => closeSuggestions(), 120));

$("labCity").addEventListener("change", runSearch);
$("labPincode")?.addEventListener("input", (e) => {
  const el = e.currentTarget;
  if (!el) return;
  el.value = cleanPincode(el.value);
  scheduleSearch();
});

async function initLabsPage() {
  await loadCities();
  await refreshAuth();
  await loadCategories();
  refreshCartBadge();
  renderRecent();

  $("navLogout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await postJson("/api/auth/logout", {});
    clearCachedUser();
    currentUser = null;
    renderAuthNav();
  });

  $("navProfileLogout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await postJson("/api/auth/logout", {});
    clearCachedUser();
    currentUser = null;
    renderAuthNav();
  });

  $("labRxUploadBtn")?.addEventListener("click", () => uploadDiagnosticsPrescriptionAndExtract());
  initPackageModalHandlers();
  initBookModalHandlers();

  // Support deep-link from home page: /labs.html?q=...&city=...&category=...
  const params = new URLSearchParams(window.location.search);
  const q0 = (params.get("q") || "").trim();
  const city0 = (params.get("city") || "").trim();
  const pin0 = cleanPincode(params.get("pincode") || "");
  const cat0 = (params.get("category") || "").trim().toUpperCase();
  if (city0 && $("labCity") && [...$("labCity").options].some((o) => o.value === city0)) {
    $("labCity").value = city0;
  }
  if (pin0 && $("labPincode")) {
    $("labPincode").value = pin0;
  }
  if (cat0 === "PATHOLOGY" || cat0 === "RADIOLOGY") {
    selectedCategory = cat0;
    await loadCategories();
  }
  if (q0) {
    $("labQ").value = q0;
    runSearch();
  } else {
    setStatus("Type a test name to search (e.g. CBC).");
  }
}

initLabsPage().catch((e) => {
  setStatus(String(e?.message || e));
});

